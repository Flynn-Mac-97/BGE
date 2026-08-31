/**
 * Scatter — bulk placement, declared in the level and grown from a rule.
 *
 * A hedgerow is thirty placements, a fence forty, a field of tufts two hundred.
 * Written out by hand that is transcription, and a transcribed field comes out
 * in rows because nobody invents two hundred unbiased numbers. This is the
 * engine's answer, so no game needs a build script to emit placements.
 *
 * The keys, their shapes, units and defaults are the table in scatter.agent.md.
 *
 * A scatter is an ENTITY, `type: "scatter"`, so the rule is level data: the
 * inspector tunes it, dragging the marker moves the whole field, and a level
 * diff shows the decision. The type is registered here rather than in a
 * project's `types/`, because bulk placement is an engine capability. The cost
 * is the one Lights pays: it is not in the Project panel and cannot be dragged
 * in from there.
 *
 * WHEN THE FIELD EXISTS. The type's `start` hook grows it, so it appears with
 * the clock — on play and on `simulate` — and never reaches a level file. A
 * level records start positions, and a grown field saved into one doubles on the
 * next load. `scatter.preview` grows it in the editor to look at, and marks the
 * world simulated, which is what stops a save. `scatter.expand` is the other
 * door: it writes the field out as real placements and removes the marker, and
 * the level then holds ordinary entities anybody can nudge.
 *
 * DETERMINISM. Every number comes from `context.random`, which a level load
 * reseeds, so one seed grows one field for ever. It is the level's single
 * simulation stream, so adding or retuning a scatter moves every draw made after
 * it in level order. Sampling spends two draws per attempt and four per
 * placement, so the draw count is a function of the rule alone.
 */

/** Attempts one placement gets before the rule is reported as too tight. */
const DEFAULT_TRIES = 30

/**
 * The scatter type: the rule, and the inspector schema, in one place.
 *
 * Every dial deciding density and spacing is a plain number, because the
 * inspector renders one text field per property and only a scalar survives being
 * typed into one. `clear` and `corridors` are lists, written in the level file.
 * The marker mesh gives the field something to drag.
 */
export const SCATTER_TYPE = {
  mesh: { box: [0.4, 0.4, 0.4], tint: '#8ad1a0', unlit: true },
  properties: {
    of: '',
    count: 0,
    density: 0,
    area: 'box',
    width: 20,
    depth: 20,
    radius: 10,
    inner: 0,
    apart: 0,
    clear: [],
    corridors: [],
    yaw: [0, 360],
    scale: 1,
    y: 0,
    sit: true,
    tries: DEFAULT_TRIES
  },

  // The hooks reach the plugin through the context they are handed, so nothing
  // here holds a second copy of its state.
  start(entity, context) { context.scatter?.grow(entity) },
  onDestroy(entity, context) { context.scatter?.drop(entity.id) }
}

// ------------------------------------------------------------------ reading
function readNumber(value, fallback, least = -Infinity) {
  if (value === null || value === undefined || value === '') return fallback
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.max(least, amount) : fallback
}

/** `2`, `"2"` or `[least, most]`, reduced to a pair. One value is a pair of itself. */
function readPair(value, fallback) {
  if (Array.isArray(value)) {
    const least = readNumber(value[0], fallback[0])
    const most = readNumber(value[1], least)
    return least <= most ? [least, most] : [most, least]
  }
  const one = readNumber(value, null)
  return one === null ? fallback : [one, one]
}

/** What a placement is made of: which type, how often it comes up, what it overrides. */
function readEntries(value, types, say, where) {
  const listed = typeof value === 'string' ? value.split(',') : [].concat(value ?? [])
  const entries = []
  for (const item of listed) {
    const entry = typeof item === 'string' ? { type: item } : { ...(item || {}) }
    entry.type = String(entry.type ?? '').trim()
    if (!entry.type) continue
    if (types && !types.has(entry.type)) {
      say(`[Scatter] ${where}: no type "${entry.type}" — nothing of it is placed`)
      continue
    }
    entry.weight = readNumber(entry.weight, 1, 0)
    // Half of this is what `sit` lifts by. The entry's own mesh wins over the
    // type's, because that is the box the renderer draws.
    const box = entry.mesh?.box ?? types?.get(entry.type)?.mesh?.box
    entry.height = readNumber(Array.isArray(box) ? box[1] : null, 0, 0)
    entries.push(entry)
  }
  return entries
}

