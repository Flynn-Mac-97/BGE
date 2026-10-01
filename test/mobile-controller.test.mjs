/** Pointer lifecycle and visual feedback remain independent of UI redraws. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { watchMobile } from '../plugins/builtin/game-ui/mobile.js'
import inputPlugin from '../plugins/builtin/input.js'
import { makeInputRecord } from '../engine/loop-input.js'

function fixture() {
  const keys = makeInputRecord({ step: () => 0 })
  const context = { loop: { input: keys }, bus: { on() {} } }
  inputPlugin.onLoad(context)
  const listeners = new Map()
  const controls = []
  const reports = []
  const root = {
    host: { dataset: { gameUi: 'test' } },
    contains: control => controls.includes(control),
    querySelectorAll: () => controls,
    addEventListener(name, listener, { signal }) {
      listeners.set(name, listener)
      signal.addEventListener('abort', () => listeners.delete(name))
    }
  }
  const mobile = watchMobile(root, context.input, event => reports.push(event))
  function control(kind, action = 'fire') {
    const attributes = new Set()
    const thumb = { style: {} }
    const element = {
      dataset: { mobile: kind, action, directions: JSON.stringify({ left: 'left', right: 'right', up: 'up', down: 'down' }), deadZone: '0.2' },
      closest: () => element,
      hasAttribute: name => attributes.has(name),
      setAttribute: name => attributes.add(name),
      removeAttribute: name => attributes.delete(name),
      querySelector: () => kind === 'joystick' ? thumb : null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 140, height: 140 }),
      setPointerCapture() {}, hasPointerCapture: () => false
    }
    controls.push(element)
    return element
  }
  const fire = (type, target, pointerId, x = 120, y = 70, timeStamp = 100) => listeners.get(type)?.({ type, target, pointerId, clientX: x, clientY: y, button: 0, timeStamp, preventDefault() {} })
  return { input: context.input, mobile, control, fire, reports }
}

test('touch presses are immediate and one finger releasing leaves the other held', () => {
  const { input, mobile, control, fire } = fixture()
  const stick = control('joystick')
  const button = control('button')
  fire('pointerdown', stick, 1)
  fire('pointerdown', button, 2)
  assert.equal(input.axis('x'), 1)
  assert.equal(input.held('fire'), true)
  fire('pointerup', button, 2)
  assert.equal(input.held('fire'), false)
  assert.equal(input.axis('x'), 1)
  fire('pointercancel', stick, 1)
  assert.equal(input.axis('x'), 0)
  mobile.dispose()
})

test('a UI patch cannot erase held feedback or leave disabled controls pressed', () => {
  const { input, mobile, control, fire } = fixture()
  const button = control('button')
  fire('pointerdown', button, 1)
  button.removeAttribute('data-held')
  mobile.reconcile()
  assert.equal(button.hasAttribute('data-held'), true)
  assert.equal(input.held('fire'), true)
  button.setAttribute('data-disabled', '')
  mobile.reconcile()
  assert.equal(input.held('fire'), false)
  assert.equal(button.hasAttribute('data-held'), false)
  mobile.dispose()
})

test('cancellation emits no gesture and disposal releases an active button', () => {
  const { input, mobile, control, fire, reports } = fixture()
  const gesture = control('gesture')
  fire('pointerdown', gesture, 1)
  fire('pointercancel', gesture, 1)
  assert.deepEqual(reports, [])
  const button = control('button')
  fire('pointerdown', button, 2)
  mobile.dispose()
  assert.equal(input.held('fire'), false)
})
