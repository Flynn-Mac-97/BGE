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
import {
  declaredNumber,
  describeEntity,
  entityDrawSize,
  materialLook,
  materialNameFor,
  mergeSignature,
  meshShape,
  planFrame,
  tilingOf
} from '../../../engine/frame-plan.js'
import { captureConsoleError } from './report-capture.mjs'

const wall = extra => ({ id: 'wall', type: 'wall', x: 1, y: 2, z: 3, mesh: { box: [1, 1, 1], ...extra } })

test('a mesh is described by a shape and a material it can share', () => {
  const described = describeEntity(wall({ texture: 'brick.png' }))
  assert.match(described.look, /[1-9]/, 'the look names the shape it is built from')
  assert.equal(typeof described.material, 'string', 'a mesh has one material key')
})

test('size stays out of the material key, so a big wall and a small step share one draw', () => {
  const big = describeEntity(wall({ texture: 'brick.png' }))
  const small = describeEntity({
    ...wall({ texture: 'brick.png' }),
    mesh: { box: [0.4, 0.4, 0.4], texture: 'brick.png' }
  })
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
    id: 'cat',
    type: 'cat',
    x: 0,
    y: 0,
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

test('a number that was left out is not reported, even with a name for it', () => {
  const said = captureConsoleError(() => {
    assert.equal(declaredNumber(undefined, 1, 'wall.mesh.box[0]'), 1)
    assert.equal(declaredNumber(null, 2, 'wall.mesh.box[1]'), 2)
    assert.equal(declaredNumber(Infinity, 3, null), 3)
  })
  assert.deepEqual(said, [], 'a value that was never given is answered, not complained about')
})

test('a body of parts is measured from the boxes it lists', () => {
  const shape = meshShape({ id: 'statue', type: 'statue', mesh: { parts: [{ box: [2, 4, 6] }] } })
  assert.deepEqual(shape, { kind: 'parts', w: 2, h: 4, d: 6 })
})

test('a box declaration that asks for segments is divided that finely', () => {
  const divided = meshShape({ type: 'wall', mesh: { box: [1, 1, 1], segments: 3 } })
  const plain = meshShape({ type: 'wall', mesh: { box: [1, 1, 1] } })
  assert.equal(divided.segments, 3)
  assert.equal(plain.segments, 1, 'a wall with nothing declared wants four vertices')
})

test('a model file name is part of its look, so swapping the model rebuilds it', () => {
  const first = describeEntity({ id: 'a', type: 'hero', mesh: { model: 'first.glb', box: [1, 1, 1] } })
  const second = describeEntity({ id: 'b', type: 'hero', mesh: { model: 'second.glb', box: [1, 1, 1] } })
  assert.notEqual(first.look, second.look)
})

test('a quad with only a width falls back to a one-metre height', () => {
  const shape = meshShape({ type: 'billboard', mesh: { quad: [2] } })
  assert.equal(shape.w, 2)
  assert.equal(shape.h, 1, 'a missing quad height is a metre')
})

test('a box with a missing side falls back to a metre for that side', () => {
  const shape = meshShape({ type: 'wall', mesh: { box: [4, null, 2] } })
  assert.equal(shape.w, 4)
  assert.equal(shape.h, 1, 'a missing box side is a metre')
  assert.equal(shape.d, 2)
})

test('a sprite with no size of its own takes the collider box', () => {
  const size = entityDrawSize({ id: 'p', type: 'player', sprite: { image: 'hero.png' }, collider: { box: [3, 4] } })
  assert.deepEqual(size, { w: 3, h: 4, d: 0 })
})

test('an absolute tiling divides by the box it repeats across', () => {
  const shape = { kind: 'box', w: 2, h: 4, d: 1 }
  const material = materialLook({ type: 'wall' }, { texture: 'brick.png', tiling: [4, 8] }, shape)
  assert.ok(material.startsWith('lambert|2,2'), `four repeats across 2 m is two per metre, got ${material}`)
})

test('a tiling array with a missing number falls back to one repeat on that axis', () => {
  assert.deepEqual(tilingOf([4, undefined], { kind: 'box', w: 2, h: 4 }), [2, 0.25])
})

test('a quad with no declared tiling shows its picture once', () => {
  const shape = { kind: 'quad', w: 2, h: 4 }
  assert.deepEqual(tilingOf(undefined, shape), [0.5, 0.25])
  assert.deepEqual(tilingOf(null, shape), [0.5, 0.25])
})

test('a null material falls back to the default instead of throwing', () => {
  assert.equal(materialNameFor({ material: null }), 'lambert')
})

test('a material named by an object takes that name', () => {
  assert.equal(materialNameFor({ material: { name: 'toon', steps: 5 } }), 'toon')
})

test('a material name that is not a string falls back to the default', () => {
  assert.equal(materialNameFor({ material: { name: 5 } }), 'lambert')
})

test('two declarations that differ only in an object parameter get different material keys', () => {
  const shape = { kind: 'box', w: 1, h: 1, d: 1 }
  const first = materialLook({ type: 'wall' }, { texture: 'brick.png', shine: { amount: 1 } }, shape)
  const second = materialLook({ type: 'wall' }, { texture: 'brick.png', shine: { amount: 2 } }, shape)
  assert.notEqual(first, second, 'an object parameter has to be part of what makes a surface')
})

test('the stillness signature tells two entities apart by their depth', () => {
  const described = { look: 'lambert|1,1' }
  const turn = { x: 0, y: 0, z: 0 }
  const first = mergeSignature({ x: 0, y: 0, z: 5, scale: 1 }, described, turn)
  const second = mergeSignature({ x: 0, y: 0, z: 9, scale: 1 }, described, turn)
  assert.notEqual(first, second)
})
