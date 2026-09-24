/**
 * `batching`: which entities merge into one draw call, when a merged mesh is
 * rebuilt, and what a moving entity is compared against.
 *
 * A merged entity is drawn by the merged copy, so the only honest checks are the
 * counts the frame reports and the merged mesh itself: a batch that is not
 * rebuilt still draws the entity that left it, and a field left out of the
 * stillness compare leaves a moved entity drawn at its old place.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = (id, extra = {}) => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] }, ...extra })

/** The settle window is 45 frames; run past it so a quiet world merges. */
const settle = (frame, world, frames = 50) => {
  for (let index = 0; index < frames; index++) frame.sync(world)
}

/** The merged copies in the scene: they carry a batch key and stand for no entity. */
const mergedObjects = frame => frame.scene.children.filter(child => child.userData.batch && !child.userData.entity)

/** Eight walls that always take the full pass, because an array rotation is never skipped. */
const rotatableWorld = () => ({
  entities: Array.from({ length: 8 }, (unused, index) => box(`e${index}`, { rotation: [0, 0, 0] }))
})

test('an entity that changes only one field still leaves its batch', async () => {
  const changes = [
    ['its y', entity => (entity.y = 5)],
    ['its z', entity => (entity.z = 5)],
    ['its pitch', entity => (entity.rotation = [45, 0, 0])],
    ['its yaw', entity => (entity.rotation = [0, 45, 0])],
    ['its roll', entity => (entity.rotation = [0, 0, 45])],
    ['its scale', entity => (entity.scale = 2)]
  ]

  for (const [label, change] of changes) {
    const frame = await makeRenderer(null, VIEW, VIEWPORT)
    const world = rotatableWorld()
    settle(frame, world)
    assert.equal(frame.stats.merged, 8, `${label}: the world merged before the change`)

    change(world.entities[0])
    frame.sync(world)
    assert.equal(frame.stats.merged, 7, `a change to ${label} takes the entity out of the batch`)
  }
})

test('an entity with a depth still merges once it holds still', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (unused, index) => box(`e${index}`, { z: 5 })) }
  settle(frame, world)
  assert.equal(frame.stats.merged, 8)
})

test('a group of exactly four entities merges', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 4 }, (unused, index) => box(`e${index}`)) }
  settle(frame, world)
  assert.equal(frame.stats.merged, 4)
})

test('entities in different grid cells merge into different batches', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = {
    entities: [
      ...Array.from({ length: 4 }, (unused, index) => box(`a${index}`, { z: 0 })),
      ...Array.from({ length: 4 }, (unused, index) => box(`b${index}`, { z: 40 }))
    ]
  }
  settle(frame, world)
  assert.equal(frame.stats.merged, 8)
  assert.equal(frame.stats.batches, 2, 'a batch spans one grid cell, or it can never be culled')
})

test('a still frame does not rebuild the merged mesh', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (unused, index) => box(`e${index}`)) }
  settle(frame, world)
  const before = mergedObjects(frame)
  assert.equal(before.length, 1, 'the eight walls are one merged copy')

  frame.sync(world)
  const after = mergedObjects(frame)
  assert.equal(after.length, 1)
  assert.equal(after[0], before[0], 'a frame that changed nothing kept the merged mesh it had')
})

test('an entity that stops being mergeable leaves its batch and the mesh is rebuilt', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (unused, index) => box(`e${index}`)) }
  settle(frame, world)
  const before = mergedObjects(frame)[0]
  assert.equal(before.geometry.attributes.position.count, 8 * 24, 'a box is 24 vertices')

  world.entities[0].opacity = 0.5
  frame.sync(world)

  assert.equal(frame.stats.merged, 7, 'a dimmed entity owns its own material, so it cannot be merged')
  const after = mergedObjects(frame)[0]
  assert.equal(after.geometry.attributes.position.count, 7 * 24, 'the merged mesh no longer contains it')
})

test('a still frame does not drop a settled entity out of its batch', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (unused, index) => box(`e${index}`)) }
  settle(frame, world)

  frame.sync(world)
  frame.sync(world)
  assert.equal(frame.stats.merged, 8, 'an entity that still wants its batch stays in it')
})

test('a merged mesh does not recompute its own matrix', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: Array.from({ length: 8 }, (unused, index) => box(`e${index}`)) }
  settle(frame, world)
  assert.equal(mergedObjects(frame)[0].matrixAutoUpdate, false)
})
