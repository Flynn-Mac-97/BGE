/**
 * Curves: a value through keys, eased between them. Game code reads one with
 * `context.curve(keys).valueAt(seconds)`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { curveNames, makeCurve } from '../../../engine/curves.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)

test('a curve holds its first value before the first key and its last after the last', () => {
  const curve = makeCurve([
    { at: 1, value: 2 },
    { at: 3, value: 6 }
  ])
  assert.equal(curve.valueAt(0), 2)
  assert.equal(curve.valueAt(5), 6)
  assert.equal(curve.duration, 3)
})

test('each ease moves the value its own way between two keys', () => {
  const quarterOf = ease =>
    makeCurve([
      { at: 0, value: 0, ease },
      { at: 1, value: 1 }
    ]).valueAt(0.25)
  near(quarterOf(undefined), 0.25)
  near(quarterOf('smooth'), 0.15625)
  near(quarterOf('in'), 0.0625)
  near(quarterOf('out'), 0.4375)
  near(quarterOf('hold'), 0)
})

test('a point curve eases every axis together', () => {
  const curve = makeCurve([
    { at: 0, value: [0, 0, 0] },
    { at: 2, value: [2, -4, 6] }
  ])
  assert.deepEqual(curve.valueAt(1), [1, -2, 3])
})

test('a key list that is not a curve is refused by the key at fault', () => {
  assert.throws(() => makeCurve([]), /at least one key/)
  assert.throws(
    () =>
      makeCurve([
        { at: 1, value: 0 },
        { at: 1, value: 1 }
      ]),
    /key 1 is at 1, not after 1/
  )
  assert.throws(
    () =>
      makeCurve([
        { at: 0, value: 0 },
        { at: 1, value: [1, 2] }
      ]),
    /key 1 value is not the same shape/
  )
  assert.throws(() => makeCurve([{ at: 0, value: 0, ease: 'bounce' }]), /key 0 ease "bounce"/)
})

test('every ease but hold leaves 0 at the start and reaches 1 at the end, expo within its standard 0.001', () => {
  for (const name of curveNames().eases.filter(ease => ease !== 'hold')) {
    const curve = makeCurve([
      { at: 0, value: 0, ease: name },
      { at: 1, value: 1 }
    ])
    near(curve.valueAt(0), 0)
    assert.ok(Math.abs(curve.valueAt(1 - 1e-9) - 1) < 1e-3, `${name} ends at ${curve.valueAt(1 - 1e-9)}`)
  }
})

test('an in-out ease is half way at half time, and back goes past its end', () => {
  for (const family of ['sine', 'quad', 'cubic', 'expo', 'circ', 'back', 'bounce']) {
    near(
      makeCurve([
        { at: 0, value: 0, ease: `${family}-in-out` },
        { at: 1, value: 1 }
      ]).valueAt(0.5),
      0.5
    )
  }
  const back = makeCurve([
    { at: 0, value: 0, ease: 'back-out' },
    { at: 1, value: 1 }
  ])
  assert.ok(back.valueAt(0.6) > 1, 'back-out overshoots before it settles')
})

test('every preset makes a curve, stretched over its duration', () => {
  for (const name of Object.keys(curveNames().presets)) {
    const curve = makeCurve(name, { duration: 0.5 })
    assert.equal(curve.duration, 0.5, name)
    for (let step = 0; step <= 10; step++) assert.ok(Number.isFinite(curve.valueAt(step / 20)), name)
  }
})

test('a preset maps onto a colour, and a looping preset starts again', () => {
  const flash = makeCurve('flash', { duration: 1, from: [0, 0, 0], to: [1, 0.5, 0] })
  assert.deepEqual(flash.valueAt(0.06), [1, 0.5, 0])
  const bob = makeCurve('bob', { duration: 2 })
  assert.equal(bob.loop, true)
  near(bob.valueAt(1), 1)
  near(bob.valueAt(3), 1)
  assert.throws(() => makeCurve('wobble'), /no preset "wobble"/)
  assert.throws(() => makeCurve('pop', { from: [0, 0], to: 1 }), /same shape/)
})
