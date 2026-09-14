/**
 * Reading a Blender graph is where a translator goes wrong silently.
 *
 * A Math node's three inputs are all named "Value" and a Mix node's are all
 * named "A" and "B", so a reader keyed on names finds one socket and builds a
 * shader from defaults — which draws, and looks nearly right. These cases hold
 * the reader to addressing by position.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inputIndex, linkIndex, linkInto, missingImages, ownValue, surfaceNode, unknownTypes
} from '../plugins/builtin/blender-shaders/graph.js'

/** A Math node multiplying a fresnel by 0.8, wired into a Principled. */
const graph = {
  nodes: {
    Output: { type: 'OUTPUT_MATERIAL', inputs: [{ name: 'Surface', value: null }], outputs: [] },
    Principled: {
      type: 'BSDF_PRINCIPLED',
      inputs: [
        { name: 'Base Color', value: [0.8, 0.8, 0.8, 1] },
        { name: 'Metallic', value: 0 },
        { name: 'Roughness', value: 0.5 }
      ],
      outputs: ['BSDF']
    },
    Math: {
      type: 'MATH',
      inputs: [{ name: 'Value', value: 0.5 }, { name: 'Value', value: 0.8 }, { name: 'Value', value: 0.5 }],
      outputs: ['Value'],
      properties: { operation: 'MULTIPLY' }
    },
    Fresnel: { type: 'FRESNEL', inputs: [{ name: 'IOR', value: 1.5 }], outputs: ['Fac'] },
    Ramp: {
      type: 'VALTORGB',
      inputs: [{ name: 'Factor', value: 0.5 }],
      outputs: ['Color', 'Alpha'],
      properties: { stops: [], interpolation: 'LINEAR' }
    }
  },
  links: [
    { fromNode: 'Principled', fromSocket: 'BSDF', fromIndex: 0, toNode: 'Output', toSocket: 'Surface', toIndex: 0 },
    { fromNode: 'Fresnel', fromSocket: 'Fac', fromIndex: 0, toNode: 'Math', toSocket: 'Value', toIndex: 0 },
    { fromNode: 'Math', fromSocket: 'Value', fromIndex: 0, toNode: 'Principled', toSocket: 'Roughness', toIndex: 2 },
    { fromNode: 'Ramp', fromSocket: 'Color', fromIndex: 0, toNode: 'Principled', toSocket: 'Base Color', toIndex: 0 }
  ]
}

test('the surface is read from the Material Output, not by finding a Principled', () => {
  assert.equal(surfaceNode(graph), 'Principled')
})

test('a graph with nothing wired to the output has no surface', () => {
  assert.equal(surfaceNode({ nodes: { Output: { type: 'OUTPUT_MATERIAL', inputs: [] } }, links: [] }), null)
})

test('three inputs all named Value are told apart by position', () => {
  const math = graph.nodes.Math
  assert.equal(ownValue(math, 0), 0.5)
  assert.equal(ownValue(math, 1), 0.8)
  assert.equal(ownValue(math, 2), 0.5)
})

test('a link into the first Value is not found on the second', () => {
  const index = linkIndex(graph)
  assert.equal(linkInto(index, graph, 'Math', 0).node, 'Fresnel')
  assert.equal(linkInto(index, graph, 'Math', 1), null)
})

test('a socket renamed between Blender versions is still found', () => {
  // Blender 5 calls a colour ramp's input Factor; earlier versions called it Fac.
  assert.equal(inputIndex(graph.nodes.Ramp, 'Fac'), 0)
  assert.equal(inputIndex(graph.nodes.Ramp, 'Factor'), 0)
})

test('an input that is not there answers -1, not 0', () => {
  assert.equal(inputIndex(graph.nodes.Fresnel, 'Roughness'), -1)
  assert.equal(ownValue(graph.nodes.Fresnel, 'Roughness'), null)
})

test('a name resolves to the first socket with it', () => {
  assert.equal(inputIndex(graph.nodes.Principled, 'Roughness'), 2)
  assert.equal(linkInto(linkIndex(graph), graph, 'Principled', 'Roughness').node, 'Math')
})

