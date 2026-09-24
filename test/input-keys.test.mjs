/**
 * While a run plays, a key the game has bound does only the game's job: the
 * browser's own use of it (Tab moving focus, Space pressing a button) is held
 * back. While editing, the editor keeps every key.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import input from '../plugins/builtin/input.js'

/** The plugin loaded against a stand-in window, and a way to press a key on it. */
function keyboard({ isRunning }) {
  const listeners = {}
  const saved = globalThis.addEventListener
  globalThis.addEventListener = (name, listener) => { listeners[name] = listener }
  const context = { loop: { running: isRunning, input: { press() {}, release() {}, releaseAll() {}, isDown: () => false, pressed: () => false } }, bus: { emit() {} } }
  input.onLoad(context)
  globalThis.addEventListener = saved
  const keyDown = code => {
    let isHeldBack = false
    listeners.keydown({ code, target: { tagName: 'CANVAS' }, preventDefault: () => { isHeldBack = true } })
    return isHeldBack
  }
  return { context, keyDown }
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
