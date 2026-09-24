/**
 * The pass graph's cost, proved by structure rather than by a stopwatch.
 *
 * A steady frame must allocate nothing, so the sorted order, the frame record
 * and the targets keep their identity and the pool's creation count stops
 * growing. The executor's work is one call per pass, so a world of one entity
 * and a world of ten thousand cost the same and the kernel never walks either.
 * Exactly one wall-clock guard is kept, with a budget far above the work.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../../engine/render/graph.js'

const noop = () => {}

test('a steady frame reuses the order, the targets and the frame record', () => {
  const graph = makePassGraph({ report: noop })
  const descriptor = { format: 'half-float' }
  graph.add({ name: 'produce', writes: ['x'], target: descriptor, execute: noop })
  graph.add({ name: 'consume', reads: ['x'], execute: noop })
  graph.run(null, null, 64, 64)

  const order = graph.passes
  const frame = graph.frame
  const target = graph.targets.get('x')
  const made = graph.pool.created
  const rebuilds = graph.rebuilds

  for (let index = 0; index < 1000; index++) graph.run(null, null, 64, 64)

  assert.equal(graph.passes, order, 'the sorted order is the same array')
  assert.equal(graph.frame, frame, 'the frame record is the same object')
  assert.equal(graph.targets.get('x'), target, 'the target keeps its identity across frames')
  assert.equal(graph.passes.find(pass => pass.name === 'produce').target, descriptor, 'the descriptor is reused')
  assert.equal(graph.pool.created, made, 'no target was allocated after the first frame')
  assert.equal(graph.rebuilds, rebuilds, 'the graph did not rebuild')
})

test('a pass-set change rebuilds, and an unchanged set does not', () => {
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'a', execute: noop })
  graph.passes
  const settled = graph.rebuilds
  for (let index = 0; index < 100; index++) graph.run(null, null, 8, 8)
  assert.equal(graph.rebuilds, settled)
  graph.add({ name: 'b', execute: noop })
  graph.passes
  assert.equal(graph.rebuilds, settled + 1)
})

test('one extract and one execute per pass, whatever the world holds', () => {
  const graph = makePassGraph({ report: noop })
  const work = []
  for (let index = 0; index < 50; index++) {
    graph.add({ name: `pass${index}`, extract: () => work.push('x'), execute: () => work.push('e') })
  }
  graph.add({ name: 'present', execute: () => work.push('e') })

  const one = { entities: [{ id: 'a' }] }
  graph.run(one, null, 8, 8)
  const callsForOne = work.length
  work.length = 0

  const many = { entities: Array.from({ length: 10000 }, (placeholder, index) => ({ id: `e${index}` })) }
  graph.run(many, null, 8, 8)
  assert.equal(work.length, callsForOne, 'the executor does the same work for 1 and 10,000 entities')
  assert.equal(callsForOne, 101, '50 extracts, 51 executes')
})

test('the executor never reads a field of what it is handed', () => {
  let reads = 0
  const pluginData = new Proxy(
    {},
    {
      get() {
        reads++
        return []
      }
    }
  )
  const graph = makePassGraph({ report: noop })
  graph.add({ name: 'present', execute: noop })
  graph.run(pluginData, null, 8, 8)
  assert.equal(reads, 0, 'the executor stores and never inspects')
})

test('the kernel runs a single screen pass and a many-pass chain the same way', () => {
  // A retro 2D frame: one pass, straight to the canvas, no target.
  const flat = makePassGraph({ report: noop })
  const flatRan = []
  flat.add({ name: 'flat2d', execute: () => flatRan.push('flat2d') })
  flat.run(null, null, 320, 180)
  assert.deepEqual(flatRan, ['flat2d'])
  assert.equal(flat.pool.created, 0, 'a single screen pass builds no target')

  // An AAA frame: a long chain of full-size transients and a final screen pass.
  const rich = makePassGraph({ report: noop })
  const richRan = []
  let previous = null
  for (let index = 0; index < 40; index++) {
    const resource = `colour${index}`
    const reads = previous ? [previous] : []
    rich.add({
      name: `pass${index}`,
      reads,
      writes: [resource],
      target: { format: 'half-float' },
      execute: () => richRan.push(`pass${index}`)
    })
    previous = resource
  }
  rich.add({ name: 'present', reads: [previous], execute: () => richRan.push('present') })
  rich.run(null, null, 320, 180)
  assert.equal(richRan.length, 41, 'every pass in the chain ran')
  assert.ok(rich.pool.created > 0, 'the chain built its transients')
})

test('a thousand frames of a two-hundred-pass graph stay far under the budget', () => {
  const graph = makePassGraph({ report: noop })
  for (let index = 0; index < 200; index++) graph.add({ name: `pass${index}`, execute: noop })
  graph.add({ name: 'present', execute: noop })
  graph.run(null, null, 8, 8)

  const started = performance.now()
  for (let index = 0; index < 1000; index++) graph.run(null, null, 8, 8)
  const elapsed = performance.now() - started

  // Budget: 4000 ms for 1000 frames of 201 passes, which is 201,000 no-op
  // calls. The path allocates nothing and calls one function per pass, so a
  // machine finishes this in tens of milliseconds; the budget is roughly a
  // hundred times the work, which keeps it stable on a slow or loaded one.
  assert.ok(elapsed < 4000, `201,000 pass calls took ${elapsed.toFixed(1)}ms, over the 4s budget`)
})
