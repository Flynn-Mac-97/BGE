#!/usr/bin/env node
/**
 * Kimodo constraints as features. The model reads each value by its position
 * in the row, so a value one slot off is a different constraint and nothing
 * reports it. These pin the slots on a still template: the hips at a known
 * place, and every joint unturned or the whole body turned a quarter.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { motionCondition } from '../tools/lib/motion-conditions.mjs'
import { SKELETONS } from '../tools/lib/motion-clip.mjs'

const NAMES = SKELETONS['soma-30'].names
const WIDTH = 9 + 12 * NAMES.length
const HIPS = [1, 0.9, 2]

/** Stored motion of `frames` frames, the hips at HIPS and turned by `hipsTurn`, every other joint unturned. */
function stillTemplate(frames, hipsTurn) {
  const rotations = new Float32Array(frames * NAMES.length * 4)
  for (let index = 3; index < rotations.length; index += 4) rotations[index] = 1
  for (let frame = 0; frame < frames; frame++) rotations.set(hipsTurn, frame * NAMES.length * 4)
  return { rotations, root: new Float32Array(Array.from({ length: frames }, () => HIPS).flat()), frames, joints: NAMES.length }
}

const UNTURNED = [0, 0, 0, 1]
// A quarter turn to the left about +Y: the body faces +X.
const QUARTER_LEFT = [0, Math.SQRT1_2, 0, Math.SQRT1_2]

const conditionOf = (constraints, hipsTurn = UNTURNED) =>
  motionCondition({ skeleton: 'soma-30', frames: 4, framesPerSecond: 2, template: stillTemplate(4, hipsTurn), record: { template: 'still', constraints } })

const rowOf = (values, frame) => Array.from(values.slice(frame * WIDTH, (frame + 1) * WIDTH))
const positionOf = (row, name) => row.slice(5 + NAMES.indexOf(name) * 3, 8 + NAMES.indexOf(name) * 3)

test('a pose keeps the ground point, hips height, heading and every joint, relative to the ground point', () => {
  const condition = conditionOf([{ kind: 'pose', at: [0.5] }])
  const row = rowOf(condition.observed, 1)
  assert.deepEqual(row.slice(0, 5).map(value => Number(value.toFixed(2))), [1, 0.9, 2, 1, 0])
  assert.deepEqual(positionOf(row, 'Hips').map(value => Number(value.toFixed(4))), [0, 0.9, 0])
  assert.equal(rowOf(condition.mask, 1).reduce((sum, value) => sum + value, 0), 5 + 3 * NAMES.length)
  assert.equal(rowOf(condition.mask, 0).reduce((sum, value) => sum + value, 0), 0)
})

test('a joint key moves its whole chain there and keeps the turn of its base as two matrix columns', () => {
  const condition = conditionOf([{ kind: 'joint', joint: 'RightHand', keys: [{ at: 1, value: [0.2, 1.3, 0.4] }] }], QUARTER_LEFT)
  const row = rowOf(condition.observed, 2)
  assert.deepEqual(positionOf(row, 'RightHand').map(value => Number(value.toFixed(4))), [0.2, 1.3, 0.4])
  // The hand's rest offset to the finger tip, [-0.19, -0.003, 0], turned to face +X.
  const turnedTip = [0, -0.003, 0.19]
  positionOf(row, 'RightHandMiddleEnd').forEach((value, axis) => assert.ok(Math.abs(value - [0.2, 1.3, 0.4][axis] - turnedTip[axis]) < 0.01))
  assert.ok(Math.abs(Math.atan2(row[4], row[3]) - Math.PI / 2) < 0.01)
  const turnStart = 5 + NAMES.length * 3 + NAMES.indexOf('RightHand') * 6
  assert.deepEqual(row.slice(turnStart, turnStart + 6).map(value => Number(value.toFixed(4)) + 0), [0, 0, -1, 0, 1, 0])
  assert.equal(rowOf(condition.mask, 2).reduce((sum, value) => sum + value, 0), 5 + 2 * 3 + 6)
})

test('a key outside the generation is refused, naming its frame', () => {
  assert.throws(() => conditionOf([{ kind: 'pose', at: [2] }]), /frame 4, outside 0..3/)
})

test('a path keeps the ground point on its curve every frame, with no template', () => {
  const condition = motionCondition({
    skeleton: 'soma-30', frames: 4, framesPerSecond: 2, template: null,
    record: { constraints: [{ kind: 'path', heading: 0, keys: [{ at: 0, value: [0, 0] }, { at: 1.5, value: [0, 3] }] }] }
  })
  assert.deepEqual([0, 1, 2, 3].map(frame => rowOf(condition.observed, frame)[2]), [0, 1, 2, 3])
  assert.equal(rowOf(condition.mask, 3).reduce((sum, value) => sum + value, 0), 4)
  assert.equal(condition.firstHeading, 0)
})

test('a pose from another moment holds that moment\'s body at every frame named', () => {
  const template = stillTemplate(4, UNTURNED)
  template.root.set([5, 0.9, 7], 0)
  const condition = motionCondition({ skeleton: 'soma-30', frames: 4, framesPerSecond: 2, template, record: { constraints: [{ kind: 'pose', at: [1.5], from: 0 }] } })
  assert.deepEqual(rowOf(condition.observed, 3).slice(0, 3).map(value => Number(value.toFixed(3))), [5, 0.9, 7])
})
