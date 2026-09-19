/**
 * The renderer's per-entity `sync`, built and run with no GL context.
 *
 * `sync` is where the frame's thread cost is; the card only draws what sync
 * described. A frame made with no canvas runs the real scene graph, so a
 * headless run can measure it. These tests also pin the 45-frame merge settle,
 * because a sync measured before it settles reads a world that draws very
 * differently.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] } })

test('a frame built with no canvas syncs a world and reports what it holds', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.sync({ entities: [box('a'), box('b')] })
  assert.equal(frame.stats.entities, 2)
})

test('a headless frame never draws, because there is no card to draw into', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.sync({ entities: [box('a')] })
  frame.draw()
  // Nothing threw and nothing was submitted: the CPU time the drawing half
  // would have written stays at zero.
  assert.equal(frame.stats.cpuMs, 0)
})

test('entities merge once they have held still for the settle window', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (_, index) => box(`e${index}`)) }
  frame.sync(world)
  assert.equal(frame.stats.merged, 0)
  // Settling is 45 frames; one more merges them into a batch.
  for (let index = 0; index < 45; index++) frame.sync(world)
  assert.equal(frame.stats.merged, 8)
  assert.ok(frame.stats.batches >= 1)
})

test('moving an entity takes it straight back out of its batch', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (_, index) => box(`e${index}`)) }
  for (let index = 0; index < 46; index++) frame.sync(world)
  assert.equal(frame.stats.merged, 8)
  world.entities[0].x = 5
  frame.sync(world)
  assert.equal(frame.stats.merged, 7)
})
