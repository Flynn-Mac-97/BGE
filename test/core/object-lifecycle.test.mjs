/**
 * `renderer.objectFor` and `renderer.dispose` — the entity-to-object lookup and
 * the release a plugin uses for an object it added.
 *
 * `objectFor` answers null before the object exists, so a plugin never has to
 * traverse the scene guessing. `dispose` walks the object and its children, so a
 * plugin that added geometry and materials releases them with one call.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] } })

test('objectFor is null before the entity is built and answers the object afterwards', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  const world = { entities: [entity] }

  assert.equal(frame.objectFor(entity), null, 'nothing is built before the first sync')
  frame.sync(world)
  const object = frame.objectFor(entity)
  assert.ok(object, 'the entity has an object once it is synced')
  assert.equal(object.userData.entity, 'a')
  assert.equal(frame.objectFor(box('never-built')), null)
})

test('an entity that leaves the world has no object left to answer with', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  frame.sync({ entities: [entity] })
  assert.ok(frame.objectFor(entity))

  frame.sync({ entities: [] })
  assert.equal(frame.objectFor(entity), null)
})

test('dispose releases a plugin-added object and everything under it', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const group = new THREE.Group()
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  group.add(child)

  let groupReleased = 0
  let childReleased = 0
  group.addEventListener('dispose', () => groupReleased++)
  child.addEventListener('dispose', () => childReleased++)

  frame.scene.add(group)
  frame.dispose(group)

  assert.equal(groupReleased, 1, 'the object itself is released')
  assert.equal(childReleased, 1, 'its children are released too')
})

test('releasing an entity the world dropped disposes the object it stood for', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  frame.sync({ entities: [entity] })
  const object = frame.objectFor(entity)

  let released = 0
  object.addEventListener('dispose', () => released++)
  frame.sync({ entities: [] })

  assert.equal(released, 1, 'the sweep releases the object that left')
})
