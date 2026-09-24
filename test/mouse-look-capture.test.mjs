/**
 * Mouse Look captures the pointer on a click only while a first-person view
 * plays. A chase camera never reads look(), so there the cursor stays free.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import mouseLook from '../plugins/builtin/mouse-look.js'

/** Mouse Look loaded against a stand-in page. Answers a click, and how many captures it asked for. */
function clickWhilePlaying(viewMode) {
  const canvasListeners = {}
  let captureCount = 0
  const canvas = {
    addEventListener: (name, listener) => { canvasListeners[name] = listener },
    requestPointerLock: () => { captureCount++ }
  }
  const saved = { document: globalThis.document, addEventListener: globalThis.addEventListener }
  globalThis.document = { pointerLockElement: null, addEventListener() {} }
  globalThis.addEventListener = () => {}
  const onReady = []
  const context = {
    input: { bind() {}, release() {}, press() {} },
    loop: { running: true },
    view: { mode: viewMode },
    bus: { on: (name, listener) => name === 'shell:ready' && onReady.push(listener) },
    shell: { canvas, viewport: null }
  }
  const quiet = console.error
  console.error = () => {}
  mouseLook.onLoad(context)
  onReady.forEach(listener => listener())
  canvasListeners.mousedown({ button: 0 })
  console.error = quiet
  Object.assign(globalThis, saved)
  return captureCount
}

test('a click in a first-person view captures the pointer', () => {
  assert.equal(clickWhilePlaying('first-person'), 1)
})

test('a click in a third-person view leaves the pointer free', () => {
  assert.equal(clickWhilePlaying('third-person'), 0)
})
