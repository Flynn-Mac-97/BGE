/**
 * Kernel: the pass graph — the ordered draws one frame runs, and the executor.
 *
 * Order is global: a pass that orders itself against another must consult one
 * list, and no pass can see every pass. So the kernel owns the graph. A record
 * declares its edges by label (`after` / `before`), and the executor sorts them
 * once per pass-set change.
 *
 * The executor holds no scene, no entity list and no plugin data. It runs three
 * loops over the live passes, so its work is O(passes) and the same for a world
 * of one entity and a world of ten thousand. The sorted order, the resource
 * targets and the frame record are reused until the pass set changes, so a
 * steady frame allocates nothing.
 */
import { reportOnce } from './report.js'
import { descriptorKey, makeTargetPool } from './target-pool.js'

// Shared empty lists: most passes declare no edges and no resources.
const EMPTY = []

function normalise(record) {
  return {
    name: record.name,
    after: record.after ?? EMPTY,
    before: record.before ?? EMPTY,
    reads: record.reads ?? EMPTY,
    writes: record.writes ?? EMPTY,
    target: record.target ?? null,
    // "clear" empties the depth buffer before this pass runs, so an overlay
    // measured against it cannot be clipped by the world drawn underneath.
    depth: record.depth ?? null,
    requires: record.requires ?? EMPTY,
    always: record.always === true,
    enabled: true,
    extract: record.extract ?? null,
    prepare: record.prepare ?? null,
    execute: record.execute
  }
}

/** Whether the graph can prove a pass wanted without reading a later one. */
function isSink(pass) {
  return pass.always || pass.name === 'present' || pass.target == null
}

/** Add one edge unless it is a self-edge or already recorded. */
function addEdge(seen, out, indegree, from, to) {
  if (from === to) return
  let set = seen.get(from)
  if (!set) {
    set = new Set()
    seen.set(from, set)
  }
  if (set.has(to)) return
  set.add(to)
  out.get(from).push(to)
  indegree.set(to, indegree.get(to) + 1)
}

/**
 * Record one pass's `after` labels: each names a pass that runs before it.
 *
 * A label no pass carries is reported and ignored, so a plugin that orders
 * against a pass this device dropped still leaves a runnable graph.
 */
function addAfterEdges(pass, byName, indegree, out, seen, report) {
  for (const label of pass.after) {
    if (byName.has(label)) addEdge(seen, out, indegree, label, pass.name)
    else
      report(
        `[render] graph: no pass called ${JSON.stringify(label)} to order "${pass.name}" after — the edge is ignored`
      )
  }
}

/** Record one pass's `before` labels: each names a pass that runs after it. */
function addBeforeEdges(pass, byName, indegree, out, seen, report) {
  for (const label of pass.before) {
    if (byName.has(label)) addEdge(seen, out, indegree, pass.name, label)
    else
      report(
        `[render] graph: no pass called ${JSON.stringify(label)} to order "${pass.name}" before — the edge is ignored`
      )
  }
}

/** Record every label edge in registration order, so the tie-break is stable. */
function addLabelEdges(list, byName, indegree, out, seen, report) {
  for (const pass of list) {
    addAfterEdges(pass, byName, indegree, out, seen, report)
    addBeforeEdges(pass, byName, indegree, out, seen, report)
  }
}

/** The passes with no incoming edge, in registration order. */
function sourcesInOrder(list, indegree) {
  const ready = []
  for (const pass of list) if (indegree.get(pass.name) === 0) ready.push(pass.name)
  return ready
}

/** Kahn's walk: drain the ready queue, appending each pass's freed successors. */
function walkOrder(ready, byName, indegree, out) {
  const ordered = []
  for (let head = 0; head < ready.length; head++) {
    const name = ready[head]
    ordered.push(byName.get(name))
    for (const to of out.get(name)) {
      const left = indegree.get(to) - 1
      indegree.set(to, left)
      if (left === 0) ready.push(to)
    }
  }
  return ordered
}

/** Append the passes a cycle stranded, keeping registration order. */
function appendStuck(ordered, list, report) {
  if (ordered.length >= list.length) return ordered
  const placed = new Set(ordered.map(pass => pass.name))
  const stuck = list.filter(pass => !placed.has(pass.name)).map(pass => pass.name)
  report(`[render] graph: a cycle among ${stuck.join(', ')} — those passes keep registration order`)
  for (const pass of list) if (!placed.has(pass.name)) ordered.push(pass)
  return ordered
}