/** Circles nothing may land in, in world plan coordinates. */
function readClear(value, entities, say, where) {
  const circles = []
  for (const item of [].concat(value ?? [])) {
    if (!item || typeof item !== 'object') continue
    const radius = readNumber(item.radius, 0, 0)
    if (!(radius > 0)) {
      say(`[Scatter] ${where}: a clear circle needs a radius in metres — ${JSON.stringify(item)} keeps nothing clear`)
      continue
    }
    if (item.type) {
      for (const entity of entities || []) {
        if (entity.type === item.type) circles.push({ x: entity.x, z: entity.z, radius })
      }
      continue
    }
    const at = Array.isArray(item.at) ? item.at : []
    circles.push({ x: readNumber(at[0], 0), z: readNumber(at[1], 0), radius })
  }
  return circles
}

/** Lanes nothing may land in: a plan polyline, and the full width kept clear. */
function readCorridors(value, say, where) {
  const lanes = []
  for (const item of [].concat(value ?? [])) {
    const path = (Array.isArray(item?.path) ? item.path : [])
      .filter(point => Array.isArray(point) && point.length >= 2)
      .map(point => [readNumber(point[0], 0), readNumber(point[1], 0)])
    const width = readNumber(item?.width, 0, 0)
    if (!path.length || !(width > 0)) {
      say(`[Scatter] ${where}: a corridor needs a path of [x, z] points and a width in metres`)
      continue
    }
    lanes.push({ path, width })
  }
  return lanes
}

/** Square metres the area covers. What `density` is multiplied by. */
export function areaSize({ area, width, depth, radius, inner }) {
  if (area === 'disc') return Math.PI * radius * radius
  if (area === 'ring') return Math.PI * Math.max(0, radius * radius - inner * inner)
  return width * depth
}

/**
 * What one scatter entity MEANS, with every value checked. Pure but for two
 * readings off the world — which types exist, and where the entities a
 * `{ type, radius }` circle names stand. `world` is optional for both.
 */
export function readRule(entity, world = null, say = () => {}) {
  const declared = entity.properties || {}
  const defaults = SCATTER_TYPE.properties
  const where = entity.id
  const rule = {
    id: entity.id,
    at: [entity.x || 0, entity.y || 0, entity.z || 0],
    entries: readEntries(declared.of ?? defaults.of, world?.types, say, where),
    area: ['box', 'disc', 'ring'].includes(declared.area) ? declared.area : defaults.area,
    width: readNumber(declared.width, defaults.width, 0),
    depth: readNumber(declared.depth, defaults.depth, 0),
    radius: readNumber(declared.radius, defaults.radius, 0),
    inner: readNumber(declared.inner, defaults.inner, 0),
    apart: readNumber(declared.apart, defaults.apart, 0),
    clear: readClear(declared.clear, world?.entities, say, where),
    corridors: readCorridors(declared.corridors, say, where),
    yaw: readPair(declared.yaw, defaults.yaw),
    scale: readPair(declared.scale, [1, 1]),
    y: readPair(declared.y, [0, 0]),
    sit: declared.sit !== false,
    tries: Math.max(1, Math.round(readNumber(declared.tries, defaults.tries, 1)))
  }
  // A ring whose hole is wider than the ring would place nothing and say
  // nothing, so the two are swapped.
  if (rule.inner > rule.radius) [rule.inner, rule.radius] = [rule.radius, rule.inner]
  const exact = Math.round(readNumber(declared.count, 0, 0))
  rule.count = exact || Math.round(readNumber(declared.density, defaults.density, 0) * areaSize(rule))
  return rule
}

// ------------------------------------------------------------------ growing
/** Shortest distance from a plan point to a polyline. A one-point path is the point. */
export function distanceToPath(path, x, z) {
  if (path.length === 1) return Math.hypot(x - path[0][0], z - path[0][1])
  let best = Infinity
  for (let index = 0; index < path.length - 1; index++) {
    const [fromX, fromZ] = path[index]
    const [toX, toZ] = path[index + 1]
    const runX = toX - fromX
    const runZ = toZ - fromZ
    const span = runX * runX + runZ * runZ
    const along = span ? Math.max(0, Math.min(1, ((x - fromX) * runX + (z - fromZ) * runZ) / span)) : 0
    best = Math.min(best, Math.hypot(x - (fromX + runX * along), z - (fromZ + runZ * along)))
  }
  return best
}

