/**
 * Reading a dumped Blender node graph. No TSL, no three, no DOM.
 *
 * The graph is what `blender.import` wrote beside the model: every node with
 * its own values and properties, and every link. This file answers only "what
 * is plugged into this socket" and "which node is the surface", so the
 * translation table beside it holds nothing but node maths.
 *
 * Sockets are addressed by POSITION, not by name. A Math node's three inputs
 * are all called "Value", so a name is not an address.
 */

/**
 * Socket names Blender has changed between versions.
 *
 * A translator keyed on one spelling stops finding the socket when Blender
 * renames it, and the symptom is a shader built from defaults.
 */
const ALSO_CALLED = {
  Fac: ['Factor'],
  Factor: ['Fac'],
  Color: ['Colour'],
  Color1: ['A'],
  Color2: ['B'],
  'Base Color': ['Base Colour'],
  'Emission Color': ['Emission', 'Emission Colour']
}

/** Every spelling of one socket name, best first. */
const spellings = name => [name, ...(ALSO_CALLED[name] || [])]

/** Which input position a name refers to, or -1. */
export function inputIndex(node, wanted) {
  if (typeof wanted === 'number') return wanted
  for (const name of spellings(wanted)) {
    const at = (node?.inputs || []).findIndex(socket => socket.name === name)
    if (at >= 0) return at
  }
  return -1
}

/** What is plugged into each input, keyed `node position`. */
export function linkIndex(graph) {
  const index = new Map()
  for (const link of graph.links || []) {
    index.set(`${link.toNode} ${link.toIndex}`, {
      node: link.fromNode, socket: link.fromSocket, index: link.fromIndex
    })
  }
  return index
}

/** The link into one input, or null. `wanted` is a name or a position. */
export function linkInto(index, graph, nodeName, wanted) {
  const at = inputIndex(graph.nodes?.[nodeName], wanted)
  return at < 0 ? null : index.get(`${nodeName} ${at}`) || null
}

/** An input's own value, used when nothing is plugged into it. */
export function ownValue(node, wanted) {
  const at = inputIndex(node, wanted)
  return at < 0 ? null : (node?.inputs?.[at]?.value ?? null)
}

/**
 * The node that decides the surface.
 *
 * Read from the Material Output rather than by looking for a Principled BSDF:
 * a file may hold several, and only the one wired to the output draws.
 */
export function surfaceNode(graph) {
  const index = linkIndex(graph)
  for (const name of Object.keys(graph.nodes || {})) {
    if (graph.nodes[name].type !== 'OUTPUT_MATERIAL') continue
    const link = linkInto(index, graph, name, 'Surface')
    if (link) return link.node
  }
  return null
}

/**
 * Every node type in a graph the table cannot translate.
 *
 * Named rather than skipped: a node quietly dropped is a shader that builds and
 * looks wrong, with nothing saying which node was missing.
 */
export function unknownTypes(graph, known) {
  const found = new Set()
  for (const node of Object.values(graph.nodes || {})) {
    if (node.type === 'OUTPUT_MATERIAL') continue
    if (!known.includes(node.type)) found.add(node.type)
  }
  return [...found].sort()
}

/**
 * Every image a graph samples that was not written out beside the model.
 *
 * A Texture Image node with no image to read draws flat grey, so a graph
 * needing one is left on the material the `.glb` carried.
 */
export function missingImages(graph, textures = {}) {
  const found = new Set()
  for (const node of Object.values(graph.nodes || {})) {
    if (node.type !== 'TEX_IMAGE') continue
    const name = node.properties?.image
    if (!name || !textures[name]) found.add(name || 'an empty Texture Image node')
  }
  return [...found].sort()
}
