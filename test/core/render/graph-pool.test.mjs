/**
 * The target pool and the graph's resource planning: equal descriptors share a
 * key, a released target is reused, a resize allocates nothing, and two
 * transients whose live spans do not overlap share one target.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTargetPool, descriptorKey } from '../../../engine/render/target-pool.js'
import { makePassGraph } from '../../../engine/render/graph.js'

const noop = () => {}

test('equal descriptors share a key and one changed field makes a different key', () => {
  assert.equal(
    descriptorKey({ scale: 0.5, format: 'half-float' }),
    descriptorKey({ scale: 0.5, format: 'half-float', samples: 0, depth: true })
  )
  assert.notEqual(descriptorKey({ format: 'half-float' }), descriptorKey({ format: 'unsigned-byte' }))
  assert.notEqual(descriptorKey({ scale: 0.5 }), descriptorKey({ scale: 1 }))
  assert.notEqual(descriptorKey({ samples: 0 }), descriptorKey({ samples: 4 }))
})

test('two targets held at once are different, and a released one is handed out again', () => {
  const pool = makeTargetPool()
  pool.resize(100, 50)
  const first = pool.acquire({ format: 'half-float' })
  const second = pool.acquire({ format: 'half-float' })
  assert.notEqual(first, second, 'two live targets cannot share one texture')
  pool.release(first)
  assert.equal(pool.acquire({ format: 'half-float' }), first, 'a released target is reused')
})

test('a resize sizes every pooled target once and allocates nothing', () => {
  const pool = makeTargetPool()
  pool.resize(100, 50)
  const target = pool.acquire({ scale: 0.5 })
  assert.equal(target.width, 50)
  assert.equal(target.height, 25)
  const made = pool.created
  pool.resize(200, 80)
  assert.equal(pool.created, made, 'a resize makes no target')
  assert.equal(target.width, 100)
  assert.equal(target.height, 40)
})

test('transients whose live spans do not overlap share one target', () => {
  const graph = makePassGraph({ report: noop })
  const half = { format: 'half-float' }
  graph.add({ name: 'a', writes: ['x'], target: half, execute: noop })
  graph.add({ name: 'b', reads: ['x'], execute: noop })
  graph.add({ name: 'c', writes: ['y'], target: half, execute: noop })
  graph.add({ name: 'd', reads: ['y'], execute: noop })
  graph.run(null, null, 64, 64)
  assert.equal(graph.pool.created, 1, 'one physical target serves both spans')
  assert.equal(graph.targets.get('x'), graph.targets.get('y'))
})

test('transients whose live spans overlap get different targets', () => {
  const graph = makePassGraph({ report: noop })
  const half = { format: 'half-float' }
  graph.add({ name: 'a', writes: ['x'], target: half, execute: noop })
  graph.add({ name: 'b', writes: ['y'], target: half, execute: noop })
  graph.add({ name: 'c', reads: ['x', 'y'], execute: noop })
  graph.run(null, null, 64, 64)
  assert.equal(graph.pool.created, 2, 'overlapping spans cannot share')
  assert.notEqual(graph.targets.get('x'), graph.targets.get('y'))
})

test('different descriptors never land on one target', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'a', writes: ['x'], target: { format: 'half-float' }, execute: noop })
  graph.add({ name: 'b', writes: ['y'], target: { format: 'unsigned-byte' }, execute: noop })
  graph.add({ name: 'c', reads: ['x', 'y'], execute: noop })
  graph.run(null, null, 64, 64)
  assert.equal(graph.pool.created, 2)
  assert.notEqual(graph.targets.get('x'), graph.targets.get('y'))
})

test('a resource is sized by its descriptor scale', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'a', writes: ['half'], target: { scale: 0.5 }, execute: noop })
  graph.add({ name: 'b', reads: ['half'], execute: noop })
  graph.run(null, null, 320, 180)
  assert.equal(graph.targets.get('half').width, 160)
  assert.equal(graph.targets.get('half').height, 90)
})
