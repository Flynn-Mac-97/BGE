/**
 * The pass graph's per-pass timing, proved without a stopwatch.
 *
 * The executor times each pass's extract, prepare and execute and writes the
 * last frame's cost into one reused record per pass. A caller reads `graph.costs`
 * rather than wrapping the pass callbacks. The clock is injected and moves only
 * when a pass moves it, so attribution is exact and the kernel's own clock reads
 * are the only reads counted.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makePassGraph } from '../../../engine/render/graph.js'

const noop = () => {}

/** A clock the test moves by hand, so a pass's cost is the number it chose. */
function makeTestClock() {
  let milliseconds = 0
  return {
    now: () => milliseconds,
    advance: amount => {
      milliseconds += amount
    }
  }
}

test('each stage of a pass is attributed to that pass and not another', () => {
  const clock = makeTestClock()
  const graph = makePassGraph({ report: noop, now: clock.now })
  graph.add({
    name: 'heavy',
    extract: () => clock.advance(1),
    prepare: () => clock.advance(2),
    execute: () => clock.advance(3)
  })
  graph.add({ name: 'light', execute: () => clock.advance(4) })
  graph.run(null, null, 8, 8)

  const heavy = graph.costs.find(cost => cost.name === 'heavy')
  const light = graph.costs.find(cost => cost.name === 'light')
  assert.deepEqual(
    heavy,
    { name: 'heavy', extractMs: 1, prepareMs: 2, executeMs: 3 },
    'the heavy pass holds its own three stages'
  )
  assert.deepEqual(
    light,
    { name: 'light', extractMs: 0, prepareMs: 0, executeMs: 4 },
    'the light pass holds only its execute, not the heavy pass time'
  )
})

test('a pass that does no work reports no cost', () => {
  const clock = makeTestClock()
  const graph = makePassGraph({ report: noop, now: clock.now })
  graph.add({ name: 'idle', execute: noop })
  graph.run(null, null, 8, 8)

  assert.deepEqual(
    graph.costs[0],
    { name: 'idle', extractMs: 0, prepareMs: 0, executeMs: 0 },
    'an idle pass costs nothing'
  )
})

test('the cost records are reused across frames, not rebuilt', () => {
  const clock = makeTestClock()
  const graph = makePassGraph({ report: noop, now: clock.now })
  graph.add({ name: 'idle', execute: noop })
  graph.run(null, null, 8, 8)
  const record = graph.costs[0]
  graph.run(null, null, 8, 8)
  assert.equal(graph.costs[0], record, 'a steady frame kept the same cost record')
})

test('a pass-set change rebuilds the cost records in run order', () => {
  const clock = makeTestClock()
  const graph = makePassGraph({ report: noop, now: clock.now })
  graph.add({ name: 'first', execute: noop })
  graph.run(null, null, 8, 8)
  const record = graph.costs[0]
  graph.add({ name: 'second', execute: noop })
  graph.run(null, null, 8, 8)

  assert.notEqual(graph.costs[0], record, 'the new pass set has its own records')
  assert.deepEqual(
    graph.costs.map(cost => cost.name),
    ['first', 'second'],
    'one record per live pass, in run order'
  )
})

test('the clock reads the frame makes are counted, and the clock is named', () => {
  const clock = makeTestClock()
  const graph = makePassGraph({ report: noop, now: clock.now })
  graph.add({ name: 'both', extract: noop, prepare: noop, execute: noop })
  graph.run(null, null, 8, 8)

  assert.equal(graph.clockReads, 6, 'two reads for each of three timed stages')
  assert.equal(graph.clock, 'performance.now()', 'the stats name the clock')
})

test('a later extract is timed from where the clock was, not from zero', () => {
  const clock = makeTestClock()
  const graph = makePassGraph({ report: noop, now: clock.now })
  graph.add({ name: 'first', extract: () => clock.advance(5), execute: noop })
  graph.add({ name: 'second', extract: () => clock.advance(2), execute: noop })
  graph.run(null, null, 8, 8)

  const second = graph.costs.find(cost => cost.name === 'second')
  assert.equal(second.extractMs, 2, 'the cost is the time the pass took, not the clock reading')
})
