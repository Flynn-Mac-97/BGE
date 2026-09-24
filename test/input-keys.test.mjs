/**
 * While a run plays, a key the game has bound does only the game's job: the
 * browser's own use of it (Tab moving focus, Space pressing a button) is held
 * back. While editing, the editor keeps every key.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import input from '../plugins/builtin/input.js'

/** A stand-in element that keeps its listeners and can fire them. */
function standIn(rect = { left: 0, top: 0 }) {
  const listeners = {}
  const isCapturing = {}
  return {
    listeners,
    isCapturing,
    addEventListener: (name, listener, options) => { listeners[name] = listener; isCapturing[name] = options?.capture === true },
    getBoundingClientRect: () => rect,
    fire: (name, event) => listeners[name]?.(event)
  }
}

/** The plugin loaded against a stand-in window, and a way to press a key on it. */
function keyboard({ isRunning, viewport = null }) {
  const listeners = {}
  const saved = globalThis.addEventListener
  globalThis.addEventListener = (name, listener) => { listeners[name] = listener }
  const pressedCodes = new Set()
  const onReady = []
  const context = {
    loop: { running: isRunning, input: { press: code => pressedCodes.add(code), release: code => pressedCodes.delete(code), releaseAll() {}, isDown: () => false, pressed: () => false } },
    bus: { emit() {}, on: (name, listener) => onReady.push(listener) },
    shell: { viewport }
  }
  input.onLoad(context)
  onReady.forEach(listener => listener())
  globalThis.addEventListener = saved
  const keyDown = code => {
    let isHeldBack = false
    listeners.keydown({ code, target: { tagName: 'CANVAS' }, preventDefault: () => { isHeldBack = true } })
    return isHeldBack
  }
  return { context, keyDown, pressedCodes, window: listeners }
}

test('while playing, a bound key is held back from the browser', () => {
  const { context, keyDown } = keyboard({ isRunning: true })
  context.input.bind('gearScreen', ['Tab'])
  assert.equal(keyDown('Tab'), true)
})

test('while playing, a key no action uses is left to the browser', () => {
  const { keyDown } = keyboard({ isRunning: true })
  assert.equal(keyDown('F5'), false)
})

test('while editing, even a bound key is left to the browser', () => {
  const { context, keyDown } = keyboard({ isRunning: false })
  context.input.bind('gearScreen', ['Tab'])
  assert.equal(keyDown('Tab'), false)
})

test('the pointer over the game view is in viewport pixels, and a button is a key code', () => {
  const viewport = standIn({ left: 100, top: 40 })
  const { context, pressedCodes, window } = keyboard({ isRunning: true, viewport })
  viewport.fire('pointermove', { clientX: 260, clientY: 130 })
  assert.deepEqual(context.input.pointer(), { x: 160, y: 90, isOver: true })
  viewport.fire('pointerdown', { clientX: 260, clientY: 130, button: 0 })
  assert.ok(pressedCodes.has('MouseLeft'), 'the left button presses MouseLeft')
  window.pointerup({ button: 0 })
  assert.ok(!pressedCodes.has('MouseLeft'), 'and letting go anywhere releases it')
  assert.ok(viewport.isCapturing.pointerdown, 'the press is caught in the capture phase, before Mouse Look stops it')
  viewport.fire('pointerleave', {})
  assert.equal(context.input.pointer().isOver, false)
})
