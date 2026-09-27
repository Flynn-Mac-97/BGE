#!/usr/bin/env node
/**
 * Rig Animation's motion checks on a small made-up body: a still stance is
 * clean and reads as planted, a body gliding over the floor slides its feet,
 * and a take raised off its floor hovers.
 *
 *   node --test test/motion-review.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { widenSkeleton } from '../plugins/builtin/rig-animation/skeleton.js'
import { widenClip } from '../plugins/builtin/rig-animation.js'
import { readClip, restOf } from '../plugins/builtin/rig-animation/clip-reading.js'
import { floorOf, poseFacts } from '../plugins/builtin/rig-animation/pose-facts.js'
import { motionFaults } from '../plugins/builtin/rig-animation/motion-faults.js'

const IDENTITY = [0, 0, 0, 1]
const node = (parent, position) => ({ parent, position, rotation: IDENTITY, scale: 1 })
const side = (name, x) => ({
  [`${name}Arm`]: node('Spine2', [0.18 * x, 0.25, 0]),
  [`${name}ForeArm`]: node(`${name}Arm`, [0, -0.28, 0]),
  [`${name}Hand`]: node(`${name}ForeArm`, [0, -0.25, 0]),
  [`${name}UpLeg`]: node('Hips', [0.1 * x, -0.05, 0]),
  [`${name}Leg`]: node(`${name}UpLeg`, [0, -0.42, 0]),
  [`${name}Foot`]: node(`${name}Leg`, [0, -0.4, 0]),
  [`${name}ToeBase`]: node(`${name}Foot`, [0, -0.05, 0.12])
})
/** A 1.7 m body standing with its arms down, feet on the floor. */
const SKELETON = widenSkeleton(
  {
    nodes: {
      Hips: node(null, [0, 0.95, 0]),
      Spine2: node('Hips', [0, 0.3, 0]),
      Neck: node('Spine2', [0, 0.3, 0]),
      Head: node('Neck', [0, 0.15, 0]),
      ...side('Left', 1),
      ...side('Right', -1)
    }
  },
  'test'
)

/** A clip of `frames` still frames, its hips `lift` metres up, the body travelling `speed` m/s along +X. */
function standing({ frames = 30, lift = 0, speed = 0 } = {}) {
  return widenClip(
    {
      nodes: ['Hips'],
      rotations: Array.from({ length: frames }, () => IDENTITY),
      positions: { Hips: Array.from({ length: frames }, () => [0, 0.95 + lift, 0]) },
      root: Array.from({ length: frames }, (unused, frame) => [(speed * frame) / 30, 0.95, 0]),
      framesPerSecond: 30,
      loop: false
    },
    'standing'
  )
}

const faultsOf = clip => motionFaults(readClip(SKELETON, clip), restOf(SKELETON))

test('a still stance is clean and reads as planted, weight between the feet', () => {
  assert.deepEqual(faultsOf(standing()), [])
  const read = readClip(SKELETON, standing())
  const facts = poseFacts(read.frames[0], restOf(SKELETON), floorOf(read.frames, restOf(SKELETON)))
  assert.equal(facts.weight, 'between the feet')
  assert.equal(facts.feet.left, 'planted')
  assert.match(facts.words, /standing tall/)
})

test('a body gliding over the floor slides both planted feet', () => {
  const slides = faultsOf(standing({ speed: 0.4 })).filter(fault => fault.kind === 'slide')
  assert.deepEqual(slides.map(fault => fault.part).sort(), ['left foot', 'right foot'])
  assert.ok(slides.every(fault => fault.measured > fault.limit))
})

test('a take raised off its floor hovers', () => {
  const [hover] = faultsOf(standing({ lift: 0.06 })).filter(fault => fault.kind === 'hover')
  assert.ok(hover && Math.abs(hover.measured - 0.06) < 0.005, `hovers 6 cm (${hover?.measured})`)
})