/**
 * The minimum-spacing test, over a grid of cells one `apart` across. Anything
 * closer than `apart` is in this cell or one of the eight around it, so a field
 * of two thousand costs a handful of comparisons per attempt.
 */
function makeSpacing(apart) {
  if (!(apart > 0)) return { free: () => true, add: () => {} }
  const cells = new Map()
  const cellOf = value => Math.floor(value / apart)
  return {
    free(x, z) {
      const atX = cellOf(x)
      const atZ = cellOf(z)
      for (let cellX = atX - 1; cellX <= atX + 1; cellX++) {
        for (let cellZ = atZ - 1; cellZ <= atZ + 1; cellZ++) {
          for (const [otherX, otherZ] of cells.get(`${cellX},${cellZ}`) || []) {
            if (Math.hypot(x - otherX, z - otherZ) < apart) return false
          }
        }
      }
      return true
    },
    add(x, z) {
      const key = `${cellOf(x)},${cellOf(z)}`
      const held = cells.get(key) || []
      held.push([x, z])
      cells.set(key, held)
    }
  }
}

/** One point in the area, in world plan coordinates. Two draws, whatever the shape. */
function pointInArea(rule, draw) {
  const [centreX, , centreZ] = rule.at
  if (rule.area === 'box') {
    return [centreX + draw(-rule.width / 2, rule.width / 2), centreZ + draw(-rule.depth / 2, rule.depth / 2)]
  }
  const angle = draw(0, Math.PI * 2)
  const inner = rule.area === 'ring' ? rule.inner : 0
  // The square root is what keeps a disc even. Without it the middle takes far
  // more than its share and the field reads as a target.
  const reach = Math.sqrt(inner * inner + (rule.radius * rule.radius - inner * inner) * draw(0, 1))
  return [centreX + Math.cos(angle) * reach, centreZ + Math.sin(angle) * reach]
}

/** A free point, or null once `tries` attempts have all been rejected. */
function findSpot(rule, draw, spacing) {
  for (let attempt = 0; attempt < rule.tries; attempt++) {
    const [x, z] = pointInArea(rule, draw)
    if (rule.clear.some(circle => Math.hypot(x - circle.x, z - circle.z) < circle.radius)) continue
    if (rule.corridors.some(lane => distanceToPath(lane.path, x, z) < lane.width / 2)) continue
    if (!spacing.free(x, z)) continue
    spacing.add(x, z)
    return [x, z]
  }
  return null
}

/** Which type this placement is, by weight. One draw, whatever the list. */
function pickEntry(entries, roll) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  // All weights zero would divide by nothing, so an even pick stands in.
  let wanted = total > 0 ? roll * total : roll * entries.length
  for (const entry of entries) {
    wanted -= total > 0 ? entry.weight : 1
    if (wanted < 0) return entry
  }
  return entries[entries.length - 1]
}

/**
 * The field one rule describes. Pure: a rule and a source of numbers in,
 * placements out, nothing spawned. `random` is any function returning 0 to 1 —
 * `context.random` in the engine, a seeded stream in a test. Rejection sampling,
 * not a grid: a grid is what makes a hand-built field read as rows.
 */
