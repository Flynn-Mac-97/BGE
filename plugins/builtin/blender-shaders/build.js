/**
 * Walk a dumped Blender graph and build the material it describes.
 *
 * The walk is here and the maths is in `nodes.js`, so adding a Blender node
 * means one entry in that table and nothing here.
 *
 * Values are computed once per output socket and reused, because a graph is a
 * network rather than a tree: one noise feeding a colour and a roughness must
 * be the same noise, not two.
 */
import { linkIndex, linkInto, ownValue, surfaceNode } from './graph.js'
import { toolkit } from './nodes.js'

/**
 * Build one material from one graph.
 *
 * `textureFor(name)` gives the THREE.Texture a Texture Image node names.
 * Returns the material and the node types it met but could not translate.
 */
export function buildMaterial(THREE, TSL, graph, { textureFor } = {}) {
  const { NODES, constant, asSurface, part } = toolkit(TSL, { textureFor })
  const index = linkIndex(graph)
  const computed = new Map()
  const missing = new Set()

  /** One node's output. Computed once per output position. */
  function evaluate(nodeName, socket) {
    // Keyed by position: a Mix node's four outputs are all "Result".
    const key = `${nodeName} ${socket.index}`
    if (computed.has(key)) return computed.get(key)

    const node = graph.nodes?.[nodeName]
    const build = node && NODES[node.type]
    if (!build) {
      if (node) missing.add(node.type)
      return constant(0)
    }

    // Set before the build so a cycle answers instead of recursing forever.
    // Blender refuses to make one; a hand-edited file can.
    computed.set(key, constant(0))

    const read = wanted => {
      const link = linkInto(index, graph, nodeName, wanted)
      if (link) return evaluate(link.node, { name: link.socket, index: link.index })
      const own = ownValue(node, wanted)
      const made = constant(own)
      // A few inputs — a noise's detail, its lacunarity — decide how many
      // octaves to build, so the plain number is kept beside the node.
      if (typeof own === 'number') made.constant = own
      return made
    }
    const linked = wanted => !!linkInto(index, graph, nodeName, wanted)

    const result = build(read, node.properties || {}, socket, linked)
    computed.set(key, result)
    return result
  }

  const surfaceName = surfaceNode(graph)
  if (!surfaceName) {
    return { material: null, missing: [...missing], why: 'nothing is wired to the Material Output' }
  }

  const node = graph.nodes[surfaceName]
  const result = asSurface(evaluate(surfaceName, { name: node.outputs?.[0], index: 0 }))

  const material = new THREE.MeshStandardNodeMaterial()
  material.colorNode = part(result, 'colour')
  material.roughnessNode = part(result, 'roughness')
  material.metalnessNode = part(result, 'metallic')
  material.emissiveNode = part(result, 'emission')
  const normal = part(result, 'normal')
  if (normal) material.normalNode = normal

  // Transparent only when the graph can make it so. Sorting every opaque
  // surface as transparent costs draw order and depth for nothing.
  if (result.alpha) {
    material.opacityNode = result.alpha
    material.transparent = true
  }

  return { material, missing: [...missing] }
}