/**
 * Order the passes by their label edges.
 *
 * Kahn's walk with registration order as the tie-break, so a pass with no edge
 * keeps the order it was added in. A cycle is reported by name and its members
 * keep registration order: the loader rule is to report and continue.
 */
function topological(list, report) {
  const byName = new Map(list.map(pass => [pass.name, pass]))
  const indegree = new Map(list.map(pass => [pass.name, 0]))
  const out = new Map(list.map(pass => [pass.name, []]))
  const seen = new Map()
  addLabelEdges(list, byName, indegree, out, seen, report)
  const ordered = walkOrder(sourcesInOrder(list, indegree), byName, indegree, out)
  return appendStuck(ordered, list, report)
}

/** Map each read resource to the passes that read it. */
function readersByResource(ordered) {
  const readers = new Map()
  for (const pass of ordered) {
    for (const name of pass.reads) {
      const list = readers.get(name)
      if (list) list.push(pass)
      else readers.set(name, [pass])
    }
  }
  return readers
}

/** A pass that survives on its own: a sink, or one that reads and writes nothing. */
function isAlwaysLive(pass) {
  return isSink(pass) || (pass.reads.length === 0 && pass.writes.length === 0)
}

/** Whether a live pass reads one of this pass's written resources. */
function isReadByLive(pass, readers, live) {
  for (const written of pass.writes) {
    const list = readers.get(written)
    if (list?.some(reader => live.has(reader.name))) return true
  }
  return false
}

/** Grow the live set until no dead pass's writes feed a live pass. */
function growLive(ordered, readers) {
  const live = new Set(ordered.filter(isAlwaysLive).map(pass => pass.name))
  let changed = true
  while (changed) {
    changed = false
    for (const pass of ordered) {
      if (live.has(pass.name)) continue
      if (isReadByLive(pass, readers, live)) {
        live.add(pass.name)
        changed = true
      }
    }
  }
  return live
}

/**
 * Drop every pass the graph can prove unread.
 *
 * A pass that draws to the screen, asks for `always`, or declares no resource
 * is a sink and survives. Otherwise a pass survives when a surviving pass reads
 * one of its writes; the walk repeats until nothing more is added, so a private
 * dependency of a dead pass dies with it.
 */
function selectLive(ordered) {
  const readers = readersByResource(ordered)
  const live = growLive(ordered, readers)
  return ordered.filter(pass => live.has(pass.name))
}

/**
 * Give every written resource a target, sharing one where spans do not overlap.
 *
 * A resource's span runs from the pass that writes it to the last pass that
 * reads it. Two spans that do not overlap can share one physical target, which
 * is the only aliasing a WebGL 2 backend allows.
 */
function planTargets(ordered) {
  const spans = new Map()
  ordered.forEach((pass, index) => {
    for (const name of pass.writes) {
      const span = spans.get(name)
      if (span) {
        span.producer = Math.min(span.producer, index)
        if (pass.target) span.descriptor = pass.target
      } else {
        spans.set(name, { descriptor: pass.target, producer: index, lastReader: index })
      }
    }
  })
  ordered.forEach((pass, index) => {
    for (const name of pass.reads) {
      const span = spans.get(name)
      if (span) span.lastReader = Math.max(span.lastReader, index)
    }
  })

  const slots = []
  const resourceSlot = new Map()
  for (const [name, span] of spans) {
    if (!span.descriptor) continue
    const key = descriptorKey(span.descriptor)
    let slot = slots.find(one => one.key === key && one.freeAfter < span.producer)
    if (!slot) {
      slot = { key, descriptor: span.descriptor, freeAfter: -1, target: null }
      slots.push(slot)
    }
    slot.freeAfter = Math.max(slot.freeAfter, span.lastReader)
    resourceSlot.set(name, slot)
  }
  return { slots, resourceSlot }
}

