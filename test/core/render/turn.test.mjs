/**
 * How an entity is turned: a bare number is yaw, an array is pitch, yaw, roll.
 *
 * A bare number is the form every level writes, so the invariant that matters is
 * that it equals the same yaw written as an array — not the exact matrix a
 * particular expression composed. The order is YXZ because that is what keeps a
 * leaning body's own horizon level when it turns, and that is checked by where
 * its sideways axis points, not by reading the order back.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'

import { turnObject } from '../../../engine/render.js'

/** The module's own order of operations, so the values are compared exactly. */
const radiansOf = degrees => (degrees * Math.PI) / 180

/** An object turned to match a `rotation` declaration. */
const turned = rotation => {
  const object = new THREE.Object3D()
  turnObject(object, { type: 'post', rotation })
  return object
}

/** The matrix an object ends up with. Negative zero is normalised, so -0 equals 0. */
const matrixOf = object => {
  object.updateMatrix()
  return [...object.matrix.elements].map(element => element + 0)
}

test('a bare number is yaw, and equals the same yaw written as an array', () => {
  for (const yaw of [0, 1, -1, 45, -45, 90, 180, -180, 200, 235, 360, 0.5, -0.72, 153.907, -167.37]) {
    assert.deepEqual(matrixOf(turned(yaw)), matrixOf(turned([0, yaw, 0])), `yaw ${yaw}`)
  }
})

test('an array pitches, yaws and rolls, in degrees', () => {
  const object = turned([-12, 45, 3])
  assert.equal(object.rotation.x, radiansOf(-12), 'the first number is pitch')
  assert.equal(object.rotation.y, radiansOf(45), 'the second is yaw')
  assert.equal(object.rotation.z, radiansOf(3), 'the third is roll')
})

test('no rotation at all is no rotation, not a NaN', () => {
  for (const rotation of [undefined, null, 0]) {
    assert.deepEqual(matrixOf(turned(rotation)), matrixOf(new THREE.Object3D()), `rotation ${rotation}`)
  }
})

test('a running yaw beats the declared yaw and leaves the lean alone', () => {
  const bare = new THREE.Object3D()
  turnObject(bare, { type: 'kitten', rotation: 90, yaw: 1.25 })
  assert.equal(bare.rotation.y, 1.25)

  const array = new THREE.Object3D()
  turnObject(array, { type: 'kitten', rotation: [-12, 45, 3], yaw: 0.5 })
  assert.equal(array.rotation.y, 0.5)
  assert.equal(array.rotation.x, radiansOf(-12), 'the pitch is declared, not driven')
  assert.equal(array.rotation.z, radiansOf(3), 'and so is the roll')
})

test('the order is YXZ, so a body that leans then turns keeps its horizon level', () => {
  const object = turned([-30, 90, 0])
  assert.equal(object.rotation.order, 'YXZ')

  // In XYZ the same angles roll the body's own sideways axis off the floor.
  const xyz = new THREE.Object3D()
  xyz.rotation.set(object.rotation.x, object.rotation.y, object.rotation.z, 'XYZ')
  assert.notDeepEqual(matrixOf(object), matrixOf(xyz), 'these angles must tell the two orders apart')

  const sideways = new THREE.Vector3(1, 0, 0).applyEuler(object.rotation)
  assert.ok(Math.abs(sideways.y) < 1e-12, `the horizon rolled by ${sideways.y}`)
})

test('a rotation that is not a number is named and treated as zero', () => {
  const said = []
  const wasErroring = console.error
  console.error = message => said.push(String(message))
  try {
    assert.deepEqual(matrixOf(turned('sideways')), matrixOf(new THREE.Object3D()))
    assert.deepEqual(matrixOf(turned([null, 'over', null])), matrixOf(new THREE.Object3D()))
  } finally {
    console.error = wasErroring
  }
  assert.ok(
    said.some(line => line.includes('post.rotation:')),
    said.join('\n')
  )
  assert.ok(
    said.some(line => line.includes('post.rotation[1]:')),
    said.join('\n')
  )
})
