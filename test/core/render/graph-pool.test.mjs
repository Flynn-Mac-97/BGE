/**
 * The target pool and the graph's resource planning: equal descriptors share a
 * key, a released target is reused, a resize allocates nothing, and two
 * transients whose live spans do not overlap share one target.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTargetPool, descriptorKey, TARGET_CEILING_BYTES } from '../../../engine/render/target-pool.js'
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

test('a slot is not reused by a span that starts where the last one was read', () => {
  const graph = makePassGraph({ report: noop })
  const half = { format: 'half-float' }
  graph.add({ name: 'a', writes: ['x'], target: half, execute: noop })
  graph.add({ name: 'b', reads: ['x'], writes: ['y'], target: half, execute: noop })
  graph.add({ name: 'c', reads: ['y'], execute: noop })
  graph.run(null, null, 64, 64)
  assert.notEqual(
    graph.targets.get('x'),
    graph.targets.get('y'),
    'a pass may not write over the target it is still reading'
  )
  assert.equal(graph.pool.created, 2)
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

test('a viewport that changes only its height resizes the pooled targets', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'a', writes: ['x'], target: {}, execute: noop })
  graph.add({ name: 'b', reads: ['x'], execute: noop })
  graph.run(null, null, 64, 64)
  const target = graph.targets.get('x')

  graph.run(null, null, 64, 128)
  assert.equal(target.height, 128, 'the pooled target follows a height-only change')
})

test('a removed pass gives its transient target back to the pool', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'present', reads: ['plate'], execute: noop })
  graph.run(null, null, 64, 64)
  const before = graph.pool.created

  graph.add({ name: 'post', writes: ['plate'], target: { format: 'half-float' }, execute: noop })
  graph.run(null, null, 64, 64)
  assert.equal(graph.pool.created, before + 1, 'the transient target is made')

  graph.remove('post')
  graph.run(null, null, 64, 64)
  assert.equal(graph.pool.created, before, 'removing the pass gives the descriptor back')
})

test('a target descriptor with a format the pool cannot build is reported', () => {
  const said = []
  const graph = makePassGraph({ report: message => said.push(message) })
  graph.add({ name: 'produce', writes: ['plate'], target: { format: 'float16' }, execute: noop })
  graph.add({ name: 'consume', reads: ['plate'], execute: noop })
  graph.run(null, null, 8, 8)

  assert.equal(said.length, 1, 'the unknown format is reported once')
  assert.match(said[0], /no format called "float16"/)
  assert.ok(graph.targets.get('plate'), 'the pass still gets a target to draw into')
})

test('a stencil buffer is part of a descriptor key', () => {
  assert.notEqual(descriptorKey({ stencil: true }), descriptorKey({}))
})

test('a target takes its depth and stencil buffers from the descriptor', () => {
  const pool = makeTargetPool()
  pool.resize(8, 8)
  const plain = pool.acquire({})
  const withoutDepth = pool.acquire({ format: 'half-float', depth: false })
  const withStencil = pool.acquire({ format: 'half-float', stencil: true })

  assert.equal(plain.depthBuffer, true, 'a target has a depth buffer unless told otherwise')
  assert.equal(withoutDepth.depthBuffer, false, 'depth false means no depth buffer')
  assert.equal(plain.stencilBuffer, false, 'a target has no stencil buffer unless told otherwise')
  assert.equal(withStencil.stencilBuffer, true, 'stencil true means a stencil buffer')
})

test('a target without a depth buffer occupies only its colour bytes', () => {
  const pool = makeTargetPool()
  pool.resize(64, 64)
  pool.acquire({ depth: false })
  assert.deepEqual(pool.usage, { targets: 1, bytes: 64 * 64 * 4 })
})

test('a pixel ratio that is not a positive number is treated as one', () => {
  for (const ratio of [0, -2]) {
    const pool = makeTargetPool({ pixelRatio: ratio })
    pool.resize(100, 50)
    assert.equal(pool.acquire({}).width, 100, `a ratio of ${ratio} leaves the drawing buffer at the viewport size`)
  }
})

test('a target that exactly fills the ceiling is still built', () => {
  const pool = makeTargetPool()
  pool.resize(16384, 8192)
  const target = pool.acquire({})
  assert.ok(target, 'a target occupying exactly the ceiling is not refused')
  assert.equal(pool.usage.bytes, TARGET_CEILING_BYTES)
})

test('disposing an unused released target does not leave it in the free list', () => {
  const pool = makeTargetPool()
  pool.resize(8, 8)
  const target = pool.acquire({})
  pool.release(target)
  pool.disposeUnused(new Set())

  assert.notEqual(pool.acquire({}), target, 'a disposed target is never handed out again')
  assert.equal(pool.created, 1)
})

test('dispose lets the ceiling be reported again', () => {
  const said = []
  const pool = makeTargetPool({ report: message => said.push(message) })
  pool.resize(16384, 8192)
  pool.acquire({})
  pool.acquire({ format: 'half-float' })
  assert.equal(said.length, 1, 'the ceiling is reported once for this pool')

  pool.dispose()
  pool.acquire({})
  pool.acquire({ format: 'half-float' })
  assert.equal(said.length, 2, 'a rebuilt pool reports its ceiling again')
})
