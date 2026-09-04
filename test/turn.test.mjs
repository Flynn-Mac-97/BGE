#!/usr/bin/env node
/**
 * How an entity is turned: a bare number is yaw, an array is pitch, yaw, roll.
 *
 * The bare number is the regression that matters — every level in the repo
 * writes one — so it is checked against the expression render.js used before the
 * array existed, down to the composed matrix.
 *
 * Not wired into `npm run test:offline`: that script names its files in
 * package.json, which this lane does not claim.
 * Run directly: node --test test/turn.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import { turnRadians, turnObject } from '../engine/render.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** What render.js read before an array was allowed. The oracle, kept verbatim. */
const beforeTheArray = entity =>
  Number.isFinite(entity.yaw) ? entity.yaw : (entity.rotation || 0) * Math.PI / 180

/** A spread of the bare values the repo's levels hold, plus the edges. */
const BARE = [
  undefined, 0, 1, -1, 20, 45, -45, 55, 70, 90, 180, -180, 200, 225, 235, 250, 360,
  0.5, -0.72, 153.907, -167.37, -1e-7, 1e7
]

/**
 * The matrix an object ends up with, so two ways of turning can be compared.
 *
 * Negative zero is normalised — adding zero turns -0 into 0 and leaves every
 * other value alone. Two euler orders reach the same rotation through different
 * sign combinations, and a strict compare would call -0 and 0 a difference.
 */
function matrixOf(object) {
  object.updateMatrix()
  return [...object.matrix.elements].map(element => element + 0)
}

test('a bare number is still yaw, to the last bit', () => {
  for (const rotation of BARE) {
    const entity = { type: 'wall', rotation }
    const turn = turnRadians(entity)
    assert.equal(turn.y, beforeTheArray(entity), `rotation ${rotation} yaws differently now`)
    assert.equal(turn.x, 0, `rotation ${rotation} invented a pitch`)
    assert.equal(turn.z, 0, `rotation ${rotation} invented a roll`)
  }
})

test('a bare number composes the same matrix it composed before', () => {
  for (const rotation of BARE) {
    const entity = { type: 'wall', rotation }

    const before = new THREE.Object3D()
    before.rotation.set(0, beforeTheArray(entity), 0)

    const now = new THREE.Object3D()
    turnObject(now, entity)

    assert.deepEqual(matrixOf(now), matrixOf(before), `rotation ${rotation} draws differently now`)
  }
})

test('a running yaw still beats a declared bare number', () => {
  const entity = { type: 'kitten', rotation: 90, yaw: 1.25 }
  assert.equal(turnRadians(entity).y, 1.25)
  assert.equal(turnRadians(entity).y, beforeTheArray(entity))
})

test('an array pitches, yaws and rolls, in degrees', () => {
  const turn = turnRadians({ type: 'post', rotation: [-12, 45, 3] })
  assert.equal(turn.x, -12 * Math.PI / 180)
  assert.equal(turn.y, 45 * Math.PI / 180)
  assert.equal(turn.z, 3 * Math.PI / 180)
})

test('an array of only a yaw matches the bare number that means the same thing', () => {
  const array = new THREE.Object3D()
  turnObject(array, { type: 'post', rotation: [0, 45, 0] })
  const bare = new THREE.Object3D()
  turnObject(bare, { type: 'post', rotation: 45 })
  assert.deepEqual(matrixOf(array), matrixOf(bare))
})

test('a running yaw replaces the array\'s yaw and leaves its lean alone', () => {
  const turn = turnRadians({ type: 'kitten', rotation: [-12, 45, 3], yaw: 0.5 })
  assert.equal(turn.y, 0.5)
  assert.equal(turn.x, -12 * Math.PI / 180, 'the pitch is declared, not driven')
  assert.equal(turn.z, 3 * Math.PI / 180, 'and so is the roll')
})

