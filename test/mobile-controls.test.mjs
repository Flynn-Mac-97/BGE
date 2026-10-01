/** Mobile action ownership, gesture thresholds and the UI's headless event path. */
import test from 'node:test'
import assert from 'node:assert/strict'
import inputPlugin from '../plugins/builtin/input.js'
import { makeInputRecord } from '../engine/loop-input.js'
import { joystickPosition, contactGesture } from '../plugins/builtin/game-ui/mobile.js'
import { kit } from '../plugins/builtin/game-ui/components.js'
import { controlsOf } from '../plugins/builtin/game-ui/controls.js'

function loaded() {
  const keys = makeInputRecord({ step: () => 0 })
  const context = { loop: { input: keys }, bus: { on() {} } }
  inputPlugin.onLoad(context)
  return { input: context.input, keys }
}

test('two touch sources and a keyboard key release independently and replay their actions', () => {
  const { input, keys } = loaded()
  input.press('Space')
  input.holdAction('jump', 'first')
  input.holdAction('jump', 'second')
  input.releaseAction('jump', 'first')
  input.release('Space')
  assert.equal(input.held('jump'), true)
  input.releaseAction('jump', 'second')
  assert.equal(input.held('jump'), false)
  assert.equal(input.pressed('jump'), true)
  const records = keys.events
  keys.clear()
  keys.restore(records.slice(0, 3), 0)
  assert.equal(input.held('jump'), true)
})

test('one world rebinding an action does not change another world', () => {
  const first = loaded().input
  first.bind('jump', ['KeyQ'])
  assert.deepEqual(loaded().input.codes('jump'), ['Space', 'ArrowUp', 'KeyW'])
})

test('a virtual action remains independent of a physical rebinding', () => {
  const { input } = loaded()
  input.holdAction('fire', 'button')
  input.bind('fire', ['KeyF'])
  assert.equal(input.held('fire'), true)
  input.releaseAction('fire', 'button')
  assert.equal(input.held('fire'), false)
})

test('a stick clamps diagonals and uses positive up', () => {
  const position = joystickPosition({ left: 0, top: 0, width: 100, height: 100 }, 150, -50)
  assert.ok(Math.abs(Math.hypot(position.x, position.y) - 1) < 1e-9)
  assert.ok(position.x > 0 && position.y > 0)
})

test('tap, swipe and long stationary contacts have distinct outcomes', () => {
  const start = { x: 10, y: 20, time: 0 }
  assert.equal(contactGesture(start, { x: 12, y: 21, time: 100 }).type, 'tap')
  assert.equal(contactGesture(start, { x: 90, y: 21, time: 200 }).direction, 'right')
  assert.equal(contactGesture(start, { x: 10, y: 20, time: 600 }), null)
  assert.equal(contactGesture(start, { x: 90, y: 20, time: 1000 }), null)
})

test('mobile kit escapes labels and declares gesture event types for headless use', () => {
  assert.match(kit.actionButton('<Jump>', { action: 'jump' }), /&lt;Jump&gt;/)
  assert.ok(controlsOf(kit.gestureArea('Swipe', { action: 'aim' }))[0].triggers.includes('swipe'))
  assert.match(kit.joystick(), /data-dead-zone="0.2"/)
})
