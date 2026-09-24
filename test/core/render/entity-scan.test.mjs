/**
 * `entity-scan`: the quiet snapshot, the scan that skips what did not change,
 * and the moving scan that places what only moved.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = (id, extra = {}) => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] }, ...extra })

const settle = (frame, world, frames = 50) => {
  for (let index = 0; index < frames; index++) frame.sync(world)
}

/** The world's blended place for the moving scan: the entity's own place at the blend. */
const blended = (into, entity, blend) => {
  into.x = entity.x * blend
  into.y = entity.y
  into.z = entity.z || 0
  into.yaw = entity.yaw
  return into
}

test('an unchanged entity with a collider and a scale is skipped by the quiet scan', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let draws = 0
  frame.marks.register('probe', { draw: () => draws++ })
  const entity = box('a', { collider: { box: [1, 1, 1] }, scale: 2 })
  const world = { entities: [entity] }
  settle(frame, world)

  draws = 0
  frame.sync(world)
  assert.equal(draws, 0)
})

test('a changed scale draws the entity again', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let draws = 0
  frame.marks.register('probe', { draw: () => draws++ })
  const entity = box('a')
  const world = { entities: [entity] }
  settle(frame, world)

  entity.scale = 3
  draws = 0
  frame.sync(world)
  assert.equal(draws, 1)
})

test('an entity with an array rotation always takes the full pass', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let draws = 0
  frame.marks.register('probe', { draw: () => draws++ })
  const entity = box('a', { rotation: [0, 0, 0] })
  const world = { entities: [entity] }
  settle(frame, world)

  draws = 0
  frame.sync(world)
  assert.equal(draws, 1)
})

test('a steady entity that moved is placed once at its blended place', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', { blocksMerge: () => true, draw: () => {}, move: () => moved++ })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 10
  entity.y = 2
  entity.z = 3
  frame.sync(world, 0.5)
  assert.equal(frame.objectFor(entity).position.z, 3)

  moved = 0
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a moving entity is placed with the declaration and shape its record holds', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let seen = null
  frame.marks.register('probe', {
    blocksMerge: () => true,
    draw: () => {},
    move: (entity, declared, shape) => {
      seen = { declared, shape }
    }
  })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 5
  frame.sync(world, 0.5)
  assert.equal(seen.declared, entity.mesh)
  assert.equal(seen.shape.kind, 'box')
  assert.equal(seen.shape.w, 1)
})

test('a quiet sweep keeps the entities still in the list', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const first = box('a')
  const second = box('b')
  const third = box('c')
  const world = { entities: [first, second, third] }
  settle(frame, world)

  world.entities = [first, second]
  frame.sync(world)
  assert.ok(frame.objectFor(first))
  assert.ok(frame.objectFor(second))
  assert.equal(frame.objectFor(third), null)
})

test('a quiet frame counts the outline a mark set', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.marks.register('outline', {
    draw: (entity, object, place, declared, record) => {
      record.outline = true
    }
  })
  const world = { entities: [box('a')] }
  settle(frame, world)

  frame.sync(world)
  assert.equal(frame.stats.keylines, 1)
})

test('a merged entity that moves is not placed by the moving scan', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', { draw: () => {}, move: () => moved++ })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 5
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a reordered list takes the full pass rather than placing the wrong object', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', { blocksMerge: () => true, draw: () => {}, move: () => moved++ })
  const first = box('a')
  const second = { ...first, id: 'b', x: 1 }
  const world = { entities: [first, second], drawnPlaceInto: blended }
  settle(frame, world)

  world.entities = [second, first]
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a steady entity that has not moved is not placed, even when a mark holds it', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', { holds: () => true, blocksMerge: () => true, draw: () => {}, move: () => moved++ })
  const entity = box('a', { y: 2, z: 3 })
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  moved = 0
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a playing frame that only moves an entity reaches its place step', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let places = 0
  frame.marks.register('probe', { draw: () => {}, place: () => places++ })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  places = 0
  frame.sync(world, 0.5)
  assert.equal(places, 1)
})
