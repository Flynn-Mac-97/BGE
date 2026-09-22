/**
 * Every reader of `entity.rotation`, against both forms it may take.
 *
 * `engine/render.js` accepts a bare number as yaw and `[x, y, z]` as pitch, yaw
 * and roll. A reader that treats the array as a number gets NaN, and NaN is
 * silent: `JSON.stringify` writes it as `null`, so a save deletes the lean and
 * nothing reports it. These are the readers outside the renderer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { yawOf, facingOffset } from '../plugins/builtin/see/frame-facts.js'
import { makeWorld } from '../engine/world.js'

const DEGREE = Math.PI / 180

// ---- see/frame-facts.js ----

test('a bare rotation is yaw in degrees, exactly as before', () => {
  assert.equal(yawOf({ rotation: 90 }), 90 * DEGREE)
  assert.equal(yawOf({ rotation: -45 }), -45 * DEGREE)
  assert.equal(yawOf({ rotation: 0 }), 0)
  assert.equal(yawOf({}), 0, 'no rotation is no turn')
})

test('an array rotation reads its middle element as yaw', () => {
  assert.equal(yawOf({ rotation: [10, 20, 30] }), 20 * DEGREE, 'pitch and roll are not yaw')
  assert.equal(yawOf({ rotation: [-40, 0, 0] }), 0, 'a pure pitch faces straight ahead')
})

test('a running yaw wins over a declared rotation, in either form', () => {
  assert.equal(yawOf({ yaw: 1.5, rotation: 90 }), 1.5)
  assert.equal(yawOf({ yaw: 1.5, rotation: [10, 20, 30] }), 1.5)
})

test('no reader returns NaN for an array', () => {
  // The whole point: NaN spreads into every bearing computed from a facing and
  // is never reported, so a see.describe would state a NaN heading as fact.
  for (const rotation of [[10, 20, 30], [0, 0, 0], [-40, 0, 0]]) {
    assert.equal(Number.isNaN(yawOf({ rotation })), false, `rotation ${JSON.stringify(rotation)}`)
  }
  const seen = facingOffset({ x: 0, z: 0, rotation: [10, 180, 30] }, { x: 0, z: 5 })
  assert.equal(Number.isNaN(seen.degreesOff), false, 'a bearing computed from an array is a number')
  assert.equal(seen.degreesOff, 0, 'yaw 180 faces +Z, and the other entity stands there')
  assert.equal(seen.facingIt, true)
})

// ---- engine/world.js toLevel ----

/**
 * A real world, saved the way the editor saves one.
 *
 * `roundTurn` is private, so this drives `toLevel` itself and reads the JSON it
 * would write. A test calling a copy of the helper would pass while `toLevel`
 * still called the wrong one.
 */
const saved = placements => {
  const bus = { on: () => {}, emit: () => {} }
  const world = makeWorld(bus)
  world.registerType('prop', {})
  for (const placement of placements) world.spawn('prop', placement)
  return JSON.parse(JSON.stringify(world.toLevel({}))).entities
}

test('a bare rotation is saved as a bare number, exactly as before', () => {
  const [entity] = saved([{ id: 'one', rotation: 45 }])
  assert.equal(entity.rotation, 45)
})

test('a bare rotation is still rounded to three places', () => {
  const [entity] = saved([{ id: 'one', rotation: 45.00049 }])
  assert.equal(entity.rotation, 45)
})

test('an array rotation survives a save', () => {
  // The regression this file exists for. Math.round of an array is NaN, and
  // JSON.stringify writes NaN as null, so the lean was deleted with no error.
  const [entity] = saved([{ id: 'one', rotation: [10, 20, 30] }])
  assert.notEqual(entity.rotation, null, 'a declared pitch and roll is not dropped on save')
  assert.deepEqual(entity.rotation, [10, 20, 30])
})

test('every element of an array rotation is rounded', () => {
  const [entity] = saved([{ id: 'one', rotation: [10.00049, 20, 29.9996] }])
  assert.deepEqual(entity.rotation, [10, 20, 30])
})
