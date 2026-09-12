#!/usr/bin/env node
/**
 * Both physics plugins bin entities on a grid before testing them. A bin that
 * drops a pair does not throw: the body falls through the floor, or walks
 * through another body, and only a player notices.
 *
 * A wrong cell size or a wrong key is harmless while the insert and the query
 * agree, so these do not test the keys. What they cover is the two branches a
 * mistake actually reaches: the query has to be as wide as the body's own
 * footprint, which the seam and walk cases prove in 2D, and the oversize set
 * has to be tested every time, which the ground-plane cases prove in both.
 *
 * The 3D seam cases pass on a query collapsed to a point, because a 4 m cell
 * is wider than any body here and insertion covers the whole footprint. They
 * are kept as behaviour guards; the proof that 3D still resolves the same
 * pairs is a run-for-run comparison against the previous solver, not a unit
 * test.
 *
 * The system is driven directly with a hand-built world. It needs `entities`
 * and `hook` and nothing else, so no project, no renderer and no loop.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import physics3d from '../plugins/builtin/physics-3d.js'
import physics2d from '../plugins/builtin/physics-2d.js'

const STEP = 1 / 60

/** A world with just enough on it for a physics system to run. */
function makeWorld(entities) {
  const collided = []
  return {
    entities,
    collided,
    hook(entity, name, other) {
      if (name === 'onCollide') collided.push(`${entity.id}|${other.id}`)
    }
  }
}

const solid3d = (id, at, box = [4, 1, 4]) => ({
  id, x: at[0], y: at[1], z: at[2], collider: { box }, properties: { body: 'solid' }
})

const body3d = (id, at, velocity = [0, 0, 0], box = [0.8, 0.8, 0.8]) => ({
  id, x: at[0], y: at[1], z: at[2],
  velocityX: velocity[0], velocityY: velocity[1], velocityZ: velocity[2],
  collider: { box }, properties: { body: 'dynamic', gravity: 0 }
})

const step3d = (world, steps = 1) => {
  for (let i = 0; i < steps; i++) physics3d.systems[0].run(world, STEP, {})
}

test('3D: a body walks a floor of slabs and never drops through a seam', () => {
  // The seams are the test. A query narrower than the body's own footprint
  // finds the slab it is mostly on and misses the one it is stepping onto.
  const floor = []
  for (let i = -2; i < 8; i++) floor.push(solid3d(`slab-${i}`, [i * 4, 0, 0]))
  const body = body3d('walker', [-6, 0.9, 0], [7, 0, 0])
  body.properties.gravity = -20.32
  const world = makeWorld([...floor, body])

  let lowest = body.y
  for (let i = 0; i < 240; i++) {
    step3d(world)
    body.velocityX = 7
    lowest = Math.min(lowest, body.y)
  }

  assert.ok(body.x > 20, `it travelled, got x ${body.x}`)
  assert.ok(lowest > 0.85, `it never sank into the floor, lowest y ${lowest}`)
  assert.equal(body.grounded, true, 'and it is still standing at the end')
})

test('3D: a body straddling the seam of two slabs stands on both', () => {
  // Exactly on a cell boundary, so the body is in two cells and each slab is
  // in one of them.
  const body = body3d('straddler', [4, 4, 0])
  body.properties.gravity = -20.32
  const world = makeWorld([solid3d('left', [2, 0, 0]), solid3d('right', [6, 0, 0]), body])
  step3d(world, 120)

  assert.equal(body.grounded, true, 'a body resting on a seam is grounded')
  assert.ok(Math.abs(body.y - 0.9) < 0.01, `landed on top, got y ${body.y}`)
})

test('3D: a body stands on one oversize ground plane', () => {
  // A plane covering more cells than it is worth binning is kept aside and
  // always tested. Nothing else holds this body up.
  const world = makeWorld([
    solid3d('ground', [0, 0, 0], [400, 1, 400]),
    (() => { const b = body3d('stander', [120, 4, -90]); b.properties.gravity = -20.32; return b })()
  ])
  step3d(world, 120)

  const body = world.entities[1]
  assert.equal(body.grounded, true, 'an oversize solid still holds a body up')
  assert.ok(Math.abs(body.y - 0.9) < 0.01, `landed on top, got y ${body.y}`)
})

