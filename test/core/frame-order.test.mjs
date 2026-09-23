/**
 * The frame's shape: world matrices first, then the clear and the world, the
 * post chain's pass, the viewmodel, the UI and the present.
 *
 * The order is a promise to a plugin, not an internal detail: a pass ordered
 * against a label sees the picture as it was at that point. A post chain is a
 * plugin pass that disables the kernel's clear and scene draw, so the two paths
 * never both draw the world.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

const PERSPECTIVE = { mode: 'perspective', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 75 }
const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })
const names = frame => frame.graph.passes.map(pass => pass.name)

/** Name every card draw a frame makes by the scene it draws, in call order. */
function watchCardDraws(frame) {
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

test('the frame declares its core passes in the order they run', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  assert.deepEqual(names(frame), ['frame', 'clear', 'scene', 'viewmodel', 'ui', 'present'])
})

test('a held viewmodel draws after the world, once, with the post pass between them', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, VIEWPORT)
  const draws = watchCardDraws(frame)
  const boundaries = []
  // The probe runs at the boundary the post chain occupies.
  frame.graph.add({ name: 'at-post', after: ['scene'], before: ['viewmodel'], execute: () => boundaries.push('post') })

  frame.sync({ entities: [box('a')] })
  // `set` holds the weapon at once, before its file arrives, so the pass is
  // present for this frame without waiting on a model.
  frame.viewmodel.set({ model: 'weapon.glb' })
  frame.draw()

  assert.deepEqual(draws, ['world', 'clear-depth', 'viewmodel'],
    'one world draw, then one depth clear and one viewmodel draw')
  assert.deepEqual(boundaries, ['post'],
    'the post pass sits between the world draw and the viewmodel draw')
})

test('a flat view draws no viewmodel pass even when one is held', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  const draws = watchCardDraws(frame)
  frame.sync({ entities: [box('a')] })
  frame.viewmodel.set({ model: 'weapon.glb' })
  frame.draw()
  assert.deepEqual(draws, ['world'], 'a 2D frame has one pass')
})

test('a post pass takes the world draw, so the kernel clear and scene pass stand down', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  const draws = watchCardDraws(frame)
  const log = []
  frame.sync({ entities: [box('a')] })
  frame.draw()
  assert.deepEqual(draws, ['world'], 'no post pass draws the world once')

  draws.length = 0
  frame.graph.add({ name: 'post', after: ['scene'], before: ['viewmodel'], execute: () => log.push('post') })
  frame.graph.disable('scene')
  frame.graph.disable('clear')
  frame.draw()
  assert.deepEqual(draws, [], 'the chain owns the scene, so the kernel scene pass does not draw underneath it')
  assert.deepEqual(log, ['post'], 'the chain pass ran in its place')

  frame.graph.remove('post')
  frame.graph.enable('scene')
  frame.graph.enable('clear')
  draws.length = 0
  frame.draw()
  assert.deepEqual(draws, ['world'], 'removing the chain gives the world draw back')
})
