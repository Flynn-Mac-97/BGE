/**
 * Pickups: a collector's own reach wins over the setting, and a reach of 0
 * means it takes nothing rather than the default.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBus } from '../engine/bus.js'
import pickups from '../plugins/builtin/pickups.js'

function loaded() {
  const context = { bus: makeBus(), world: { entities: [] } }
  pickups.onLoad(context)
  return context
}

test('a collector with no reach of its own uses the setting', () => {
  const context = loaded()
  assert.equal(context.pickups.reachOf({ properties: {} }), context.pickups.settings().radius)
})

test('a collector with a reach of 0 reaches nothing', () => {
  const context = loaded()
  assert.equal(context.pickups.reachOf({ properties: { pickupRadius: 0 } }), 0)
})