export function makePassGraph(options = {}) {
  const report = options.report ?? reportOnce
  const pool = options.pool ?? makeTargetPool()
  const hasFeature = options.hasFeature ?? (() => true)
  // The graph holds no renderer, so clearing a pass depth is a call the frame
  // supplies. A pass that does not ask for it never reaches this.
  const clearDepth = options.clearDepth ?? (() => {})
  const records = new Map()

  let order = []
  let slots = []
  let resourceSlot = new Map()
  let dirty = true
  let rebuildCount = 0
  let targetsReady = false
  let targetWidth = 0
  let targetHeight = 0

  // One record and one target lookup for the life of the graph. A pass gets the
  // same two objects every frame, so nothing is allocated on the steady path.
  const frame = { camera: null, target: null, width: 0, height: 0 }
  const targets = {
    get(name) {
      return resourceSlot.get(name)?.target ?? null
    },
    has(name) {
      return resourceSlot.has(name)
    }
  }

  // The sink `extract` writes its own GPU data through. The kernel stores the
  // entries and never reads them; a plugin owns their shape.
  const buffers = new Map()
  const sink = {
    attribute(name) {
      let entry = buffers.get(name)
      if (!entry) {
        entry = { name, changed: false }
        buffers.set(name, entry)
      }
      return entry
    },
    markDirty(name) {
      const entry = buffers.get(name)
      if (entry) entry.changed = true
    }
  }

  function rebuild() {
    for (const slot of slots) if (slot.target) pool.release(slot.target)
    // A disabled pass keeps its record so a pass that orders against its label
    // still has an edge; it is dropped from the run after the sort.
    const supported = [...records.values()].filter(pass => {
      if (!pass.enabled) return true
      const missing = pass.requires.filter(name => !hasFeature(name))
      if (!missing.length) return true
      report(
        `[render] graph: "${pass.name}" needs ${missing.join(', ')}, which this device does not have — the pass is dropped`
      )
      return false
    })
    order = selectLive(topological(supported, report)).filter(pass => pass.enabled)
    const plan = planTargets(order)
    slots = plan.slots
    resourceSlot = plan.resourceSlot
    targetsReady = false
    dirty = false
    rebuildCount++
  }

  function ensureTargets(width, height) {
    if (width !== targetWidth || height !== targetHeight) {
      targetWidth = width
      targetHeight = height
      pool.resize(width, height)
    }
    if (targetsReady) return
    for (const slot of slots) slot.target = pool.acquire(slot.descriptor)
    targetsReady = true
  }

  /** Run one frame: extract every pass, prepare every pass, then execute. */
  function run(camera, target, width, height) {
    if (dirty) rebuild()
    ensureTargets(width, height)
    frame.camera = camera
    frame.target = target
    frame.width = width
    frame.height = height
    for (let i = 0; i < order.length; i++) if (order[i].extract) order[i].extract(frame, sink)
    for (let i = 0; i < order.length; i++) if (order[i].prepare) order[i].prepare(frame)
    for (let i = 0; i < order.length; i++) {
      if (order[i].depth === 'clear') clearDepth()
      order[i].execute(frame, targets)
    }
  }

  return {
    /** Insert a record, or replace the one under that name. */
    add(record) {
      if (typeof record?.name !== 'string' || !record.name || typeof record.execute !== 'function') {
        report(`[render] graph.add: needs a name and an execute function, got ${JSON.stringify(record?.name)}`)
        return
      }
      records.set(record.name, normalise(record))
      dirty = true
    },
    remove(name) {
      if (records.delete(name)) dirty = true
    },
    /** Swap the draw at a label, keeping that label's edges. */
    replace(name, record) {
      const existing = records.get(name)
      if (!existing) {
        report(`[render] graph.replace: no pass called ${JSON.stringify(name)}`)
        return
      }
      if (typeof record?.execute !== 'function') {
        report(
          `[render] graph.replace: needs an execute function for "${name}", got ${JSON.stringify(record?.execute)}`
        )
        return
      }
      const next = normalise({ ...record, name })
      next.after = existing.after.length ? existing.after : next.after
      next.before = existing.before.length ? existing.before : next.before
      records.set(name, next)
      dirty = true
    },
    disable(name) {
      const pass = records.get(name)
      if (pass) {
        pass.enabled = false
        dirty = true
      }
    },
    enable(name) {
      const pass = records.get(name)
      if (pass) {
        pass.enabled = true
        dirty = true
      }
    },
    /** The live passes in run order, rebuilt only when the pass set changed. */
    get passes() {
      if (dirty) rebuild()
      return order
    },
    get rebuilds() {
      return rebuildCount
    },
    run,
    frame,
    targets,
    pool,
    resize(width, height) {
      targetWidth = width
      targetHeight = height
      pool.resize(width, height)
    }
  }
}
