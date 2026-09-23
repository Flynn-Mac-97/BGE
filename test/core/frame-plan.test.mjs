/**
 * The per-entity draw plan: the look key that decides when an object is
 * rebuilt, and the material key that decides which entities share one draw.
 *
 * Both keys are contracts, not formatting. A key that quietly widens rebuilds
 * every object every frame; a key that quietly narrows splits one draw into
 * hundreds. So the rules are stated as relations — a resized box keeps its
 * material and changes its look, a tint changes the material, an outline does
 * not change the look — rather than as the exact string the keys happen to hold.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeEntity, planFrame } from '../../engine/frame-plan.js'

const wall = extra => ({ id: 'wall', type: 'wall', x: 1, y: 2, z: 3, mesh: { box: [1, 1, 1], ...extra } })

test('a mesh is described by a shape and a material it can share', () => {
  const described = describeEntity(wall({ texture: 'brick.png' }))
  assert.match(described.look, /[1-9]/, 'the look names the shape it is built from')
  assert.equal(typeof described.material, 'string', 'a mesh has one material key')
})

test('size stays out of the material key, so a big wall and a small step share one draw', () => {
  const big = describeEntity(wall({ texture: 'brick.png' }))
  const small = describeEntity({ ...wall({ texture: 'brick.png' }), mesh: { box: [0.4, 0.4, 0.4], texture: 'brick.png' } })
  assert.equal(small.material, big.material, 'different sizes of one surface must share a material')
  assert.notEqual(small.look, big.look, 'but a resized box has to rebuild its object')
})

test('a different tint is a different material', () => {
  const red = describeEntity(wall({ texture: 'brick.png', tint: '#ff0000' }))
  const blue = describeEntity(wall({ texture: 'brick.png', tint: '#0000ff' }))
  assert.notEqual(red.material, blue.material)
})

test('a declared mark does not change the look, so it never reads as a move', () => {
  const plain = describeEntity(wall({ texture: 'brick.png' }))
  const marked = describeEntity(wall({ texture: 'brick.png', keyline: 3, shadow: 1.2, ring: 2 }))
  assert.equal(marked.look, plain.look)
})

test('a part-built body has one look for the whole part list and no single material', () => {
  const described = describeEntity({
    id: 'cat', type: 'cat', x: 0, y: 0,
    mesh: { tint: '#e8a55c', parts: [{ box: [0.4, 0.3, 0.6] }, { box: [0.3, 0.3, 0.3], at: [0, 0.2, -0.4] }] }
  })
  assert.equal(described.material, null, 'parts are drawn from the mesh, not one material')
  assert.notEqual(described.look, describeEntity(wall({ texture: 'brick.png' })).look)
})

test('a sprite is described by its picture and whether it is a sheet', () => {
  const single = describeEntity({ id: 'p', type: 'player', sprite: { image: 'hero.png' } })
  const sheet = describeEntity({ id: 'p', type: 'player', sprite: { sheet: 'run.png', frame: 2 } })
  assert.match(single.look, /hero\.png/)
  assert.match(sheet.look, /run\.png/)
  assert.notEqual(single.look, sheet.look, 'a still and a sheet are not the same object')
})

test('planFrame counts every entity by the kind it draws as', () => {
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
