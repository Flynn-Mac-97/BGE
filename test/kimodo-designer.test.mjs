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
