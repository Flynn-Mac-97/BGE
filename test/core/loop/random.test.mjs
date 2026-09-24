/**
 * The deterministic stream: its seed, its draws, and the count that rejoins it.
 *
 * `engine/loop-random.js` exists so a run can be replayed. Each test here pins
 * one arithmetic decision that a replay depends on, through the stream's own
 * exports rather than its internals.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeRandom } from '../../../engine/loop-random.js'

test('a seed gives the same first number every time', () => {
  // Recorded from the committed generator. Any change to how it advances or
  // mixes its state moves this number, which is what a replay would notice.
  assert.equal(makeRandom(1)(), 0.6270739405881613)
})

test('resuming after n draws rejoins the stream it left', () => {
  const drawn = makeRandom(7)
  for (let index = 0; index < 5; index++) drawn()
  const resumed = makeRandom(7)
  resumed.resume(7, 5)
  assert.equal(resumed(), drawn(), 'the next number is the one the first stream would give')
  assert.equal(resumed.draws, 6)
})

test('range returns low plus the draw scaled by the span', () => {
  const stream = makeRandom(4)
  const reference = makeRandom(4)
  assert.equal(stream.range(2, 5), 2 + reference() * 3)
})

test('int is a whole number that includes both ends', () => {
  const stream = makeRandom(4)
  const reference = makeRandom(4)
  assert.equal(stream.int(2, 5), Math.floor(2 + reference() * 4))
})

test('a draw exactly at the probability is not a hit', () => {
  const probability = makeRandom(1)()
  const stream = makeRandom(1)
  assert.equal(stream.chance(probability), false)
})
