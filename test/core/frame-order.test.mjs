/**
 * The frame's shape: the world, then the post chain, then the viewmodel.
 *
 * The order is a promise to a plugin, not an internal detail: a draw registered
 * before a named stage sees the picture as it was at that point. The default
 * frame draws the world exactly once, and the post stage never draws a second
 * copy of it — the two paths must not both fire.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

const PERSPECTIVE = { mode: 'perspective', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 75 }
const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })

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

test('the frame declares its three core stages in the order they run', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  assert.deepEqual(frame.stages.names, ['world', 'post', 'viewmodel'])
})

test('a held viewmodel draws after the world, once, with the post stage between them', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, VIEWPORT)
  const draws = watchCardDraws(frame)
  const boundaries = []
  // Each probe runs at the boundary of the stage it is named for.
  frame.stages.add('at-post', () => boundaries.push('post'), { before: 'post' })
  frame.stages.add('at-viewmodel', () => boundaries.push('viewmodel'), { before: 'viewmodel' })

  frame.sync({ entities: [box('a')] })
  // `set` holds the weapon at once, before its file arrives, so the pass is
  // present for this frame without waiting on a model.
  frame.viewmodel.set({ model: 'weapon.glb' })
  frame.draw()

  assert.deepEqual(draws, ['world', 'clear-depth', 'viewmodel'],
    'one world draw, then one depth clear and one viewmodel draw')
  assert.deepEqual(boundaries, ['post', 'viewmodel'],
    'the post stage sits between the world draw and the viewmodel draw')
})

test('a flat view draws no viewmodel pass even when one is held', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  const draws = watchCardDraws(frame)
  frame.sync({ entities: [box('a')] })
  frame.viewmodel.set({ model: 'weapon.glb' })
  frame.draw()
  assert.deepEqual(draws, ['world'], 'a 2D frame has one pass')
})

test('a pass chain takes the world draw, so the core world stage stands down', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  const draws = watchCardDraws(frame)
  frame.sync({ entities: [box('a')] })
  frame.draw()
  assert.equal(draws.length, 1, 'no chain draws the world once')

  draws.length = 0
  frame.passes.set([{ name: 'probe', apply: colour => colour }])
  frame.draw()
  assert.equal(draws.length, 0, 'a chain owns the scene pass, so the world stage does not draw underneath it')

  // Take the chain down while its shaders still compile; the next frame draws
  // the world directly again.
  frame.passes.set([])
  draws.length = 0
  frame.draw()
  assert.deepEqual(draws, ['world'], 'an empty chain gives the world draw back')
})
