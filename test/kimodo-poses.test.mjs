#!/usr/bin/env node
/**
 * Kimodo poser: named key poses become hand and foot keys on the right side
 * of the body, never past the arm's reach, and a mirrored pose swaps sides.
 *
 *   node --test test/kimodo-poses.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { widenSkeleton } from '../plugins/builtin/rig-animation/skeleton.js'
import { POSES, keysOf, poseWords } from '../plugins/builtin/kimodo/poses.js'

const IDENTITY = [0, 0, 0, 1]
const node = (parent, position) => ({ parent, position, rotation: IDENTITY, scale: 1 })
const side = (name, x) => ({
  [`${name}Arm`]: node('Spine2', [0.18 * x, 0.14, 0]),
  [`${name}ForeArm`]: node(`${name}Arm`, [0.27 * x, 0, 0]),
  [`${name}Hand`]: node(`${name}ForeArm`, [0.25 * x, 0, 0]),
  [`${name}UpLeg`]: node('Hips', [0.1 * x, -0.02, 0]),
  [`${name}Leg`]: node(`${name}UpLeg`, [0, -0.43, 0]),
  [`${name}Foot`]: node(`${name}Leg`, [0, -0.42, 0]),
  [`${name}ToeBase`]: node(`${name}Foot`, [0, -0.05, 0.13])
})
/** A 1.7 m body in a T-pose, facing +Z, its left at +X. */
const SKELETON = widenSkeleton(
  {
    nodes: {
      Hips: node(null, [0, 0.95, 0]),
      Spine2: node('Hips', [0, 0.37, 0]),
      Neck: node('Spine2', [0, 0.16, 0]),
      Head: node('Neck', [0, 0.22, 0]),
      ...side('Left', 1),
      ...side('Right', -1)
    }
  },
  'test'
)
const shoulder = (x, drop) => [0.18 * x, 1.46 - drop, 0]

test('every pose puts each hand on its own side, within reach of its shoulder as the hips drop it', () => {
  for (const name of Object.keys(POSES)) {
    const { keys, body } = keysOf([{ at: 0, pose: name }], SKELETON)
    const drop = 0.95 - (body[0]?.height ?? 0.95)
    for (const [handle, x] of [
      ['RightHand', -1],
      ['LeftHand', 1]
    ]) {
      const [point] = keys[handle] ?? []
      if (!point) continue
      const reach = Math.hypot(...point.value.map((value, axis) => value - shoulder(x, drop)[axis]))
      assert.ok(reach <= 0.52 * 0.97 + 0.002, `${name} ${handle} is ${reach.toFixed(3)} m from the shoulder`)
    }
  }
})

test('a guard holds the weapon hand ahead and a wind-up draws it back overhead', () => {
  const keys = keysOf(
    [
      { at: 0, pose: 'guard' },
      { at: 0.5, pose: 'wind-up' }
    ],
    SKELETON
  ).keys.RightHand
  assert.ok(keys[0].value[2] > 0.2 && keys[0].value[0] < 0, 'guard: ahead of the chest, on the right')
  assert.ok(keys[1].value[1] > 1.7 && keys[1].value[2] < 0, 'wind-up: over the head, behind the chest')
})

test('a key overrides one limb of its pose, and mirror swaps the sides', () => {
  const pushed = keysOf([{ at: 0, pose: 'guard', right: { forward: 0.1 } }], SKELETON).keys.RightHand[0].value
  const plain = keysOf([{ at: 0, pose: 'guard' }], SKELETON).keys.RightHand[0].value
  assert.ok(pushed[2] < plain[2], 'the override pulls the hand back')
  const mirrored = keysOf([{ at: 0, pose: 'thrust', mirror: true }], SKELETON).keys
  assert.ok(mirrored.LeftHand[0].value[2] > 0.4, 'a mirrored thrust drives the left hand')
  assert.match(poseWords({ at: 0.5, pose: 'wind-up' }), /right hand above head, 15 cm behind/)
})

test('a body part becomes one body key: the hips drop, the torso leans, a mirror turns the twist', () => {
  const [strike] = keysOf([{ at: 0.7, pose: 'strike-down' }], SKELETON).body
  assert.ok(strike.height < 0.95 - 0.1, 'the hips drop for a strike')
  assert.ok(strike.torso[1] > 0.4, 'the torso leans forward')
  assert.ok(strike.head[1] > strike.torso[1], 'the head nods further than the torso leans')
  const [windUp] = keysOf([{ at: 0, pose: 'wind-up' }], SKELETON).body
  const [mirrored] = keysOf([{ at: 0, pose: 'wind-up', mirror: true }], SKELETON).body
  assert.equal(mirrored.torso[0], -windUp.torso[0])
  assert.deepEqual(keysOf([{ at: 0, pose: 'block' }], SKELETON).body, [])
  assert.match(
    poseWords({ at: 0.7, pose: 'strike-down' }),
    /hips 15 cm low; torso 30° forward, 15° twisted left; head 15° down/
  )
})