test('every node type a graph needs is reported, and the output is not one', () => {
  assert.deepEqual(unknownTypes(graph, ['BSDF_PRINCIPLED', 'MATH', 'FRESNEL', 'VALTORGB']), [])
  assert.deepEqual(unknownTypes(graph, ['BSDF_PRINCIPLED', 'MATH']), ['FRESNEL', 'VALTORGB'])
})

test('an image the graph samples but nobody exported is reported', () => {
  const withImage = {
    nodes: { Picture: { type: 'TEX_IMAGE', inputs: [], outputs: ['Color'], properties: { image: 'bark' } } },
    links: []
  }
  assert.deepEqual(missingImages(withImage, {}), ['bark'])
  assert.deepEqual(missingImages(withImage, { bark: 'tree.textures/bark.png' }), [])
})

/**
 * Every listed type must build. A TSL name spelt wrong, or a node reading an
 * input the wrong way, throws only when that node is used — so a table entry
 * nobody's test material happened to include would ship broken.
 */
test('every translatable node type builds a material without throwing', async () => {
  const THREE = await import('three/webgpu')
  const TSL = await import('three/tsl')
  const { buildMaterial } = await import('../plugins/builtin/blender-shaders/build.js')
  const { toolkit, TRANSLATABLE_TYPES } = await import('../plugins/builtin/blender-shaders/nodes.js')

  assert.deepEqual([...TRANSLATABLE_TYPES].sort(), Object.keys(toolkit(TSL).NODES).sort(),
    'TRANSLATABLE_TYPES and the table must list the same types')

  const texture = new THREE.Texture()
  const shaders = new Set(['BSDF_PRINCIPLED', 'EMISSION', 'BSDF_DIFFUSE', 'BSDF_GLOSSY',
    'BSDF_TRANSPARENT', 'BSDF_GLASS', 'BSDF_TRANSLUCENT', 'BACKGROUND', 'MIX_SHADER', 'ADD_SHADER'])

  for (const type of TRANSLATABLE_TYPES) {
    const tested = {
      type,
      inputs: [
        { name: 'Vector', value: [0.1, 0.2, 0.3] }, { name: 'Color', value: [0.5, 0.4, 0.3, 1] },
        { name: 'Fac', value: 0.5 }, { name: 'Scale', value: 5 }, { name: 'Strength', value: 1 }
      ],
      outputs: ['Color'],
      properties: { image: 'picture', stops: [{ position: 0, colour: [0, 0, 0, 1] }, { position: 1, colour: [1, 1, 1, 1] }], curves: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]], value: 0.5 }
    }
    const graph = shaders.has(type)
      ? {
          nodes: { Output: { type: 'OUTPUT_MATERIAL', inputs: [{ name: 'Surface' }], outputs: [] }, Tested: tested },
          links: [{ fromNode: 'Tested', fromSocket: 'BSDF', fromIndex: 0, toNode: 'Output', toSocket: 'Surface', toIndex: 0 }]
        }
      : {
          nodes: {
            Output: { type: 'OUTPUT_MATERIAL', inputs: [{ name: 'Surface' }], outputs: [] },
            Principled: { type: 'BSDF_PRINCIPLED', inputs: [{ name: 'Base Color', value: [0.8, 0.8, 0.8, 1] }], outputs: ['BSDF'] },
            Tested: tested
          },
          links: [
            { fromNode: 'Principled', fromSocket: 'BSDF', fromIndex: 0, toNode: 'Output', toSocket: 'Surface', toIndex: 0 },
            { fromNode: 'Tested', fromSocket: 'Color', fromIndex: 0, toNode: 'Principled', toSocket: 'Base Color', toIndex: 0 }
          ]
        }
    let result
    assert.doesNotThrow(() => { result = buildMaterial(THREE, TSL, graph, { textureFor: () => texture }) }, type)
    assert.ok(result.material, `${type} built no material`)
    assert.deepEqual(result.missing, [], type)
  }
})

test('an opaque Principled stays opaque', async () => {
  const THREE = await import('three/webgpu')
  const TSL = await import('three/tsl')
  const { buildMaterial } = await import('../plugins/builtin/blender-shaders/build.js')
  assert.equal(buildMaterial(THREE, TSL, graph).material.transparent, false)
})
