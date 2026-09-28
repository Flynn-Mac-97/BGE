#!/usr/bin/env node
/**
 * The Kimodo designer's record: keys a person sets, the preview's reach
 * constraints between them, and the constraint file generation reads. A key
 * that lands in the wrong limb, time or kind makes a take that ignores the
 * design, and nothing says so.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chainOf,
  kimodoRecord,
  newDesign,
  previewConstraints,
  targetsAt,
  withKey,
  withoutKey
} from '../plugins/builtin/kimodo/designer.js'

const SKELETON = {
  nodes: Object.fromEntries(
    ['Hips', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'].map(name => [
      `mixamorig:${name}`,
      {}
    ])
  )
}

const design = newDesign({ name: 'chop', model: 'models/fighter.glb', base: 'motion/fighter/idle.json' })

test('a key lands on its frame and replaces a key already there', () => {
  const keyed = withKey(withKey(design, 'RightHand', 0.61, [0, 1, 0.2]), 'RightHand', 0.6, [0, 1.5, 0.3])
  assert.deepEqual(
    keyed.keys.RightHand.map(key => [key.at, key.value]),
    [[0.6, [0, 1.5, 0.3]]]
  )
  assert.deepEqual(withoutKey(keyed, 'RightHand', 0.6).keys, {})
})

test('between keys a handle follows its curve, and the preview reaches the limb there', () => {
  const keyed = withKey(withKey(design, 'RightHand', 0, [0, 1, 0]), 'RightHand', 1, [0, 2, 0])
  assert.equal(targetsAt(keyed, 0.5).RightHand[1], 1.5)
  const [reach] = previewConstraints(keyed, SKELETON, 0.5)
  assert.deepEqual(reach.nodes, ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'])
  assert.equal(reach.target.model[1], 1.5)
  const [dragged] = previewConstraints(keyed, SKELETON, 0.5, { handle: 'RightHand', point: [1, 1, 1] })
  assert.deepEqual(dragged.target.model, [1, 1, 1], 'a handle held by the pointer is where the pointer is')
  assert.equal(chainOf(SKELETON, 'RightFoot'), null, 'a limb the model lacks has no chain')
  // The preview runs every frame; a throw here stops the view for as long as the handle is held.
  assert.deepEqual(previewConstraints(design, SKELETON, 0.5, { handle: 'Chest', point: [0, 1, 0] }), [], 'a held body handle is not a limb to reach with')
})

test('generation reads every key as a joint constraint and starts in the base pose', () => {
  const keyed = withKey(design, 'LeftHand', 0.4, [0.2, 1.1, 0.3])
  assert.deepEqual(kimodoRecord(keyed, 'idle'), {
    template: 'idle',
    constraints: [
      { kind: 'pose', at: [0], from: 0 },
      { kind: 'joint', joint: 'LeftHand', keys: [{ at: 0.4, value: [0.2, 1.1, 0.3] }] }
    ]
  })
})

const LEGGED = {
  nodes: Object.fromEntries(
    ['Hips', 'RightArm', 'RightForeArm', 'RightHand', 'RightUpLeg', 'RightLeg', 'RightFoot'].map(name => [name, {}])
  )
}

test('an unkeyed foot stays planted where it stood, and an elbow target bends its arm without moving the hand', () => {
  const free = { RightFoot: [0.1, 0.05, 0], RightHand: [0.3, 1.2, 0.2] }
  const [foot] = previewConstraints(design, LEGGED, 0, null, free)
  assert.deepEqual(foot.target.model, free.RightFoot, 'the foot reaches for where it stood')
  const posed = previewConstraints(withKey(design, 'RightElbow', 0, [0.5, 1, -0.4]), LEGGED, 0, null, free)
  const arm = posed.find(reach => reach.nodes[2] === 'RightHand')
  assert.deepEqual(arm.target.model, free.RightHand, 'the hand stays where the body carries it')
  assert.deepEqual(arm.pole.model, [0.5, 1, -0.4], 'the elbow bends toward its target')
})

test('Kimodo is sent each solved elbow and knee as a point, and no target as a joint', () => {
  const keyed = { ...withKey(design, 'RightElbow', 0.5, [0.5, 1, -0.4]), solved: { RightElbow: [{ at: 0.5, value: [0.3, 1.1, -0.1] }] } }
  const kinds = kimodoRecord(keyed, 'idle').constraints.map(constraint => [constraint.kind, constraint.joint])
  assert.deepEqual(kinds, [['pose', undefined], ['point', 'RightElbow']])
})

test('a design that faces forward asks Kimodo for heading 0 at its first and last frame', () => {
  const forward = kimodoRecord({ ...design, seconds: 3, fromBase: false, facesForward: true }, 'idle')
  assert.deepEqual(forward.constraints, [{ kind: 'heading', keys: [{ at: 0, value: 0 }, { at: 89 / 30, value: 0 }] }])
})
