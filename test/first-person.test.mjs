/**
 * The First Person plugin's viewmodel pass.
 *
 * The pass is the plugin's, not the kernel's: it registers between the world
 * and the UI, draws only in the perspective view, and empties the depth buffer
 * under itself. The plugin owns the weapon's pose, its sway offsets and its key
 * light, and publishes the model API as `context.viewmodel`.
 *
 * Driven against the real renderer with no canvas: `sync` builds the real scene
 * graph and every drawing call lands on a stub, so the pass order and the scene
 * it draws are both readable.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../engine/render.js'
import firstPerson from '../plugins/builtin/first-person.js'

const PERSPECTIVE = { mode: 'perspective', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 75 }
const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })
const names = frame => frame.graph.passes.map(pass => pass.name)

/** Attach the plugin to a fresh headless renderer, the way the loader does. */
async function start(view) {
  const frame = await makeRenderer(null, view, VIEWPORT)
  const context = { renderer: frame }
  firstPerson.onLoad(context)
  return { frame, context }
}

/** Name every card call a frame makes, in call order. */
function recordCardCalls(frame) {
  const calls = []
  const render = frame.threeRenderer.render
  frame.threeRenderer.render = (scene, camera) => {
    calls.push(scene === frame.scene ? 'world' : 'viewmodel')
    return render.call(frame.threeRenderer, scene, camera)
  }
  const clearDepth = frame.threeRenderer.clearDepth
  frame.threeRenderer.clearDepth = () => {
    calls.push('clear-depth')
    return clearDepth.call(frame.threeRenderer)
  }
  return calls
}

/** The viewmodel scene from the last draw, or null when it did not draw. */
function captureViewmodel(frame) {
  let captured = null
  const render = frame.threeRenderer.render
  frame.threeRenderer.render = (scene, camera) => {
    if (scene !== frame.scene) captured = scene
    return render.call(frame.threeRenderer, scene, camera)
  }
  return () => captured
}

/** A minimal plugin scope: `on` is ignored, `defer` records a cleanup. */
function stubScope() {
  const cleanups = []
  return {
    on() {},
    defer(fn) { cleanups.push(fn) },
    dispose() { for (const fn of cleanups.reverse()) fn() }
  }
}

test('the viewmodel pass sits between the world and the UI', async () => {
  const { frame } = await start(PERSPECTIVE)
  assert.deepEqual(names(frame), ['frame', 'clear', 'scene', 'viewmodel', 'ui', 'present'])
})

test('a held viewmodel draws after the world, over a cleared depth', async () => {
  const { frame, context } = await start(PERSPECTIVE)
  const calls = recordCardCalls(frame)
  context.viewmodel.set({ model: 'weapon.glb' })
  frame.draw({ entities: [box('a')] })
  assert.deepEqual(calls, ['world', 'clear-depth', 'viewmodel'],
    'one world draw, then the depth clear and the viewmodel draw')
})

test('a flat view draws no viewmodel even when one is held', async () => {
  const { frame, context } = await start(ORTHO)
  const calls = recordCardCalls(frame)
  context.viewmodel.set({ model: 'weapon.glb' })
  frame.draw({ entities: [box('a')] })
  assert.ok(!calls.includes('viewmodel'), 'a 2D frame never draws the weapon')
})

test('the weapon has a key light of its own and follows the declared pose and sway', async () => {
  const { frame, context } = await start(PERSPECTIVE)
  const captured = captureViewmodel(frame)
  context.viewmodel.set({ model: 'weapon.glb', position: { x: 1, y: 0, z: 0 } })
  context.viewmodel.offset({ x: 0.5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
  frame.draw({ entities: [] })

  const scene = captured()
  assert.ok(scene, 'the viewmodel scene drew')
  assert.ok(scene.children.some(node => node.isDirectionalLight),
    'a key light is part of the pass, so the weapon reads the same anywhere')
  const root = scene.children.find(node => node.isGroup)
  assert.equal(root.position.x, 1.5, 'the sway offset adds to the declared position')
})

test('disabling the plugin takes its pass and its API away', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, VIEWPORT)
  const context = { renderer: frame }
  const scope = stubScope()
  firstPerson.onLoad(context, scope)
  assert.ok(context.viewmodel, 'the model API is published')
  assert.ok(names(frame).includes('viewmodel'), 'the pass is registered')

  scope.dispose()
  assert.equal(context.viewmodel, undefined, 'the model API is gone')
  assert.ok(!names(frame).includes('viewmodel'), 'the pass is gone')
})
