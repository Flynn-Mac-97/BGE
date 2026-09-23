/**
 * The pass graph's cull: a pass that writes something nothing reads is dropped,
 * a pass the graph cannot reason about always runs, and `replace` puts a new
 * draw at a label so the core draw underneath it does not run.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../engine/render/graph.js'

const noop = () => {}
const names = graph => graph.passes.map(pass => pass.name)

test('a pass writing a resource nothing reads is culled', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  graph.add({ name: 'producer', writes: ['buffer'], target: { format: 'half-float' }, execute: () => ran.push('producer') })
  graph.add({ name: 'present', execute: () => ran.push('present') })
  graph.run(null, null, 8, 8)
  assert.deepEqual(names(graph), ['present'])
  assert.deepEqual(ran, ['present'])
})

test('a pass with no declared resources always runs', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  graph.add({ name: 'plain', execute: () => ran.push('plain') })
  graph.add({ name: 'present', execute: () => ran.push('present') })
  graph.run(null, null, 8, 8)
  assert.deepEqual(ran, ['plain', 'present'])
})

test('a screen pass that reads a resource keeps the pass that writes it', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  graph.add({ name: 'producer', writes: ['buffer'], target: { format: 'half-float' }, execute: () => ran.push('producer') })
  graph.add({ name: 'consumer', reads: ['buffer'], execute: () => ran.push('consumer') })
  graph.run(null, null, 8, 8)
  assert.deepEqual(ran, ['producer', 'consumer'], 'the reader makes its producer worth running')
})

test('a private dependency dies with the pass that needed it', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  graph.add({ name: 'first', writes: ['a'], target: { format: 'half-float' }, execute: () => ran.push('first') })
  graph.add({ name: 'second', writes: ['b'], reads: ['a'], target: { format: 'half-float' }, execute: () => ran.push('second') })
  graph.add({ name: 'present', execute: () => ran.push('present') })
  graph.run(null, null, 8, 8)
  assert.deepEqual(ran, ['present'], 'nothing reads b, so second is dead and first dies with it')
})

test('replace puts a new draw at a label and the core draw does not run', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  graph.add({ name: 'clear', writes: ['sceneColour'], execute: () => ran.push('clear') })
  graph.add({ name: 'scene', after: ['clear'], writes: ['sceneColour'], execute: () => ran.push('scene') })
  graph.add({ name: 'ui', after: ['scene'], reads: ['sceneColour'], execute: () => ran.push('ui') })
  graph.add({ name: 'present', after: ['ui'], execute: () => ran.push('present') })

  graph.replace('scene', { writes: ['sceneColour'], execute: () => ran.push('raytrace') })
  graph.run(null, null, 8, 8)

  assert.ok(!ran.includes('scene'), 'the kernel scene draw never ran')
  assert.deepEqual(ran, ['clear', 'raytrace', 'ui', 'present'], 'the raytracer drew at the scene label')
})

test('replace keeps the label edges, so passes ordered around the label stay around it', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'before', execute: noop })
  graph.add({ name: 'scene', after: ['before'], execute: noop })
  graph.add({ name: 'after', after: ['scene'], execute: noop })
  graph.replace('scene', { execute: noop })
  assert.deepEqual(names(graph), ['before', 'scene', 'after'])
})

test('disable means a core pass does not run and its neighbours still do', () => {
  const graph = makePassGraph({ report: noop })
  const ran = []
  graph.add({ name: 'clear', before: ['scene'], execute: () => ran.push('clear') })
  graph.add({ name: 'scene', after: ['clear'], execute: () => ran.push('scene') })
  graph.add({ name: 'present', after: ['scene'], execute: () => ran.push('present') })
  graph.disable('scene')
  graph.run(null, null, 8, 8)
  assert.deepEqual(ran, ['clear', 'present'])
})

test('a pass whose required feature is missing is dropped', () => {
  const graph = makePassGraph({ report: noop, hasFeature: name => name === 'render' })
  const ran = []
  graph.add({ name: 'compute', requires: ['timestamp-query'], execute: () => ran.push('compute') })
  graph.add({ name: 'present', execute: () => ran.push('present') })
  graph.run(null, null, 8, 8)
  assert.deepEqual(ran, ['present'])
})
