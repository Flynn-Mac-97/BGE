/**
 * `entity-look`: where a model's origin is, which cell of a sheet a frame shows,
 * and the stable colour an untextured type falls back to.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchorOffset, frameWindow, entityTint } from '../../../engine/render/entity-look.js'
import { captureConsoleError } from './report-capture.mjs'

test('a mesh that declares no anchor is not moved and nothing is reported', () => {
  let offset = null
  const said = captureConsoleError(() => {
    offset = anchorOffset({ type: 'wall', mesh: { box: [1, 2, 1] } })
  })
  assert.equal(offset, 0)
  assert.deepEqual(said, [])
})

test('a feet anchor drops the model by half its declared box height', () => {
  const entity = { type: 'hero', mesh: { model: 'hero.glb', anchor: 'feet', box: [1, 2, 1] } }
  assert.equal(anchorOffset(entity), -1)
})

test('a feet anchor falls back to the collider height when no box is declared', () => {
  const entity = { type: 'hero', mesh: { model: 'hero.glb', anchor: 'feet' }, collider: { box: [1, 4, 1] } }
  assert.equal(anchorOffset(entity), -2)
})

test('a centre anchor keeps the entity at its own centre', () => {
  const entity = { type: 'hero', mesh: { model: 'hero.glb', anchor: 'centre', box: [1, 2, 1] } }
  assert.equal(anchorOffset(entity), 0)
})

test('a misspelt anchor is named and treated as the centre', () => {
  const entity = { type: 'hero', mesh: { model: 'hero.glb', anchor: 'foot', box: [1, 2, 1] } }
  let offset = null
  const said = captureConsoleError(() => {
    offset = anchorOffset(entity)
  })
  assert.equal(offset, 0)
  assert.equal(said.length, 1)
  assert.match(said[0], /anchor is "foot"/)
})

test('a sheet window is measured from the declared cell size', () => {
  const window = frameWindow({ size: [16, 32] }, 0, { width: 64, height: 64 })
  assert.deepEqual(window.repeat, [0.25, 0.5])
  assert.deepEqual(window.offset, [0, 0.5])
})

test('a sprite with no cell size shows the whole image', () => {
  const window = frameWindow({}, 0, { width: 64, height: 32 })
  assert.deepEqual(window.repeat, [1, 1])
  assert.deepEqual(window.offset, [0, 0])
})

test('a frame later in the sheet moves the window right and down', () => {
  const window = frameWindow({ size: [16, 16] }, 5, { width: 64, height: 64 })
  assert.deepEqual(window.repeat, [0.25, 0.25])
  assert.deepEqual(window.offset, [0.25, 0.5])
})

test('a type keeps the same untextured colour every time', () => {
  assert.equal(entityTint('wall').getHexString(), 'd9cdab')
  assert.equal(entityTint('hero').getHexString(), 'd9b4ab')
})
