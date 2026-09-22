/**
 * `boundsOf` must report the size the renderer draws, or See frames and
 * measures a model at its unscaled size.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { boundsOf } from '../plugins/builtin/see/frame-facts.js'

test('a model box is multiplied by the mesh scale and the entity scale', () => {
  const entity = { scale: 2, mesh: { model: 'models/hero.glb', scale: 0.5, box: [1, 3, 0.5] } }
  assert.deepEqual(boundsOf(entity), { w: 1, h: 3, l: 0.5 })
})

test('a mesh scale without a model does not change a plain box', () => {
  assert.deepEqual(boundsOf({ mesh: { scale: 0.5, box: [1, 2, 3] } }), { w: 1, h: 2, l: 3 })
})
