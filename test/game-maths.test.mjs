#!/usr/bin/env node
/**
 * Game Maths: the rotation read back from a turn is the one the turn was made
 * from, since games hand these straight to the renderer; and a game plugin
 * gets the maths through the `game.maths` service.
 *
 *   node --test test/game-maths.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import gameMaths from '../plugins/builtin/game-maths.js'
import { fromYawPitchRoll, rotate, yawPitchRollOf } from '../plugins/builtin/game-maths/turns.js'

const near = (first, second) => first.every((value, axis) => Math.abs(value - second[axis]) < 1e-9)

test('yawPitchRollOf reads back the rotation fromYawPitchRoll made', () => {
  for (const rotation of [[0.3, -1.2, 2.5], [-0.7, 2.9, -0.1], [0, 0, 0], [1.2, 0.4, -2.8]]) {
    assert.ok(near(yawPitchRollOf(fromYawPitchRoll(...rotation)), rotation), `${rotation}`)
  }
})

test('straight up, the read-back rotation turns a point the same way', () => {
  const turn = fromYawPitchRoll(Math.PI / 2, 0.6, 0.4)
  const point = [0.2, -0.5, 0.9]
  assert.ok(near(rotate(fromYawPitchRoll(...yawPitchRollOf(turn)), point), rotate(turn, point)))
})

test('the plugin provides every helper as one frozen game.maths record', () => {
  const provided = {}
  gameMaths.onLoad({}, { provide: (key, value) => (provided[key] = value) })
  assert.deepEqual(gameMaths.provides, ['game.maths'])
  assert.ok(Object.isFrozen(provided['game.maths']))
  assert.equal(provided['game.maths'].clamp(5, 0, 1), 1)
})
