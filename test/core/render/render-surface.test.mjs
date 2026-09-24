/**
 * Surfaces `render.js` exposes to a plugin: the bone-texture wrap three is
 * given once, and the model status a capture waits on.
 *
 * Both are read from outside the frame: the wrap is on three's own node builder,
 * so every skinned draw in the page sees it, and `modelState` is how a caller
 * asks whether a declared model has arrived.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../../engine/render.js'
import { modelCache } from '../../../engine/render/model-cache.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

test('a skinned mesh is answered a zero uniform-buffer limit, so bones upload as a texture', () => {
  const limit = THREE.NodeBuilder.prototype.getUniformBufferLimit
  assert.equal(limit.forcedBoneTexture, true, 'the wrap is installed once and marked')
  assert.equal(limit.call({ object: { isSkinnedMesh: true } }), 0, 'a skinned mesh takes the texture path')
})

test('modelState answers a cached model status, and null for a file nothing cached', async () => {
  modelCache.set('probe.glb', { status: 'loading', waiting: [] })
  const frame = await makeRenderer(null, VIEW, VIEWPORT)

  assert.equal(frame.modelState('probe.glb'), 'loading', 'a cached model answers its own status')
  assert.equal(frame.modelState('never-cached.glb'), null, 'an unknown file answers nothing')

  modelCache.delete('probe.glb')
})
