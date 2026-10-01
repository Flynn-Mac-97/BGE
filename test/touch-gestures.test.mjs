/** Gesture transitions, timing and multi-touch isolation without a browser clock. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTouchGestures } from '../plugins/builtin/game-ui/touch-gestures.js'

function fixture() {
  const events = []
  const timers = new Map()
  let sequence = 0
  const gestures = makeTouchGestures({ report: event => events.push(event), schedule: callback => { timers.set(++sequence, callback); return sequence }, clear: id => timers.delete(id) })
  return { gestures, events, hold() { for (const callback of [...timers.values()]) callback(); timers.clear() } }
}
const point = (x, y, time) => ({ x, y, time })

test('a second nearby tap becomes doubletap without delaying the first tap', () => {
  const { gestures, events } = fixture()
  gestures.down(1, point(20, 20, 0)); gestures.up(1, point(20, 20, 100))
  assert.equal(events[0].type, 'tap')
  gestures.down(2, point(22, 21, 200)); gestures.up(2, point(22, 21, 250))
  assert.deepEqual(events.map(event => event.type), ['tap', 'doubletap'])
})

test('a stationary hold fires before release, and does not become a tap', () => {
  const { gestures, events, hold } = fixture()
  gestures.down(1, point(20, 20, 0)); hold(); gestures.up(1, point(20, 20, 800))
  assert.deepEqual(events.map(event => event.type), ['longpress'])
})

test('a fast drag finishes with a swipe and leaves its actual trail', () => {
  const { gestures, events } = fixture()
  gestures.down(1, point(20, 20, 0)); gestures.move(1, point(60, 30, 100)); gestures.up(1, point(150, 30, 200))
  assert.deepEqual(events.map(event => event.type), ['dragstart', 'dragend', 'swipe'])
  assert.equal(events.at(-1).direction, 'right')
  assert.equal(gestures.snapshot().trails[0].trail.length, 3)
})

test('returning a drag to its origin is not a tap', () => {
  const { gestures, events } = fixture()
  gestures.down(1, point(0, 0, 0)); gestures.move(1, point(100, 0, 100)); gestures.up(1, point(0, 0, 200))
  assert.ok(!events.some(event => event.type === 'tap'))
})

test('two contacts report scale, rotation and pan, without stray taps after release', () => {
  const { gestures, events } = fixture()
  gestures.down(1, point(0, 0, 0)); gestures.down(2, point(100, 0, 20))
  assert.equal(gestures.down(3, point(50, 50, 30)), false)
  gestures.move(1, point(50, 0, 100)); gestures.move(2, point(50, 200, 100))
  const result = events.at(-1)
  assert.equal(result.type, 'transform')
  assert.equal(result.scale, 2)
  assert.equal(result.rotation, 90)
  assert.equal(result.x, 0)
  assert.equal(result.y, 100)
  gestures.up(1, point(50, 0, 150)); gestures.up(2, point(50, 200, 150))
  assert.equal(events.filter(event => event.type === 'transformend').length, 1)
  assert.ok(!events.some(event => ['tap', 'swipe'].includes(event.type)))
})

test('movement and cancellation clear long-press timers', () => {
  const { gestures, events, hold } = fixture()
  gestures.down(1, point(0, 0, 0)); gestures.move(1, point(30, 0, 100)); hold()
  assert.ok(!events.some(event => event.type === 'longpress'))
  gestures.cancel(); hold()
  assert.equal(gestures.snapshot().contacts.length, 0)
  assert.equal(events.at(-1).type, 'cancel')
})
