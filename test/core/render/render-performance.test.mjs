/**
 * The pass graph's performance guard: the executor is linear in the pass count,
 * a steady frame allocates nothing, scene size does not change the kernel's
 * work, the target pool is constant time, and the default frame's budget is
 * recorded so a change that adds per-frame work fails here.
 *
 * These are structural counts and identities, not stopwatches. One wall-clock
 * guard is kept, with a budget an order of magnitude above the measured work.
 * `graph-cost` already proves identity reuse and one call per pass; this file
 * measures the growth that guard is about.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../../engine/render/graph.js'
import { makeTargetPool } from '../../../engine/render/target-pool.js'
import { makeRenderer } from '../../../engine/render.js'
import { makeCountingPool } from './counting-pool.mjs'

const noop = () => {}
const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const viewport = () => ({ width: 320, height: 180 })
const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })

test('the executor calls each pass once, so its work grows linearly with the pass count', () => {
  const sizes = [1, 2, 4, 8, 16, 32, 64]
  const work = []
  for (const size of sizes) {
    const graph = makePassGraph({ report: noop })
    let calls = 0
    for (let i = 0; i < size; i++) {
      graph.add({
        name: `pass${i}`,
        extract: () => { calls++ },
        prepare: () => { calls++ },
        execute: () => { calls++ }
      })
    }
    graph.run(null, null, 8, 8)
    assert.equal(calls, size * 3, `${size} passes cost exactly three calls each`)
    work.push(calls)
  }

  // A quadratic executor would call the pass set once per pass, so doubling the
  // pass count would quadruple the work. Doubling the count doubles it instead.
  for (let i = 1; i < sizes.length; i++) {
    assert.equal(work[i], work[i - 1] * 2, `doubling to ${sizes[i]} passes doubled the work`)
  }
})

test('a large pass graph stays far under a wall-clock budget', () => {
  const graph = makePassGraph({ report: noop })
  for (let i = 0; i < 100; i++) graph.add({ name: `pass${i}`, execute: noop })
  graph.add({ name: 'present', execute: noop })
  graph.run(null, null, 8, 8)

  const started = performance.now()
  for (let i = 0; i < 2000; i++) graph.run(null, null, 8, 8)
  const elapsed = performance.now() - started

  // Budget: 2000 ms for 2000 frames of 101 passes — 202,000 no-op calls. The
  // executor calls one function per pass and allocates nothing, which measures
  // a few milliseconds here; the budget is hundreds of times that, so a slow or
  // loaded machine still passes.
  assert.ok(elapsed < 2000, `202,000 pass calls took ${elapsed.toFixed(1)}ms, over the 2s budget`)
})

test('a steady frame allocates nothing: the order, the frame, the targets and the descriptors keep their identity', () => {
  const pool = makeCountingPool()
  const graph = makePassGraph({ report: noop, pool })
  const descriptor = { format: 'half-float' }
  graph.add({ name: 'produce', writes: ['x'], target: descriptor, execute: noop })
  graph.add({ name: 'consume', reads: ['x'], execute: noop })
  graph.add({ name: 'screen', execute: noop })
  graph.run(null, null, 64, 64)

  const order = graph.passes
  const frame = graph.frame
  const target = graph.targets.get('x')
  const created = pool.created
  const acquired = pool.acquired

  for (let i = 0; i < 10000; i++) graph.run(null, null, 64, 64)

  assert.equal(graph.passes, order, 'the sorted order is the same array')
  assert.equal(graph.frame, frame, 'the frame record is the same object')
  assert.equal(graph.targets.get('x'), target, 'the target keeps its identity')
  assert.equal(graph.passes.find(pass => pass.name === 'produce').target, descriptor, 'the descriptor is reused')
  assert.equal(pool.created, created, 'ten thousand frames made no target')
  assert.equal(pool.acquired, acquired, 'ten thousand frames asked the pool for nothing')
  assert.equal(graph.rebuilds, 1, 'the graph rebuilt once, at the first frame')
})

test('the kernel does the same per-frame work for one entity and for ten thousand', () => {
  const pool = makeCountingPool()
  const graph = makePassGraph({ report: noop, pool })
  let calls = 0
  graph.add({ name: 'produce', writes: ['x'], target: { format: 'half-float' }, execute: noop })
  for (let i = 0; i < 20; i++) {
    graph.add({
      name: `pass${i}`,
      extract: () => { calls++ },
      execute: () => { calls++ }
    })
  }
  graph.add({ name: 'present', reads: ['x'], execute: noop })

  graph.run({ entities: [{ id: 'one' }] }, null, 8, 8)
  const one = {
    calls,
    created: pool.created,
    acquired: pool.acquired,
    order: graph.passes,
    frame: graph.frame,
    target: graph.targets.get('x')
  }
  calls = 0

  const many = { entities: Array.from({ length: 10000 }, (_, i) => ({ id: `e${i}` })) }
  graph.run(many, null, 8, 8)

  assert.equal(calls, one.calls, 'the same callbacks ran for ten thousand entities as for one')
  assert.equal(pool.created, one.created, 'the larger world made no target')
  assert.equal(pool.acquired, one.acquired, 'the larger world acquired no target')
  assert.equal(graph.passes, one.order, 'the ordered set is the same array')
  assert.equal(graph.frame, one.frame, 'the frame record is the same object')
  assert.equal(graph.targets.get('x'), one.target, 'the resource holds the same target')
})

test('the target pool acquires and releases one target in constant time, and grows only for a new descriptor', () => {
  const pool = makeTargetPool()
  pool.resize(64, 64)
  const shared = { format: 'half-float' }

  const first = pool.acquire(shared)
  pool.release(first)
  for (let i = 0; i < 10000; i++) {
    const target = pool.acquire(shared)
    assert.equal(target, first, 'a released target is the one handed back')
    pool.release(target)
  }
  assert.equal(pool.created, 1, 'ten thousand acquire and release cycles made no target')

  // A descriptor is the key. A new one is the only thing that makes a target.
  pool.acquire({ format: 'unsigned-byte' })
  assert.equal(pool.created, 2, 'a second descriptor made exactly one more target')

  // A resize sizes every target in place and makes nothing, so a frame that
  // changes the viewport still allocates no target.
  pool.resize(200, 120)
  assert.equal(pool.created, 2, 'a resize made no target')
  assert.equal(first.width, 200, 'the released target was resized in place')
})

// The default frame's per-frame cost, as a value. A change that adds a pass, a
// draw, a target or a stat changes this object and fails the comparison below.
const EXPECTED_BUDGET = {
  passNames: ['frame', 'clear', 'scene', 'ui', 'present'],
  cardDraws: 1,
  targets: 0,
  stats: {
    drawCalls: 0, triangles: 0,
    entities: 1, merged: 0, batches: 0,
    keylines: 0, contactShadows: 0, groundRings: 0,
    materials: 1, textures: 0, geometries: 0, programs: 0,
    gpuMs: null, post: 'none', cpuMs: 0
  }
}

/** The per-frame work the default frame is observed to cost. */
function readBudget(frame, cardDraws) {
  return {
    passNames: frame.graph.passes.map(pass => pass.name),
    cardDraws,
    targets: frame.graph.pool.created,
    stats: { ...frame.stats }
  }
}

test('the default frame hands a change a recorded budget to fail against', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  let cardDraws = 0
  const render = frame.threeRenderer.render
  frame.threeRenderer.render = (scene, camera) => {
    cardDraws++
    return render.call(frame.threeRenderer, scene, camera)
  }
  function drawOnce() {
    const before = cardDraws
    frame.draw()
    return cardDraws - before
  }

  const world = { entities: [box('a')] }
  frame.sync(world)
  const recorded = readBudget(frame, drawOnce())
  assert.deepEqual(recorded, EXPECTED_BUDGET)

  let lastFrameDraws = 0
  for (let i = 0; i < 200; i++) {
    frame.sync(world)
    lastFrameDraws = drawOnce()
    assert.equal(lastFrameDraws, 1, 'every frame makes one world draw')
  }
  assert.deepEqual(readBudget(frame, lastFrameDraws), EXPECTED_BUDGET, 'the budget is unchanged after two hundred frames')
})
