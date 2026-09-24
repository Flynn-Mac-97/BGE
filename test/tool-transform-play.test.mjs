/**
 * While a round plays, the transform tool stands down: an arrow key does not
 * nudge what was selected before play, and Delete does not remove it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import toolTransform from '../plugins/builtin/tool-transform.js'

/** An element that keeps its listeners and ignores the rest. */
const standIn = () => ({ addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {}, innerHTML: '' })

/** The tool loaded against stand-ins, with one entity selected. Answers a key press and the entity. */
function toolWithSelection({ isRunning }) {
  const windowListeners = {}
  const saved = { addEventListener: globalThis.addEventListener, requestAnimationFrame: globalThis.requestAnimationFrame, setInterval: globalThis.setInterval }
  globalThis.addEventListener = (name, listener) => { windowListeners[name] = listener }
  // The tool repaints on every frame and on a timer; neither has a job here.
  globalThis.requestAnimationFrame = () => 0
  globalThis.setInterval = () => 0
  const crate = { id: 'crate', x: 0, y: 0 }
  let destroyed = false
  const onReady = []
  const context = {
    renderer: {}, world: { entities: [crate] }, editor: {}, view: { mode: 'ortho' },
    loop: { running: isRunning },
    selection: [crate],
    bus: { on: (name, listener) => name === 'shell:ready' && onReady.push(listener), emit() {} },
    shell: { viewport: standIn(), overlay: standIn() },
    save() {}, redraw() {}, select() {}, destroy: () => { destroyed = true }
  }
  toolTransform.onLoad(context)
  onReady.forEach(listener => listener())
  Object.assign(globalThis, saved)
  const press = key => windowListeners.keydown({ key, code: key, target: { tagName: 'CANVAS' }, preventDefault() {} })
  return { press, crate, isDestroyed: () => destroyed }
}

test('while playing, an arrow key does not move the selection and Delete does not remove it', () => {
  const tool = toolWithSelection({ isRunning: true })
  tool.press('ArrowLeft')
  tool.press('Delete')
  assert.equal(tool.crate.x, 0)
  assert.equal(tool.isDestroyed(), false)
})
