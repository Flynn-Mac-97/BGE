/**
 * Draft model — the diagram as data, and the compact shapes an agent reads and
 * writes.
 *
 * Pure: no DOM and no engine imports, so a headless test runs the whole model.
 * A node holds one `text` field whatever its kind: words for a text, note or
 * group, the asset path for an image. One field means the read shape and the
 * write shape cannot drift.
 */

export const KINDS = ['text', 'note', 'image', 'group']

export const DEFAULT_WIDTH = { text: 180, note: 220, image: 220, group: 320 }
export const DEFAULT_HEIGHT = { text: 44, note: 60, image: 140, group: 180 }
export const PADDING = 10
export const LINE_HEIGHT = { text: 17, note: 15, image: 15, group: 15 }
export const FONT_SIZE = { text: 13, note: 12, image: 13, group: 12 }

/** A name an import can hold. Node ids and document ids both take this shape. */
export function slug(text) {
  return String(text ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
}

/** Text width when no canvas measured it. Close enough to place unmeasured geometry. */
export const roughMeasure = (text, size = 13) => String(text ?? '').length * size * 0.58

/** Break text at spaces and newlines to fit `width`. Empty paragraphs keep their line. */
export function wrapText(text, width, measure = roughMeasure, size = FONT_SIZE.text) {
  const lines = []
  for (const paragraph of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = words[0]
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`
      if (measure(candidate, size) <= width) line = candidate
      else { lines.push(line); line = word }
    }
    lines.push(line)
  }
  return lines.length ? lines : ['']
}

/** How tall a node draws. Images and groups hold a height; text nodes derive one. */
export function nodeHeight(node, measure = roughMeasure) {
  const width = node.w ?? DEFAULT_WIDTH[node.kind] ?? 180
  if (node.kind === 'group') return node.h ?? DEFAULT_HEIGHT.group
  if (node.kind === 'image') return node.h ?? DEFAULT_HEIGHT.image
  const size = FONT_SIZE[node.kind]
  const lines = wrapText(node.text, width - PADDING * 2, measure, size)
  return Math.max(DEFAULT_HEIGHT[node.kind], lines.length * LINE_HEIGHT[node.kind] + PADDING * 2)
}

/** The node's box in diagram space, top-left at `at`. */
export function nodeBox(node, measure = roughMeasure) {
  const w = node.w ?? DEFAULT_WIDTH[node.kind] ?? 180
  return { x: node.at[0], y: node.at[1], w, h: nodeHeight(node, measure) }
}

/** Below everything, so a node added by hand never lands on one already there. */
export function nextSpot(doc) {
  let bottom = 0
  for (const node of doc.nodes) {
    const h = node.h ?? DEFAULT_HEIGHT[node.kind] ?? 60
    bottom = Math.max(bottom, node.at[1] + h)
  }
  return [40, bottom ? bottom + 40 : 40]
}

/** Where a new box lands: the middle of what the person is looking at. */
export function focusSpot(state) {
  const size = state.stageSize ?? { width: 640, height: 420 }
  return [
    Math.round((size.width / 2 - state.view.x) / state.view.zoom - 90),
    Math.round((size.height / 2 - state.view.y) / state.view.zoom - 27)
  ]
}

/** Frame every box. Below this zoom a label is smaller than it is legible. */
export const FIT_MIN_ZOOM = 0.55

/** Set the view so every box is on screen, centred, and no smaller than legible. */
export function fitBoard(state) {
  const nodes = state.doc?.nodes ?? []
  const size = state.stageSize ?? { width: 640, height: 420 }
  if (!nodes.length) { state.view = { x: 0, y: 0, zoom: 1 }; return }
  const boxes = nodes.map((node) => nodeBox(node, roughMeasure))
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))
  const zoom = Math.min(2, Math.max(FIT_MIN_ZOOM,
    Math.min((size.width - 60) / (right - left), (size.height - 60) / (bottom - top))))
  state.view = {
    zoom,
    x: (size.width - (right - left) * zoom) / 2 - left * zoom,
    y: (size.height - (bottom - top) * zoom) / 2 - top * zoom
  }
}

function uniqueId(wanted, used) {
  const base = wanted || 'node'
  let id = base, n = 1
  while (used.has(id)) id = `${base}-${++n}`
  used.add(id)
  return id
}

function position(at, index) {
  const x = Array.isArray(at) ? Number(at[0]) : NaN
  const y = Array.isArray(at) ? Number(at[1]) : NaN
  if (Number.isFinite(x) && Number.isFinite(y)) return [Math.round(x), Math.round(y)]
  return [40 + (index % 3) * 280, 40 + Math.floor(index / 3) * 200]
}

/** One node from a tuple `[id, kind, text, at]` or an object. */
function nodeRecord(spec, index, used) {
  const given = Array.isArray(spec)
    ? { id: spec[0], kind: spec[1], text: spec[2], at: spec[3] }
    : (spec && typeof spec === 'object' ? spec : { text: spec })
  const kind = given.kind == null ? 'text' : String(given.kind)
  if (!KINDS.includes(kind)) throw new Error(`unknown node kind "${kind}" — use ${KINDS.join(', ')}`)
  const text = given.text == null ? '' : String(given.text)
  const node = {
    id: uniqueId(slug(given.id) || slug(text) || `node-${index + 1}`, used),
    kind,
    text,
    at: position(given.at, index)
  }
  if (given.w != null && Number.isFinite(Number(given.w)) && Number(given.w) > 0) node.w = Math.round(Number(given.w))
  if (given.h != null && Number.isFinite(Number(given.h)) && Number(given.h) > 0) node.h = Math.round(Number(given.h))
  if (given.colour) node.colour = String(given.colour)
  return node
}

const edgeRecord = (spec) => Array.isArray(spec)
  ? { from: String(spec[0]), to: String(spec[1]), text: spec[2] == null ? '' : String(spec[2]) }
  : { from: String(spec?.from), to: String(spec?.to), text: spec?.text == null ? '' : String(spec.text) }

const gavePosition = (spec) => Array.isArray(spec) ? spec[3] != null : Boolean(spec?.at)

/**
 * A document from a plan. `base` is the copy being replaced: a node that keeps
 * its id and gives no position keeps the position it had, so an agent editing
 * one node's words does not scatter the board a person arranged.
 */
export function docFromPlan(plan, base = null) {
  const previous = new Map((base?.nodes ?? []).map((node) => [node.id, node]))
  const used = new Set()
  const doc = { kind: 'draft', title: String(plan?.title ?? base?.title ?? 'Untitled'), nodes: [], edges: [] }
  for (const [index, spec] of (plan?.nodes ?? []).entries()) {
    const node = nodeRecord(spec, index, used)
    const was = previous.get(node.id)
    if (was) {
      if (!gavePosition(spec)) node.at = was.at.slice()
      if (node.w == null) node.w = was.w
      if (node.h == null) node.h = was.h
    }
    doc.nodes.push(node)
  }
  for (const spec of plan?.edges ?? []) addEdge(doc, edgeRecord(spec))
  return doc
}

/** A stored document with every field checked. A hand-edited file still opens. */
export function normalizeDoc(value) {
  return docFromPlan({ title: value?.title, nodes: value?.nodes ?? [], edges: value?.edges ?? [] })
}

export function addNode(doc, spec) {
  const used = new Set(doc.nodes.map((node) => node.id))
  const node = nodeRecord({ ...spec, at: spec.at ?? nextSpot(doc) }, doc.nodes.length, used)
  doc.nodes.push(node)
  return node
}

export function nodeById(doc, id) {
  return doc.nodes.find((node) => node.id === id) ?? null
}

const PATCH_TEXT = ['text', 'colour']

export function setNode(doc, id, patch) {
  const node = nodeById(doc, id)
  if (!node) throw new Error(`no node "${id}"`)
  if (patch.kind != null) {
    const kind = String(patch.kind)
    if (!KINDS.includes(kind)) throw new Error(`unknown node kind "${kind}" — use ${KINDS.join(', ')}`)
    node.kind = kind
  }
  for (const key of PATCH_TEXT) if (patch[key] != null) node[key] = String(patch[key])
  if (Array.isArray(patch.at) && patch.at.length >= 2) node.at = [Math.round(Number(patch.at[0])), Math.round(Number(patch.at[1]))]
  if (Number.isFinite(Number(patch.w)) && Number(patch.w) > 0) node.w = Math.round(Number(patch.w))
  if (Number.isFinite(Number(patch.h)) && Number(patch.h) > 0) node.h = Math.round(Number(patch.h))
  return node
}

export function addEdge(doc, edge) {
  if (!nodeById(doc, edge.from)) throw new Error(`edge from unknown node "${edge.from}"`)
  if (!nodeById(doc, edge.to)) throw new Error(`edge to unknown node "${edge.to}"`)
  if (edge.from === edge.to) throw new Error(`"${edge.from}" cannot point at itself`)
  if (doc.edges.some((existing) => existing.from === edge.from && existing.to === edge.to)) {
    throw new Error(`"${edge.from}" already points at "${edge.to}"`)
  }
  const used = new Set(doc.edges.map((existing) => existing.id))
  const record = { id: uniqueId('e', used), from: edge.from, to: edge.to }
  if (edge.text) record.text = String(edge.text)
  doc.edges.push(record)
  return record
}

/** Remove a node and every edge touching it. */
export function removeNode(doc, id) {
  if (!nodeById(doc, id)) throw new Error(`no node "${id}"`)
  doc.nodes = doc.nodes.filter((node) => node.id !== id)
  const dropped = doc.edges.filter((edge) => edge.from === id || edge.to === id).length
  doc.edges = doc.edges.filter((edge) => edge.from !== id && edge.to !== id)
  return { node: id, edges: dropped }
}

export function removeEdge(doc, id) {
  if (!doc.edges.some((edge) => edge.id === id)) throw new Error(`no edge "${id}"`)
  doc.edges = doc.edges.filter((edge) => edge.id !== id)
  return { edge: id }
}

/** Change an edge's label, or move which nodes it joins. */
export function setEdge(doc, id, patch) {
  const edge = doc.edges.find((entry) => entry.id === id)
  if (!edge) throw new Error(`no edge "${id}"`)
  if (patch.text != null) edge.text = String(patch.text)
  if (patch.from != null) edge.from = String(patch.from)
  if (patch.to != null) edge.to = String(patch.to)
  return edge
}

/** The plan shape `draft.read` returns and `draft.plan` accepts. */
export function toPlan(doc) {
  return {
    title: doc.title,
    nodes: doc.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      text: node.text,
      at: node.at,
      ...(node.w != null ? { w: node.w } : {}),
      ...(node.h != null ? { h: node.h } : {}),
      ...(node.colour ? { colour: node.colour } : {})
    })),
    edges: doc.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.text ? { text: edge.text } : {})
    }))
  }
}

const short = (text) => {
  const value = String(text ?? '')
  return value.length > 70 ? `${value.slice(0, 69)}…` : value
}

/** The diagram in words, for an agent that must not open the picture. */
export function outlineText(id, doc) {
  const pad = Math.max(4, ...doc.nodes.map((node) => node.id.length))
  const rows = doc.nodes.map((node) => {
    const where = `at ${node.at[0]},${node.at[1]}`
    return `  ${node.id.padEnd(pad)}  ${node.kind.padEnd(5)} ${where.padEnd(16)} ${JSON.stringify(short(node.text))}`
  })
  const edges = doc.edges.map((edge) => `  ${edge.from} -> ${edge.to}${edge.text ? `  ${JSON.stringify(short(edge.text))}` : ''}`)
  return [
    `draft "${doc.title}" id=${id} — ${doc.nodes.length} nodes, ${doc.edges.length} edges`,
    ...rows,
    ...(edges.length ? ['edges:', ...edges] : ['edges: none'])
  ].join('\n')
}
