/**
 * `object-builder`: the scene object standing for an entity, the turn a pose
 * writes into it, the shared material it keeps or clones, and the release that
 * goes with the object leaving.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../../engine/render.js'
import { clearReported } from '../../../engine/render/report.js'
import { captureConsoleError } from './report-capture.mjs'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const box = (id, extra = {}) => ({ id, type: 'wall', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] }, ...extra })
const partsEntity = (id, parts) => ({ id, type: 'statue', x: 0, y: 0, z: 0, mesh: { parts } })
const legPart = () => ({ box: [1, 1, 1], name: 'leg', rotation: [30, 0, 0] })

test('a pose turns the named part of a body of parts', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = partsEntity('statue', [legPart()])
  frame.sync({ entities: [entity] })

  entity.pose = { leg: 0.1 }
  frame.sync({ entities: [entity] })
  const leg = frame.objectFor(entity).getObjectByName('leg')
  assert.ok(Math.abs(leg.rotation.x - (Math.PI / 6 + 0.1)) < 1e-9)
})

test('a quaternion pose turns the named part', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = partsEntity('statue', [legPart()])
  frame.sync({ entities: [entity] })

  entity.pose = { leg: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }
  frame.sync({ entities: [entity] })
  const leg = frame.objectFor(entity).getObjectByName('leg')
  assert.ok(Math.abs(leg.quaternion.z - Math.SQRT1_2) < 1e-9, 'the turn reached the quaternion')
})

test('a seven-number pose also moves the named part', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = partsEntity('statue', [legPart()])
  frame.sync({ entities: [entity] })

  entity.pose = { leg: [0, 0, 0, 1, 1, 2, 3] }
  frame.sync({ entities: [entity] })
  assert.deepEqual(frame.objectFor(entity).getObjectByName('leg').position.toArray(), [1, 2, 3])
})

test('a four-number pose leaves the named part where it is', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = partsEntity('statue', [{ box: [1, 1, 1], name: 'leg', at: [0.4, 0, 0] }])
  frame.sync({ entities: [entity] })

  entity.pose = { leg: [0, 0, 0, 1] }
  frame.sync({ entities: [entity] })
  assert.deepEqual(frame.objectFor(entity).getObjectByName('leg').position.toArray(), [0.4, 0, 0])
})

test('a pose that names no part is reported against the entity', async () => {
  clearReported()
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = partsEntity('statue', [legPart()])
  frame.sync({ entities: [entity] })

  entity.pose = { tail: 0.2 }
  const said = captureConsoleError(() => {
    frame.sync({ entities: [entity] })
  })
  assert.ok(said.some(line => line.includes('statue: no node named "tail"')))
})

test('dropping one wall does not dispose the material another wall shares', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const first = box('a')
  const second = box('b')
  frame.sync({ entities: [first, second] })
  const material = frame.objectFor(second).material
  let disposed = 0
  material.addEventListener('dispose', () => disposed++)

  frame.sync({ entities: [second] })
  assert.equal(disposed, 0)
  assert.equal(frame.objectFor(second).material, material)
})

test('dropping one body of parts does not dispose a material another body shares', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const first = partsEntity('statue-a', [legPart()])
  const second = partsEntity('statue-b', [legPart()])
  frame.sync({ entities: [first, second] })
  const material = frame.objectFor(second).children[0].material
  let disposed = 0
  material.addEventListener('dispose', () => disposed++)

  frame.sync({ entities: [second] })
  assert.equal(disposed, 0)
})

test('dropping a sprite disposes the material it owns', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = { id: 's', type: 'wall', x: 0, y: 0, z: 0, sprite: { width: 1, height: 1 } }
  frame.sync({ entities: [entity] })
  const material = frame.objectFor(entity).material
  let disposed = 0
  material.addEventListener('dispose', () => disposed++)

  frame.sync({ entities: [] })
  assert.equal(disposed, 1)
})

test('a dropped model is marked stale before its file arrives', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = { id: 'hero', type: 'hero', x: 0, y: 0, z: 0, mesh: { model: 'never-loads.glb' } }
  frame.sync({ entities: [entity] })
  const holder = frame.objectFor(entity)

  frame.sync({ entities: [] })
  assert.equal(holder.userData.stale, true)
  frame.forget('never-loads.glb')
})

test('a changed look rebuilds the object', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  frame.sync({ entities: [entity] })
  const first = frame.objectFor(entity)

  entity.mesh = { box: [2, 2, 2] }
  frame.sync({ entities: [entity] })
  const second = frame.objectFor(entity)
  assert.notEqual(second, first)
  assert.notEqual(second.geometry, first.geometry)
})

test('a built object does not recompute its own matrix every traversal', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a')
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).matrixAutoUpdate, false)
})

test('an id swapped for a new one drops the object the old id stood for', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.sync({ entities: [box('a')] })
  frame.sync({ entities: [box('b')] })
  assert.equal(frame.objectFor({ id: 'a' }), null)
  assert.ok(frame.objectFor({ id: 'b' }))
})

test('opacity one leaves a shared material shared', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { opacity: 1 })
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).userData.privateMaterial, false)
})

test('dimming to half sets the material opacity', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { opacity: 0.5 })
  frame.sync({ entities: [entity] })
  assert.ok(Math.abs(frame.objectFor(entity).material.opacity - 0.5) < 1e-9)
})

test('dimming one of two identical walls leaves the other alone', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const first = box('a')
  const second = box('b')
  const world = { entities: [first, second] }
  frame.sync(world)
  const shared = frame.objectFor(second).material

  first.opacity = 0.5
  frame.sync(world)
  assert.equal(frame.objectFor(second).material, shared)
  assert.ok(Math.abs(shared.opacity - 1) < 1e-9)
  assert.notEqual(frame.objectFor(first).material, shared)
})

test('dimming the same object twice keeps the material it already made private', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const entity = box('a', { opacity: 0.5 })
  frame.sync({ entities: [entity] })
  const material = frame.objectFor(entity).material

  entity.opacity = 0.25
  frame.sync({ entities: [entity] })
  assert.equal(frame.objectFor(entity).material, material)
})

test('a release outside a compile is not disposed again when a compile ends', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const group = new THREE.Group()
  frame.scene.add(group)
  let disposed = 0
  group.addEventListener('dispose', () => disposed++)

  frame.dispose(group)
  frame.beginCompile()
  frame.endCompile()
  assert.equal(disposed, 1)
})

test('a release inside a compile is disposed again when the compile ends', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const group = new THREE.Group()
  frame.scene.add(group)
  let disposed = 0
  group.addEventListener('dispose', () => disposed++)

  frame.beginCompile()
  frame.dispose(group)
  frame.endCompile()
  frame.beginCompile()
  frame.endCompile()
  assert.equal(disposed, 2)
})
