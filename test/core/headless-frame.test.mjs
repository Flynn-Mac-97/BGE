/**
 * The renderer's per-entity `sync`, built and run with no GL context.
 *
 * `sync` is where the frame's CPU cost is; the card only draws what `sync`
 * described. A frame made with no canvas runs the real scene graph, so a
 * headless run can measure it. The settle window is the renderer's business:
 * what is asserted here is the contract — a world that stops moving merges, a
 * moved entity is not merged, and a headless frame submits nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

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

test('entities that hold still merge into batches, and a moving one leaves its batch', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (_, index) => box(`e${index}`)) }
  frame.sync(world)
  assert.equal(frame.stats.merged, 0, 'nothing merges before it has held still')

  // The renderer decides how many frames "held still" means; the contract is
  // that a world which stops moving merges within a bounded number of frames.
  let frames = 0
  while (frame.stats.merged < world.entities.length && frames < 180) {
    frame.sync(world)
    frames++
  }
  assert.equal(frame.stats.merged, world.entities.length, `static entities merged after ${frames} frames`)
  assert.ok(frame.stats.batches >= 1)

  world.entities[0].x = 5
  frame.sync(world)
  assert.equal(frame.stats.merged, 7, 'a moved entity is not merged while it moves')
})
