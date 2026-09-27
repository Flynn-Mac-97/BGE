#!/usr/bin/env node
/**
 * Image Models' pose record. A point turned the wrong way, or left off the
 * floor, gives Kimodo a key pose that is mirrored, upside down or floating,
 * and nothing says so until the take looks wrong.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { poseRecordOf } from '../plugins/builtin/image-models/pose-record.js'

// A person facing the camera 3 m away, in camera space: +Y down, +Z away.
const NAMES = ['left_hip', 'right_hip', 'left_wrist', 'nose', 'left_ankle', 'right_ankle']
const FACING_CAMERA = [
  [0.1, 0, 3],
  [-0.1, 0, 3],
  [0.3, -0.2, 2.9],
  [0, -0.7, 2.9],
  [0.1, 0.9, 3],
  [-0.1, 0.92, 3]
]

test('a person facing the camera faces +Z, stands on the floor, and keeps their left at +X', () => {
  const [person] = poseRecordOf({ model: 'test', image: 'a.jpg', names: NAMES, people: [{ points: FACING_CAMERA }] }).people
  assert.deepEqual(person.points.right_ankle, [-0.1, 0, 0], 'the lowest foot is on the floor, between the hips over the origin')
  assert.ok(person.points.nose[1] > 1.5, 'the head is up')
  assert.ok(person.points.nose[2] > 0, 'the face is toward +Z')
  assert.ok(person.points.left_wrist[0] > 0, 'the left hand is at +X')
})

test('the record names its model and image, and every person', () => {
  const record = poseRecordOf({ model: 'test', image: 'a.jpg', names: NAMES, people: [{ points: FACING_CAMERA }, { points: FACING_CAMERA }] })
  assert.equal(record.kind, 'pose')
  assert.equal(record.people.length, 2)
})