test('3D: two bodies far apart do not touch', () => {
  const near = body3d('near', [0, 1, 0])
  const far = body3d('far', [40, 1, 0])
  const world = makeWorld([near, far])
  step3d(world)

  assert.equal(near.velocityX, 0)
  assert.ok(Math.abs(far.x - 40) < 1e-9, 'nothing moved it')
})

test('3D: two bodies that meet block each other', () => {
  const mover = body3d('mover', [0, 1, 0], [60, 0, 0])
  const blocker = body3d('blocker', [6, 1, 0])
  const world = makeWorld([mover, blocker])
  step3d(world, 10)

  assert.ok(mover.x < 5.3, `stopped against the blocker, got x ${mover.x}`)
  assert.ok(Math.abs(blocker.x - 6) < 1e-9, 'a body is blocked, never pushed')
})

test('3D: a contact is reported once, for a pair in the same cell', () => {
  // Triggers, because two dynamic bodies push each other apart before the
  // contact pass runs and the overlap is gone by then.
  const first = body3d('first', [0, 1, 0])
  const second = body3d('second', [0.4, 1, 0])
  first.properties.body = 'trigger'
  second.properties.body = 'trigger'
  const world = makeWorld([first, second])
  step3d(world)

  const started = world.collided.filter(pair => pair.startsWith('first|'))
  assert.deepEqual(started, ['first|second'], 'told once, naming the other side')
})

const solid2d = (id, at, box = [4, 1]) => ({
  id, x: at[0], y: at[1], collider: { box }, properties: { body: 'solid' }
})

const body2d = (id, at, box = [0.8, 0.8]) => ({
  id, x: at[0], y: at[1], velocityX: 0, velocityY: 0,
  collider: { box }, properties: { body: 'dynamic' }
})

const step2d = (world, steps = 1) => {
  for (let i = 0; i < steps; i++) physics2d.systems[0].run(world, STEP, {})
}

test('2D: a body walks a floor of slabs and never drops through a seam', () => {
  const floor = []
  for (let i = -2; i < 8; i++) floor.push(solid2d(`slab-${i}`, [i * 4, 0]))
  const body = body2d('walker', [-6, 0.9])
  const world = makeWorld([...floor, body])

  let lowest = body.y
  for (let i = 0; i < 240; i++) {
    step2d(world)
    body.velocityX = 7
    lowest = Math.min(lowest, body.y)
  }

  assert.ok(body.x > 20, `it travelled, got x ${body.x}`)
  assert.ok(lowest > 0.85, `it never sank into the floor, lowest y ${lowest}`)
  assert.equal(body.grounded, true, 'and it is still standing at the end')
})

test('2D: a body straddling the seam of two slabs stands on both', () => {
  const body = body2d('straddler', [4, 4])
  const world = makeWorld([solid2d('left', [2, 0]), solid2d('right', [6, 0]), body])
  step2d(world, 180)

  assert.equal(body.grounded, true, 'a body resting on a seam is grounded')
  assert.ok(Math.abs(body.y - 0.9) < 0.01, `landed on top, got y ${body.y}`)
})

test('2D: a body stands on one oversize ground plane', () => {
  const body = body2d('stander', [150, 4])
  const world = makeWorld([solid2d('ground', [0, 0], [400, 1]), body])
  step2d(world, 180)

  assert.equal(body.grounded, true, 'an oversize solid still holds a body up')
  assert.ok(Math.abs(body.y - 0.9) < 0.01, `landed on top, got y ${body.y}`)
})

test('2D: an overlapping pair is reported and a distant pair is not', () => {
  const first = body2d('first', [0, 5])
  const second = body2d('second', [0.3, 5])
  const away = body2d('away', [80, 5])
  const world = makeWorld([first, second, away])
  step2d(world)

  assert.ok(world.collided.includes('first|second'), 'the overlapping pair is told')
  assert.ok(world.collided.includes('second|first'), 'both sides are told')
  assert.ok(!world.collided.some(pair => pair.includes('away')), 'a distant body is not')
})
