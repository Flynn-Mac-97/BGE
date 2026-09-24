/**
 * `entity-sync`: the walk that draws what changed, the turn it writes, the
 * sprite and anchor fields it sets, and the frame it counts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../../engine/render.js'
import { modelCache } from '../../../engine/render/model-cache.js'
import { withImageDocument } from './image-document.mjs'
import { captureConsoleError } from './report-capture.mjs'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = (id, extra = {}) => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] }, ...extra })
const partsEntity = id => ({ id, type: 'statue', x: 0, y: 0, z: 0, mesh: { parts: [{ box: [1, 1, 1], name: 'leg' }] } })
const sprite = (id, extra = {}) => ({ id, type: 'wall', x: 0, y: 0, z: 0, sprite: { width: 1, height: 1 }, ...extra })

const settle = (frame, world, frames = 50) => {
  for (let index = 0; index < frames; index++) frame.sync(world)
}

/** The world's blended place for the moving scan: half way along the entity's own move. */
const blended = (into, entity, blend) => {
  into.x = entity.x * blend
  into.y = entity.y
  into.z = entity.z || 0
  into.yaw = entity.yaw
  return into
}

test('a changed pitch turns the object again', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { rotation: [45, 0, 0] })
  frame.sync({ entities: [entity] })

  entity.rotation = [60, 0, 0]
  frame.sync({ entities: [entity] })
  assert.ok(Math.abs(frame.objectFor(entity).rotation.x - (60 * Math.PI) / 180) < 1e-9)
})

test('a changed yaw turns the object again', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  frame.sync({ entities: [entity] })

  entity.yaw = 1
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).rotation.y, 1)
})

test('a changed roll turns the object again', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { rotation: [0, 0, 30] })
  frame.sync({ entities: [entity] })

  entity.rotation = [0, 0, 50]
  frame.sync({ entities: [entity] })
  assert.ok(Math.abs(frame.objectFor(entity).rotation.z - (50 * Math.PI) / 180) < 1e-9)
})

test('a rebuilt object gets the turn written again', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { yaw: 1 })
  frame.sync({ entities: [entity] })

  entity.mesh = { box: [2, 2, 2] }
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).rotation.y, 1)
})

test('a body of parts is never merged into a batch', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const world = { entities: [partsEntity('statue')] }
  const said = captureConsoleError(() => settle(frame, world, 60))
  assert.deepEqual(
    said.filter(line => line.includes('threw')),
    []
  )
  assert.equal(frame.stats.merged, 0)
})

test('a body of parts is not placed by the moving scan', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', { blocksMerge: () => true, draw: () => {}, move: () => moved++ })
  const entity = partsEntity('statue')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 5
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a mark that says it is not ready keeps its entity off the moving scan', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', {
    blocksMerge: () => true,
    draw: (entity, object, place, declared, record) => {
      record.markReady = false
    },
    move: () => moved++
  })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 5
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a mark that holds a moving entity keeps it off the moving scan', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', {
    blocksMerge: () => true,
    holdsMoving: () => true,
    draw: () => {},
    move: () => moved++
  })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 5
  frame.sync(world, 0.5)
  assert.equal(moved, 0)
})

test('a mark whose holdsMoving answers no lets the moving scan follow the entity', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  let moved = 0
  frame.marks.register('probe', {
    blocksMerge: () => true,
    holdsMoving: () => false,
    draw: () => {},
    move: () => moved++
  })
  const entity = box('a')
  const world = { entities: [entity], drawnPlaceInto: blended }
  settle(frame, world)

  entity.x = 5
  frame.sync(world, 0.5)
  assert.equal(moved, 1, 'the moving scan answers an entity no mark is holding')
})

test('a model without a pose still syncs the frame', async () => {
  modelCache.set('ready-model.glb', { status: 'ready', scene: new THREE.Group(), waiting: [] })
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = { id: 'hero', type: 'hero', x: 0, y: 0, z: 0, mesh: { model: 'ready-model.glb' } }
  frame.sync({ entities: [entity] })
  modelCache.delete('ready-model.glb')
  assert.equal(frame.stats.entities, 1)
})

test('a pose turns the named node of a model', async () => {
  const scene = new THREE.Group()
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  arm.name = 'arm'
  scene.add(arm)
  modelCache.set('posed-model.glb', { status: 'ready', scene, waiting: [] })

  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = { id: 'hero', type: 'hero', x: 0, y: 0, z: 0, mesh: { model: 'posed-model.glb' }, pose: { arm: 0.3 } }
  frame.sync({ entities: [entity] })
  modelCache.delete('posed-model.glb')
  assert.equal(frame.objectFor(entity).getObjectByName('arm').rotation.x, 0.3)
})

test('a tiled sprite repeats its map once per tile', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const entity = sprite('s', { sprite: { image: 'tiled.png', width: 4, height: 2, tile: 2 } })
    frame.sync({ entities: [entity] })
    assert.deepEqual(frame.objectFor(entity).material.map.repeat.toArray(), [2, 1])
  })
})

test('a sprite with no tiling keeps its repeat at one', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const entity = sprite('s', { sprite: { image: 'plain.png', width: 4, height: 2 } })
    frame.sync({ entities: [entity] })
    assert.deepEqual(frame.objectFor(entity).material.map.repeat.toArray(), [1, 1])
  })
})

test('a sheet sprite shows one cell of its sheet', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const entity = sprite('s', { sprite: { sheet: 'sheet.png', size: [16, 16] }, frame: 5 })
    frame.sync({ entities: [entity] })
    const map = frame.objectFor(entity).material.map
    map.image = { width: 64, height: 64 }

    entity.x = 1
    frame.sync({ entities: [entity] })
    assert.deepEqual(map.repeat.toArray(), [0.25, 0.25])
    assert.deepEqual(map.offset.toArray(), [0.25, 0.5])
  })
})

test('a sheet with no image yet is left alone', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  withImageDocument(() => {
    const entity = sprite('s', { sprite: { sheet: 'no-image-yet.png', width: 16, height: 16 } })
    frame.sync({ entities: [entity] })
  })
  assert.equal(frame.stats.entities, 1)
})

test('a flat sprite does not test depth, because painter order decides', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = sprite('s')
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).material.depthTest, false)
})

test('a sprite layers by its depth and its place in the list', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entities = [sprite('low', { z: 1 }), sprite('high', { z: 2 })]
  frame.sync({ entities })
  assert.equal(frame.objectFor(entities[0]).renderOrder, 1000)
  assert.equal(frame.objectFor(entities[1]).renderOrder, 2001)
})

test('an anchored mesh is drawn by its declared anchor', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('hero', { type: 'hero', mesh: { box: [1, 2, 1], anchor: 'feet' } })
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).position.y, -1)
})

test('a flat entity keeps its z on the object', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { z: 5 })
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).position.z, 5)
})

test('a visible entity has a visible object', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).visible, true)
})

test('a playing frame draws an entity at the place the world interpolates', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  const world = {
    entities: [entity],
    drawnPlace: (given, blend) => ({ x: given.x * blend, y: given.y, z: given.z || 0, yaw: given.yaw })
  }
  frame.sync(world)

  entity.x = 10
  frame.sync(world, 0.5)
  assert.equal(frame.objectFor(entity).position.x, 5)
})

test('a frame with one new entity reports the whole list', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const first = box('a')
  const second = box('b')
  const world = { entities: [first, second] }
  settle(frame, world)

  world.entities = [first, second, box('c')]
  frame.sync(world)
  assert.equal(frame.stats.entities, 3)
})
