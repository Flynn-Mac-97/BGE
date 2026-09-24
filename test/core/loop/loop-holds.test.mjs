/**
 * The run's holds and the clock a world is resumed to.
 *
 * `engine/loop.js` keeps the pause, the hit stop and the pending timers inside
 * itself, so these drive a bare loop and read what a caller can: `holding`,
 * `paused` and the timer list.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeLoop, FIXED_STEP } from '../../../engine/loop.js'

test('a zero-second hit stop does not hold the step', () => {
  let ran = 0
  const loop = makeLoop({
    onFixed: seconds => {
      ran += seconds
    },
    onFrame: () => {}
  })
  loop.holdFor(0)
  loop.step(1)
  assert.equal(ran, FIXED_STEP)
})

test('a loop with no hold is not paused', () => {
  const loop = makeLoop({ onFixed: () => {}, onFrame: () => {} })
  assert.equal(loop.paused, false)
  loop.hold('paused')
  assert.equal(loop.paused, true)
  loop.release('paused')
  assert.equal(loop.paused, false)
})

test('resuming moves a pending timer with the clock', () => {
  const loop = makeLoop({ onFixed: () => {}, onFrame: () => {} })
  loop.after(1, () => {})
  loop.step(30)
  loop.resume({ steps: 120 })
  assert.equal(loop.timers.length, 1, 'the rebuilt schedule survived the resume')
  assert.equal(loop.timers[0].in, 0.5, 'and the timer is the same distance from the clock')
})

test('resuming without a hit stop leaves the hold alone', () => {
  const loop = makeLoop({ onFixed: () => {}, onFrame: () => {} })
  loop.holdFor(0.5)
  loop.resume({ steps: 30 })
  assert.equal(loop.holding, 0.5)
})