export function growField(rule, random) {
  const draw = (least, most) => least + random() * (most - least)
  const spacing = makeSpacing(rule.apart)
  const placements = []
  if (!rule.entries.length) return { placements, asked: rule.count, placed: 0 }

  for (let index = 0; index < rule.count; index++) {
    const spot = findSpot(rule, draw, spacing)
    if (!spot) continue
    const entry = pickEntry(rule.entries, draw(0, 1))
    const rotation = draw(rule.yaw[0], rule.yaw[1])
    const scale = draw(rule.scale[0], rule.scale[1])
    const height = rule.at[1] + draw(rule.y[0], rule.y[1]) + (rule.sit ? entry.height * scale / 2 : 0)
    const placement = {
      // Position in the field, so an id survives a regrow and a diff of an
      // expanded level names the placement that moved.
      id: `${rule.id}-${placements.length + 1}`,
      type: entry.type,
      at: [round(spot[0]), round(height), round(spot[1])],
      rotation: round(rotation),
      scale: round(scale)
    }
    if (entry.mesh) placement.mesh = entry.mesh
    if (entry.properties) placement.properties = entry.properties
    placements.push(placement)
  }
  return { placements, asked: rule.count, placed: placements.length }
}

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Scatter',

  about: 'Bulk placement declared in the level: this many of these types, over this area, this far ' +
    'apart, out of these circles and corridors. A scatter is an entity, so the rule is level data the ' +
    'inspector tunes. The field grows with the clock and is never saved into the level; scatter.expand ' +
    'turns it into real placements to nudge by hand.',

  onLoad(context) {
    /** scatter id -> { rule, placements, ids, asked, placed }. `ids` is empty when nothing is up. */
    const fields = new Map()
    const said = new Set()
    const say = message => {
      if (said.has(message)) return
      said.add(message)
      console.error(message)
    }
    /** True while a preview is what set world.simulated, so clearing can put it back. */
    let markedByPreview = false

    context.bus.on('level:loaded', () => {
      // Synchronous, before anything awaits: loadTypes() cleared this type out at
      // boot and the level's scatter entities are already spawned with no
      // definition behind them. retype puts both right in one call.
      context.world.retype('scatter', SCATTER_TYPE)
      fields.clear()
      markedByPreview = false
    })
    context.bus.on('world:cleared', () => { fields.clear(); markedByPreview = false })

    const markers = id => {
      if (!id) return context.world.all('scatter')
      const entity = context.world.byId(id)
      if (!entity) throw new Error(`no entity "${id}"`)
      if (entity.type !== 'scatter') throw new Error(`${id} is a ${entity.type}, not a scatter`)
      return [entity]
    }

    /**
     * Put a field into the world. `world.spawn` and one `world:changed` at the
     * end, not `context.spawn`: that announces every entity, and two hundred
     * announcements is two hundred History snapshots of the whole level.
     */
    const spawnAll = placements => {
      const ids = []
      for (const placement of placements) ids.push(context.world.spawn(placement.type, placement).id)
      if (ids.length) context.bus.emit('world:changed')
      return ids
    }

    /** Take what is in the world out. The placements stay, so the same field can go back. */
    const takeDown = id => {
      const field = fields.get(id)
      if (!field?.ids.length) return 0
      let removed = 0
      for (const grown of field.ids) {
        const entity = context.world.byId(grown)
        if (!entity) continue
        context.world.destroy(entity)
        removed++
      }
      field.ids = []
      if (removed) context.bus.emit('world:changed')
      return removed
    }

    const grow = (entity, { hide = true } = {}) => {
      takeDown(entity.id)
      const rule = readRule(entity, context.world, say)
      const field = growField(rule, context.random)
      const record = { rule, ...field, ids: spawnAll(field.placements) }
      fields.set(entity.id, record)
      // The marker is an editing aid, so the clock hides it. A preview keeps it,
      // which is what leaves the field draggable.
      entity.hidden = hide
      if (record.placed < record.asked) {
        say(`[Scatter] ${entity.id} placed ${record.placed} of ${record.asked} — ${rule.tries} tries ` +
          `each is not enough at apart ${rule.apart} in this area. Widen the area, lower the count, or lower apart.`)
      }
      return record
    }

    context.scatter = {
      grow,
      /** What this rule resolves to, without growing anything. */
      rule: entity => readRule(entity, context.world, say),
      /** The field down and forgotten. The type's onDestroy hook. */
      drop: id => { const gone = takeDown(id); fields.delete(id); return gone },

      /**
       * Grow every field in the editor, to look at. A preview is not a start
       * position, so the world is marked simulated and the kernel then refuses to
       * save it: without that, an edit made while a preview is up writes the whole
       * field into the level file and the next load grows another on top of it.
       */
      preview(id) {
        if (!context.world.simulated) {
          context.world.simulated = true
          markedByPreview = true
        }
        return markers(id).map(entity => {
          const record = grow(entity, { hide: false })
          return describe(record.rule, record)
        })
      },

      /** Every preview down, and the save refusal lifted if this plugin caused it. */
      clear() {
        let removed = 0
        for (const key of [...fields.keys()]) removed += takeDown(key)
        if (markedByPreview) {
          context.world.simulated = false
          markedByPreview = false
        }
        context.bus.emit('world:changed')
        return { removed }
      },

      /**
       * Turn the field into real placements and remove the marker. A field
       * already grown is reused, so what a preview showed is what gets written.
       * The copies already up come down and the record is forgotten before the
       * new placements are spawned, so the marker's onDestroy hook has nothing
       * of theirs to chase.
       */
      expand(entity) {
        const record = fields.get(entity.id) || grow(entity)
        takeDown(entity.id)
        fields.delete(entity.id)
        const ids = spawnAll(record.placements)
        context.world.destroy(entity)
        context.bus.emit('world:changed')
        return { expanded: entity.id, placed: ids.length, ids }
      },

      list: () => report(context, fields)
    }
  },

  inspect: context => [{
    title: 'Scatters in this level',
    rows: context.world.all('scatter')
      .map(entity => [entity.id, `${entity.properties.of || 'nothing'} · ${entity.properties.count || entity.properties.density || 0}`])
  }],

  commands: [
    {
      id: 'scatter.list',
      label: 'Every scatter, what it resolves to, and how much of it is standing',
      run: context => context.scatter.list()
    },
    {
      id: 'scatter.preview',
      label: 'Grow the fields in the editor to look at — never saved',
      // args: { id } for one, nothing for all of them
      run: (context, args) => ({
        grown: context.scatter.preview(args?.id),
        note: 'the world is marked simulated so this cannot be saved into the level — scatter.clear puts it back'
      })
    },
    {
      id: 'scatter.clear',
      label: 'Take every previewed field back down',
      run: context => context.scatter.clear()
    },
    {
      id: 'scatter.expand',
      label: 'Write the field into the level as real placements, and remove the scatter',
      // args: { id } — one scatter, named
      run: async (context, args) => {
        if (context.loop.running) throw new Error('scatter.expand needs the clock stopped — a run is not an edit')
        if (!args?.id) throw new Error("scatter.expand names one scatter — run scatter.expand '{\"id\":\"tufts\"}'")
        const entity = context.world.byId(args.id)
        if (!entity) throw new Error(`no entity "${args.id}"`)
        // A preview marks the world simulated, which is also what stops the save
        // below. Clearing keeps the placements, so the same field is expanded.
        if (context.world.simulated) context.scatter.clear()
        if (context.world.simulated) {
          throw new Error('the world has been simulated, so it no longer holds start positions — engine.stop() first')
        }
        const out = context.scatter.expand(entity)
        await context.save()
        return { ...out, saved: !context.files.refused, ...(context.files.refused ? { refused: context.files.refused.why } : {}) }
      }
    }
  ]
}

