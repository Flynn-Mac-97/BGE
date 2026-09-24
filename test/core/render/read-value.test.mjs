/**
 * `read-value`: a declared colour, intensity or vector, and the nothing a value
 * that was left out answers instead of a guess.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readColour, readIntensity, readVector } from '../../../engine/render/read-value.js'
import { captureConsoleError } from './report-capture.mjs'

test('a colour that was left out is null and nothing is reported', () => {
  let missing = null
  let absent = null
  const said = captureConsoleError(() => {
    missing = readColour(null, 'level.tint')
    absent = readColour(undefined, 'level.tint')
  })
  assert.equal(missing, null)
  assert.equal(absent, null)
  assert.deepEqual(said, [])
})

test('an intensity that was left out is null and nothing is reported', () => {
  let missing = null
  let absent = null
  const said = captureConsoleError(() => {
    missing = readIntensity(null, 'level.ambient')
    absent = readIntensity(undefined, 'level.ambient')
  })
  assert.equal(missing, null)
  assert.equal(absent, null)
  assert.deepEqual(said, [])
})

test('a vector reads every declared axis and treats a missing one as zero', () => {
  assert.deepEqual(readVector({ x: 5, y: -2 }, 'sway'), { x: 5, y: -2, z: 0 })
})
