#!/usr/bin/env node
/**
 * The three things about the Rapier bridge that break silently.
 *
 * A replay that diverges looks like a flaky test rather than a broken one. A
 * wrong contact-normal sign makes `grounded` always false, which reads as a
 * broken jump in a game and nothing at all in a unit test. A wrong rotation
 * conversion tips every mesh a few degrees and only a person notices.
 *
 * The bridge is driven with a hand-built world. It needs `entities` and `hook`
 * and nothing else, so no project and no renderer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { makeBridge, degreesOf, quaternionOf, GRAVITY_3D } from '../plugins/builtin/rapier/bridge.js'

await RAPIER.init()

const STEP = 1 / 60
const is3D = entity => Array.isArray(entity?.collider?.box) && entity.collider.box.length === 3
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)

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

const solid = (id, at, box = [8, 1, 8]) => ({
  id, x: at[0], y: at[1], z: at[2], collider: { box }, properties: { body: 'solid' }
})

const falling = (id, at) => ({
  id, x: at[0], y: at[1], z: at[2], velocityX: 0, velocityY: 0, velocityZ: 0,
  collider: { box: [0.8, 0.8, 0.8] }, properties: { body: 'dynamic' }
})

function bridgeFor() {
  const bridge = makeBridge({ RAPIER, tag: 'test', claims: is3D, flat: false, gravity: GRAVITY_3D })
  bridge.start()
  return bridge
}

/** `steps` fixed steps of a floor with boxes dropped on it, and the world's hash. */
function run(steps, boxes = 12) {
  const entities = [solid('floor', [0, -0.5, 0])]
  for (let i = 0; i < boxes; i++) entities.push(falling(`box-${i}`, [i * 0.5 - 3, 1 + i * 0.9, 0]))
  const world = makeWorld(entities)
  const bridge = bridgeFor()
  for (let i = 0; i < steps; i++) bridge.step(world, STEP, {})
  return { bridge, world, digest: hash(bridge.snapshot()) }
}

test('the same run gives the same world, byte for byte', () => {
  // Rapier's WebAssembly build is cross-platform deterministic, so this holds
  // on any machine and is the property a replay rests on.
  assert.equal(run(180).digest, run(180).digest)
})

test('a different run gives a different world', () => {
  // Otherwise the test above would pass on a snapshot that ignores the bodies.
  assert.notEqual(run(180).digest, run(181).digest)
})

test('a restored world carries on exactly as the original would have', () => {
  // The engine restores a world on hot reload, so a stateful solver would
  // diverge here and a replay would stop being provable.
  const { bridge, world } = run(90)
  const midway = bridge.snapshot()
  for (let i = 0; i < 90; i++) bridge.step(world, STEP, {})
  const carriedOn = hash(bridge.snapshot())

  const restored = RAPIER.World.restoreSnapshot(midway)
  for (let i = 0; i < 90; i++) { restored.timestep = STEP; restored.step() }
  assert.equal(hash(restored.takeSnapshot()), carriedOn)
})

test('a box resting on a floor is grounded', () => {
  // The contact normal points out of the pair's stored first collider, not out
  // of the body asked about. Get the sign wrong and grounded is never true.
  const box = falling('box', [0, 3, 0])
  const world = makeWorld([solid('floor', [0, -0.5, 0]), box])
  const bridge = bridgeFor()
  for (let i = 0; i < 120; i++) bridge.step(world, STEP, {})

  assert.equal(box.grounded, true, 'it landed and knows it')
  assert.ok(Math.abs(box.y - 0.4) < 0.01, `it rests on the floor, got y ${box.y}`)
})

test('grounded holds whichever order the pair was built in', () => {
  // The body listed before the floor is the stored first collider, which is
  // the other branch of the sign test.
  const box = falling('box', [0, 3, 0])
  const world = makeWorld([box, solid('floor', [0, -0.5, 0])])
  const bridge = bridgeFor()
  for (let i = 0; i < 120; i++) bridge.step(world, STEP, {})

  assert.equal(box.grounded, true, 'the order bodies are declared in does not decide this')
})

test('a body in mid-air is not grounded', () => {
  const box = falling('box', [0, 20, 0])
  const world = makeWorld([solid('floor', [0, -0.5, 0]), box])
  const bridge = bridgeFor()
  for (let i = 0; i < 10; i++) bridge.step(world, STEP, {})

  assert.equal(box.grounded, false)
  assert.ok(box.velocityY < 0, 'and it is falling')
})

test('a contact is told to both sides, once', () => {
  const box = falling('box', [0, 1.2, 0])
  const world = makeWorld([solid('floor', [0, -0.5, 0]), box])
  const bridge = bridgeFor()
  for (let i = 0; i < 120; i++) bridge.step(world, STEP, {})

  assert.equal(world.collided.filter(pair => pair === 'box|floor').length, 1, 'once, not every step')
  assert.equal(world.collided.filter(pair => pair === 'floor|box').length, 1, 'and the floor was told too')
})

test('rotation survives the trip out to Rapier and back', () => {
  // The renderer reads the engine's rotation as YXZ degrees. A conversion that
  // is merely close tips every simulated mesh.
  for (const degrees of [[0, 0, 0], [0, 90, 0], [37, -120, 15], [-89, 44, 178]]) {
    const back = degreesOf(quaternionOf(degrees))
    const again = quaternionOf(back)
    const first = quaternionOf(degrees)
    const dot = Math.abs(first.x * again.x + first.y * again.y + first.z * again.z + first.w * again.w)
    assert.ok(Math.abs(1 - dot) < 1e-9, `${degrees} came back as ${back}`)
  }
})

test('a solid keeps the rotation the level gave it', () => {
  // A ramp is a rotated box, so a solid that arrives axis-aligned is a level
  // whose slopes are walls.
  const ramp = solid('ramp', [0, 0, 0], [8, 0.5, 8])
  ramp.rotation = [0, 0, -20]
  const box = falling('box', [0, 3, 0])
  const world = makeWorld([ramp, box])
  const bridge = bridgeFor()
  for (let i = 0; i < 120; i++) bridge.step(world, STEP, {})

  assert.ok(box.x > 0.2, `it slid down the slope, got x ${box.x}`)
})