/** One scatter, resolved, and how much of it is standing. */
function describe(rule, field) {
  return {
    id: rule.id,
    at: rule.at.map(round),
    of: rule.entries.map(entry => `${entry.type}${entry.weight === 1 ? '' : ` x${entry.weight}`}`),
    count: rule.count,
    area: rule.area === 'box' ? `box ${rule.width}x${rule.depth} m` : `${rule.area} ${rule.inner}-${rule.radius} m`,
    apart: rule.apart,
    keepingClear: rule.clear.length + rule.corridors.length,
    placed: field?.placed ?? null,
    standing: field?.ids.length ?? 0
  }
}

/** "Why is my field empty" has to be answerable from a terminal. */
function report(context, fields) {
  const scatters = context.world.all('scatter')
    .map(entity => describe(readRule(entity, context.world), fields.get(entity.id)))
  const short = scatters.filter(one => one.placed !== null && one.placed < one.count)
  return {
    level: context.level(),
    playing: context.loop.running,
    scatters,
    notes: [
      ...(scatters.length ? [] : ['this level declares no scatter — add an entity of type "scatter"']),
      ...(scatters.some(one => !one.of.length) ? ['a scatter with nothing in `of` places nothing; `errors` names the type it could not find'] : []),
      ...(short.length ? [`${short.map(one => one.id).join(', ')} placed fewer than asked — the rule is too tight for its area`] : [])
    ]
  }
}

const round = value => Math.round(value * 1000) / 1000
