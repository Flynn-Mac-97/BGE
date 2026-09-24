/**
 * The fixed-clock timer schedule, driven by hand.
 *
 * A timer is due at a step count, not at a wall time, so `run(now)` is the
 * whole interface the loop drives. Each test below pins one decision in
 * `engine/loop-timers.js` that a caller can see.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeTimers } from '../../../engine/loop-timers.js'

test('a timer due exactly on its scheduled time fires on it', () => {
  const timers = makeTimers()
  let fired = 0
  timers.after(0.5, 0, () => fired++)
  timers.run(0.5)
  assert.equal(fired, 1)
})

test('a timer that is not yet due does not fire', () => {
  const timers = makeTimers()
  let fired = 0
  timers.after(0.5, 0, () => fired++)
  timers.run(0.1)
  assert.equal(fired, 0)
})

test('a repeating timer waits one full interval before its first run', () => {
  const timers = makeTimers()
  let fired = 0
  timers.every(0.5, 0, () => fired++)
  timers.run(0)
  assert.equal(fired, 0, 'the first run is one interval away, not immediate')
  timers.run(0.5)
  assert.equal(fired, 1)
})

test('a one-shot timer is done after it fires', () => {
  const timers = makeTimers()
  let fired = 0
  timers.after(0.5, 0, () => fired++)
  timers.run(0.5)
  timers.run(1)
  assert.equal(fired, 1, 'the callback ran once')
  assert.equal(timers.count(), 0, 'and the timer is no longer pending')
})

test('a repeating timer runs again only after a full interval', () => {
  const timers = makeTimers()
  let fired = 0
  timers.every(0.5, 0, () => fired++)
  timers.run(0.5)
  assert.equal(fired, 1)
  timers.run(0.6)
  assert.equal(fired, 1, 'half an interval later it is not due')
  timers.run(1)
  assert.equal(fired, 2)
})

test('cancel stops a pending timer from firing', () => {
  const timers = makeTimers()
  let fired = 0
  const id = timers.after(0.5, 0, () => fired++)
  assert.equal(timers.cancel(id), true)
  timers.run(0.5)
  assert.equal(fired, 0)
})

test('cancel reports whether the timer was still pending', () => {
  const timers = makeTimers()
  const id = timers.after(0.5, 0, () => {})
  assert.equal(timers.cancel(id), true, 'a pending id was found')
  assert.equal(timers.cancel(9999), false, 'an id that was never scheduled')
})

test('cancel only cancels the timer with the given id', () => {
  const timers = makeTimers()
  let early = 0
  let late = 0
  const id = timers.after(1, 0, () => early++)
  timers.after(2, 0, () => late++)
  timers.cancel(id)
  timers.run(2)
  assert.equal(early, 0, 'the cancelled timer did not fire')
  assert.equal(late, 1, 'the other timer did')
})

test('cancelling one timer leaves the others pending', () => {
  const timers = makeTimers()
  let second = 0
  const id = timers.after(1, 0, () => {})
  timers.after(2, 0, () => second++)
  timers.cancel(id)
  timers.run(0)
  assert.equal(timers.count(), 1, 'the live timer survived the removal of the cancelled one')
  timers.run(2)
  assert.equal(second, 1)
})

test('a cancelled timer is not counted and not listed', () => {
  const timers = makeTimers()
  const id = timers.after(1, 0, () => {})
  assert.deepEqual(timers.list(0), [{ id, in: 1, every: undefined }])
  timers.cancel(id)
  assert.equal(timers.count(), 0)
  assert.deepEqual(timers.list(0), [])
})

test('list reports how long until a repeating timer runs', () => {
  const timers = makeTimers()
  timers.every(0.5, 0, () => {})
  timers.run(0.2)
  assert.equal(timers.list(0.2)[0].in, 0.3)
})
