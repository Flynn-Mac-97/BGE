/**
 * `picking`: a world point in pixels, a pixel back in the world, and which
 * entities a pixel answers with.
 *
 * The flat view is exact and every point round trips; the perspective view is a
 * ray, so a pick there follows the geometry actually on screen and the ground
 * plane is the fallback under it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const PERSPECTIVE = { mode: 'perspective', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 90 }
const DOWN = { mode: 'perspective', x: 0, y: 0, z: 0, yaw: 0, pitch: -0.5, fov: 60 }
const viewport = () => ({ width: 320, height: 180 })

/** A world whose `byId` answers from its own list, as the entity pick expects. */
const withById = entities => ({ entities, byId: id => entities.find(entity => entity.id === id) })

const box = (id, x = 0, z = 0) => ({ id, type: 'wall', x, y: 0, z, mesh: { box: [1, 1, 1] } })
const flatBox = (id, width, height, rotation) => ({
  id,
  type: 'wall',
  x: 0,
  y: 0,
  z: 0,
  rotation,
  mesh: { box: [width, height, 1] }
})

test('the flat projection of a world point follows the view offset and zoom', async () => {
  const frame = await makeRenderer(null, { mode: 'ortho', x: 3, y: -2, z: 0, zoom: 2 }, viewport())
  assert.deepEqual(frame.toScreen(5, 4, 0), { x: 164, y: 78 })
})

test('the inverse flat projection puts a pixel back at its world point', async () => {
  const frame = await makeRenderer(null, { mode: 'ortho', x: 3, y: -2, z: 0, zoom: 2 }, viewport())
  assert.deepEqual(frame.toWorld(164, 78), { x: 5, y: 4 })
})

test('a point on the eye plane is in front of a perspective camera', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  assert.equal(frame.toScreen(0, 0, 0).behind, false)
})

test('a perspective point projects to the known part of the screen', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  assert.deepEqual(frame.toScreen(0, 0, -1), { x: 160, y: 90, behind: false })
  const top = frame.toScreen(0, 1, -1)
  assert.ok(Math.abs(top.x - 160) < 1e-9, `the centre column is x 160, got ${top.x}`)
  assert.ok(Math.abs(top.y) < 1e-9, `the top of the frame is y 0, got ${top.y}`)
})

test('a visible entity is under a perspective pixel', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  const world = withById([box('a', 0, -5)])
  frame.sync(world)
  assert.deepEqual(
    frame.pick(world, 160, 90).map(entity => entity.id),
    ['a']
  )
})

test('a hidden entity is not under a perspective pixel', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  const entities = [box('a', 0, -5)]
  const world = withById(entities)
  frame.sync(world)
  entities[0].hidden = true
  frame.sync(world)
  assert.deepEqual(frame.pick(world, 160, 90), [])
})

test('a body of parts is under a perspective pixel as one entity', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  const parts = [
    { box: [1, 1, 1], at: [-0.2, 0, 0] },
    { box: [1, 1, 1], at: [0.2, 0, 0] }
  ]
  const world = withById([{ id: 'statue', type: 'statue', x: 0, y: 0, z: -5, mesh: { parts } }])
  frame.sync(world)
  assert.deepEqual(
    frame.pick(world, 160, 90).map(entity => entity.id),
    ['statue']
  )
})

test('a flat pick includes an entity whose edge is exactly under the pixel', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  const entities = [box('edge', 0.5)]
  frame.sync({ entities })
  assert.deepEqual(
    frame.pick({ entities }, 161, 90).map(entity => entity.id),
    ['edge']
  )

  const vertical = [{ id: 'edge', type: 'wall', x: 0, y: 0.5, z: 0, mesh: { box: [1, 1, 1] } }]
  frame.sync({ entities: vertical })
  assert.deepEqual(
    frame.pick({ entities: vertical }, 160, 89).map(entity => entity.id),
    ['edge']
  )
})

test('a flat pick measures the entity from its own place, not the origin', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  const entities = [
    { ...flatBox('offset-x', 2, 2, 0), x: 2 },
    { ...flatBox('offset-y', 2, 2, 0), y: 2 }
  ]
  frame.sync({ entities })
  assert.deepEqual(
    frame.pick({ entities }, 161.5, 90).map(entity => entity.id),
    ['offset-x']
  )
  assert.deepEqual(
    frame.pick({ entities }, 160, 88.5).map(entity => entity.id),
    ['offset-y']
  )
})

test('a flat pick follows the box a spun sprite draws', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  const cases = [
    { label: 'narrow', width: 10, height: 20, worldX: 4.5, worldY: -3 },
    { label: 'wide', width: 30, height: 20, worldX: 5, worldY: 9 }
  ]
  for (const spin of cases) {
    const entities = [flatBox('spun', spin.width, spin.height, 30)]
    frame.sync({ entities })
    assert.deepEqual(
      frame.pick({ entities }, 160 + spin.worldX, 90 - spin.worldY).map(entity => entity.id),
      ['spun'],
      spin.label
    )
  }
})

test('a perspective pixel that hits nothing falls back ten units along the ray', async () => {
  const frame = await makeRenderer(null, DOWN, viewport())
  frame.sync({ entities: [] })
  const point = frame.toWorld(160, 90)
  assert.ok(
    Math.abs(Math.hypot(point.x, point.y, point.z) - 10) < 1e-9,
    `expected the point ten units from the eye, got ${JSON.stringify(point)}`
  )
})
