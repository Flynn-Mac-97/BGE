/**
 * The input record: events stamped with the step they arrived at, the keys
 * they leave down, and the cursor that replays them.
 *
 * `engine/loop-input.js` is what makes a rewind replay the keys the run was
 * played with. Each test below moves the clock by hand and pins one decision
 * a caller can see, through the record's own exports.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeInputRecord } from '../../../engine/loop-input.js'

/** A record whose clock the test moves by setting `clock.now`. */
function clockedRecord() {
  const clock = { now: 0 }
  return { clock, record: makeInputRecord({ step: () => clock.now }) }
}

test('recording the first key on an empty record works', () => {
  const { record } = clockedRecord()
  assert.equal(record.press('KeyA'), true)
  assert.deepEqual(
    record.events.map(event => event.code),
    ['KeyA']
  )
})

test('a press after the clock goes back forgets the events that never happened', () => {
  const { clock, record } = clockedRecord()
  clock.now = 5
  record.press('KeyEarlier')
  clock.now = 2
  record.press('KeyLater')
  assert.deepEqual(
    record.events.map(event => event.code),
    ['KeyLater']
  )
})

test('a press after the clock goes back keeps the event at the step it returns to', () => {
  const { clock, record } = clockedRecord()
  clock.now = 2
  record.press('KeyAtTwo')
  clock.now = 5
  record.press('KeyAtFive')
  clock.now = 2
  record.press('KeyBack')
  assert.deepEqual(
    record.events.map(event => event.code),
    ['KeyAtTwo', 'KeyBack']
  )
})

test('an event recorded for the step about to run is applied on it', () => {
  const { clock, record } = clockedRecord()
  record.restore([{ at: 5, code: 'KeyA', down: true }], 0)
  clock.now = 5
  record.applyAt()
  assert.equal(record.isDown('KeyA'), true)
})

test('a key pressed on an earlier step is not pressed now', () => {
  const { clock, record } = clockedRecord()
  record.restore([{ at: 3, code: 'KeyA', down: true }], 0)
  clock.now = 5
  record.applyAt()
  assert.equal(record.isDown('KeyA'), true)
  assert.equal(record.pressed('KeyA'), false)
})

test('restoring at a step leaves keys pressed on that step down', () => {
  const { record } = clockedRecord()
  record.restore([{ at: 5, code: 'KeyA', down: true }], 5)
  assert.equal(record.isDown('KeyA'), true)
})

test('a key that went down before the resumed step is not pressed on it', () => {
  const { record } = clockedRecord()
  record.restore([{ at: 1, code: 'KeyA', down: true }], 5)
  assert.equal(record.isDown('KeyA'), true)
  assert.equal(record.pressed('KeyA'), false)
})

test('pressing a key that is already down reports no change', () => {
  const { record } = clockedRecord()
  assert.equal(record.press('KeyA'), true)
  assert.equal(record.press('KeyA'), false)
})

test('a recorded press says the key is down', () => {
  const { record } = clockedRecord()
  record.press('KeyA')
  assert.deepEqual(record.events, [{ at: 0, code: 'KeyA', down: true }])
})

test('releasing a held key reports the change and records the release', () => {
  const { record } = clockedRecord()
  record.press('KeyA')
  assert.equal(record.release('KeyA'), true)
  assert.equal(record.isDown('KeyA'), false)
  assert.deepEqual(
    record.events.map(event => event.down),
    [true, false]
  )
})

test('releasing a key that is not down reports no change', () => {
  const { record } = clockedRecord()
  assert.equal(record.release('KeyA'), false)
  assert.deepEqual(record.events, [])
})

test('releaseAll records every held key coming up', () => {
  const { record } = clockedRecord()
  record.press('KeyA')
  record.press('KeyB')
  assert.equal(record.releaseAll(), 2)
  assert.deepEqual(
    record.events.filter(event => !event.down).map(event => event.code),
    ['KeyA', 'KeyB']
  )
  assert.equal(record.isDown('KeyA'), false)
})
