/**
 * The per-entity frame plan, and the rules its keys must keep.
 *
 * This module is the renderer's per-frame description, moved out so a headless
 * run can measure it. Its look and material keys are contracts, not formatting:
 * `look` decides when an object is rebuilt and when an entity counts as having
 * moved, and the material key decides which entities share one draw. A change
 * that quietly widens either one rebuilds every object every frame or splits a
 * merged batch into hundreds.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeEntity, materialLook, meshShape, mergeSignature, planFrame, turnRadians } from '../engine/frame-plan.js'

const wall = extra => ({ id: 'wall', type: 'wall', x: 1, y: 2, z: 3, mesh: { box: [1, 1, 1], ...extra } })

test('a mesh look names its shape and its material key', () => {
  const entity = wall({ texture: 'brick.png' })
  const described = describeEntity(entity)
  assert.match(described.look, /^mesh\|box\|1\|1\|1\|/)
  assert.match(described.material, /^lambert\|/)
  assert.match(described.look, new RegExp(described.material.replace(/[|\\]/g, '\\$&')))
})

test('size stays out of the material key, so a big wall and a small step share one material', () => {
  const big = wall({ texture: 'brick.png' })
  const small = { ...wall({ texture: 'brick.png' }), mesh: { box: [0.4, 0.4, 0.4], texture: 'brick.png' } }
  assert.equal(
    materialLook(big, big.mesh, meshShape(big)),
    materialLook(small, small.mesh, meshShape(small)))
  // But the look carries size, because a resized box has to rebuild its object.
  assert.notEqual(describeEntity(big).look, describeEntity(small).look)
})

test('a different tint is a different material', () => {
  const red = wall({ texture: 'brick.png', tint: '#ff0000' })
  const blue = wall({ texture: 'brick.png', tint: '#0000ff' })
  assert.notEqual(
    materialLook(red, red.mesh, meshShape(red)),
    materialLook(blue, blue.mesh, meshShape(blue)))
})

test('outlining a mesh does not change its look, so the keyline never reads as a move', () => {
  const plain = wall({ texture: 'brick.png' })
  const outlined = wall({ texture: 'brick.png', keyline: 3 })
  assert.equal(describeEntity(outlined).look, describeEntity(plain).look)
  assert.equal(describeEntity(outlined).keyline, 3)
})

test('a part-built body has one look for the whole part list', () => {
  const entity = {
    id: 'cat', type: 'cat', x: 0, y: 0,
    mesh: { tint: '#e8a55c', parts: [{ box: [0.4, 0.3, 0.6] }, { box: [0.3, 0.3, 0.3], at: [0, 0.2, -0.4] }] }
  }
  const described = describeEntity(entity)
  assert.equal(described.material, null)
  assert.match(described.look, /^parts\|/)
})

test('a sprite look is its picture and its sheet mode', () => {
  const single = describeEntity({ id: 'p', type: 'player', sprite: { image: 'hero.png' } })
  const sheet = describeEntity({ id: 'p', type: 'player', sprite: { sheet: 'run.png', frame: 2 } })
  assert.equal(single.look, 'hero.png|0|one')
  assert.equal(sheet.look, 'run.png|0|sheet')
})

test('a moved entity has a different stillness signature', () => {
  const entity = wall({ texture: 'brick.png' })
  const described = describeEntity(entity)
  const still = mergeSignature(entity, described, turnRadians(entity))
  const moved = mergeSignature({ ...entity, x: entity.x + 1 }, described, turnRadians(entity))
  assert.notEqual(still, moved)
  // Turning it is also a move, which is why the signature carries the angles.
  const turned = mergeSignature(entity, described, turnRadians({ ...entity, rotation: 45 }))
  assert.notEqual(still, turned)
})

test('planFrame describes every entity and counts what each kind is', () => {
  const world = {
    entities: [
      wall({ texture: 'brick.png' }),
      { ...wall({ texture: 'brick.png' }), id: 'wall2', type: 'wall' },
      { id: 'p', type: 'player', sprite: { image: 'hero.png' } }
    ]
  }
  assert.deepEqual(planFrame(world), { entities: 3, meshes: 2, sprites: 1 })
  assert.deepEqual(planFrame({}), { entities: 0, meshes: 0, sprites: 0 })
})