test('the order is YXZ, and the order is what the matrix is built from', () => {
  const entity = { type: 'post', rotation: [-12, 45, 3] }
  const object = new THREE.Object3D()
  turnObject(object, entity)
  assert.equal(object.rotation.order, 'YXZ')

  const turn = turnRadians(entity)
  const yxz = new THREE.Object3D()
  yxz.rotation.set(turn.x, turn.y, turn.z, 'YXZ')
  assert.deepEqual(matrixOf(object), matrixOf(yxz), 'not built in the order it reports')

  // The check above only means something if the two orders differ here at all.
  const xyz = new THREE.Object3D()
  xyz.rotation.set(turn.x, turn.y, turn.z, 'XYZ')
  assert.notDeepEqual(matrixOf(object), matrixOf(xyz), 'these angles cannot tell the orders apart')
})

test('yaw then pitch keeps the horizon level, which is what YXZ is for', () => {
  // Pitch a body 30 degrees nose-down and turn it 90 degrees. In YXZ its own
  // left-right axis stays flat on the ground; in XYZ that axis tilts.
  const object = new THREE.Object3D()
  turnObject(object, { type: 'plank', rotation: [-30, 90, 0] })
  object.updateMatrix()
  const sideways = new THREE.Vector3(1, 0, 0).applyEuler(object.rotation)
  assert.ok(Math.abs(sideways.y) < 1e-12, `the horizon rolled by ${sideways.y}`)
})

test('no rotation at all is no rotation, not a NaN', () => {
  const turn = turnRadians({ type: 'crate' })
  assert.deepEqual(turn, { x: 0, y: 0, z: 0 })
  const object = new THREE.Object3D()
  turnObject(object, { type: 'crate', rotation: null })
  assert.deepEqual(matrixOf(object), matrixOf(new THREE.Object3D()))
})

/**
 * Every rotation shape a level file may hold.
 *
 * Generated rather than swept out of a game's levels: the engine repository
 * holds no game, and a sweep proves only what the levels it found happened to
 * contain. These are the shapes the reader has to answer for.
 */
function placements() {
  const angles = [0, 1, -1, 90, 180, -270, 0.5, 359.9]
  const found = [
    { type: 'crate' },
    { type: 'crate', rotation: null },
    { type: 'crate', rotation: 0 }
  ]
  for (const angle of angles) {
    found.push({ type: 'crate', rotation: angle })
    found.push({ type: 'crate', rotation: [angle, 0, 0] })
    found.push({ type: 'crate', rotation: [0, angle, 0] })
    found.push({ type: 'crate', rotation: [0, 0, angle] })
    found.push({ type: 'crate', rotation: [angle, angle, angle] })
  }
  return found
}

test('every rotation a placement may declare draws exactly where it drew before', () => {
  let turned = 0
  for (const placement of placements()) {
    const entity = { type: placement.type, rotation: placement.rotation }
    const before = new THREE.Object3D()
    before.rotation.set(0, beforeTheArray(entity), 0)
    const now = new THREE.Object3D()
    turnObject(now, entity)
    // A three-number rotation turns on all three axes, which the single angle
    // it replaced could not say. Those are compared against the array reading,
    // not against the old one.
    if (Array.isArray(placement.rotation)) continue
    assert.deepEqual(matrixOf(now), matrixOf(before),
      `${placement.type} rotation ${JSON.stringify(placement.rotation)} turns differently now`)
    if (placement.rotation) turned++
  }
  assert.ok(turned > 0, 'no generated placement declares a rotation, so this proves nothing')
})

test('a rotation that is not a number is named and treated as zero', () => {
  const said = []
  const wasErroring = console.error
  console.error = message => said.push(String(message))
  try {
    assert.equal(turnRadians({ type: 'barrel', rotation: 'sideways' }).y, 0)
    assert.equal(turnRadians({ type: 'barrel', rotation: [null, 'over', null] }).y, 0)
  } finally {
    console.error = wasErroring
  }
  assert.ok(said.some(line => line.includes('barrel.rotation:')), said.join('\n'))
  assert.ok(said.some(line => line.includes('barrel.rotation[1]:')), said.join('\n'))
})
