/**
 * The frame's shape: world matrices first, then the clear and the world, the
 * post chain's pass, the UI and the present.
 *
 * The order is a promise to a plugin, not an internal detail: a pass ordered
 * against a label sees the picture as it was at that point. A post chain is a
 * plugin pass that disables the kernel's clear and scene draw, so the two paths
 * never both draw the world.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })
const names = frame => frame.graph.passes.map(pass => pass.name)

/** Name every card draw a frame makes by the scene it draws, in call order. */
function watchCardDraws(frame) {
  const calls = []
  const render = frame.threeRenderer.render
  frame.threeRenderer.render = (scene, camera) => {
    calls.push(scene === frame.scene ? 'world' : 'other')
    return render.call(frame.threeRenderer, scene, camera)
  }
  return calls
}

test('the frame declares its core passes in the order they run', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  assert.deepEqual(names(frame), ['frame', 'clear', 'scene', 'ui', 'present'])
})

test('a post pass takes the world draw, so the kernel clear and scene pass stand down', async () => {
  const frame = await makeRenderer(null, ORTHO, VIEWPORT)
  const draws = watchCardDraws(frame)
  const log = []
  frame.sync({ entities: [box('a')] })
  frame.draw()
  assert.deepEqual(draws, ['world'], 'no post pass draws the world once')

  draws.length = 0
  frame.graph.add({ name: 'post', after: ['scene'], before: ['ui'], execute: () => log.push('post') })
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
