/**
 * `entity-record`: the per-entity frame state kept beside the entity, and the
 * three answers it caches — the plan, the turn and the last written transform.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeEntityRecords } from '../../../engine/render/entity-record.js'

const makeRecords = () => makeEntityRecords({ shadowDirty: false })

test('the record at a position follows the entity the list now holds', () => {
  const records = makeRecords()
  const first = { id: 'a', type: 'wall' }
  const second = { id: 'b', type: 'wall' }
  records.recordAt(0, first)
  assert.equal(records.recordAt(0, second).entity, second)
})

test('a changed mesh is measured into a new plan', () => {
  const records = makeRecords()
  const entity = { type: 'wall', mesh: { box: [1, 1, 1] } }
  const record = records.recordAt(0, entity)
  const first = records.planFor(entity, record)
  entity.mesh = { box: [2, 2, 2] }
  assert.notEqual(records.planFor(entity, record).described.look, first.described.look)
})

test('a changed sprite is measured into a new plan', () => {
  const records = makeRecords()
  const entity = { type: 'wall', sprite: { image: 'a.png' } }
  const record = records.recordAt(0, entity)
  const first = records.planFor(entity, record)
  entity.sprite = { image: 'b.png' }
  assert.notEqual(records.planFor(entity, record).described.look, first.described.look)
})

test('a changed type is measured into a new plan', () => {
  const records = makeRecords()
  const entity = { type: 'wall', mesh: { box: [1, 1, 1] } }
  const record = records.recordAt(0, entity)
  const first = records.planFor(entity, record)
  entity.type = 'floor'
  assert.notEqual(records.planFor(entity, record).described.look, first.described.look)
})

test('a changed collider is measured into a new plan', () => {
  const records = makeRecords()
  const entity = { type: 'wall', mesh: {}, collider: { box: [1, 1, 1] } }
  const record = records.recordAt(0, entity)
  const first = records.planFor(entity, record)
  entity.collider = { box: [2, 2, 2] }
  assert.notEqual(records.planFor(entity, record).described.look, first.described.look)
})

test('a changed rotation is measured into a new turn', () => {
  const records = makeRecords()
  const entity = { type: 'wall', rotation: 0 }
  const record = records.recordAt(0, entity)
  records.turnFor(entity, record)
  entity.rotation = 90
  assert.ok(Math.abs(records.turnFor(entity, record).y - Math.PI / 2) < 1e-9)
})

test('a changed yaw is measured into a new turn', () => {
  const records = makeRecords()
  const entity = { type: 'wall', rotation: 0, yaw: 0 }
  const record = records.recordAt(0, entity)
  records.turnFor(entity, record)
  entity.yaw = 1.5
  assert.equal(records.turnFor(entity, record).y, 1.5)
})

test('a fresh record composes the object matrix and marks the shadow dirty', () => {
  const state = { shadowDirty: false }
  const records = makeEntityRecords(state)
  const object = new THREE.Object3D()
  const record = records.recordAt(0, { id: 'a', type: 'wall' })

  records.placeMatrix(object, record)
  assert.equal(state.shadowDirty, true)
  assert.equal(record.placedObject, object)
})

test('the same transform on a different object still composes the matrix', () => {
  const state = { shadowDirty: false }
  const records = makeEntityRecords(state)
  const record = records.recordAt(0, { id: 'a', type: 'wall' })
  records.placeMatrix(new THREE.Object3D(), record)

  const second = new THREE.Object3D()
  state.shadowDirty = false
  records.placeMatrix(second, record)
  assert.equal(state.shadowDirty, true)
  assert.equal(record.placedObject, second)
})

test('any transform change composes the object matrix again', () => {
  const state = { shadowDirty: false }
  const records = makeEntityRecords(state)
  const object = new THREE.Object3D()
  const record = records.recordAt(0, { id: 'a', type: 'wall' })
  records.placeMatrix(object, record)

  const changes = [
    () => (object.position.x += 1),
    () => (object.position.y += 1),
    () => (object.position.z += 1),
    () => (object.rotation.x += 0.1),
    () => (object.rotation.y += 0.1),
    () => (object.rotation.z += 0.1),
    () => (object.scale.x += 1),
    () => (object.scale.y += 1),
    () => (object.scale.z += 1)
  ]
  for (const change of changes) {
    change()
    state.shadowDirty = false
    records.placeMatrix(object, record)
    assert.equal(state.shadowDirty, true)
  }
})
