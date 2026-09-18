import test from 'node:test'
import assert from 'node:assert/strict'
import spatialPlugin from '../plugins/builtin/spatial-hash.js'
import crowdPlugin from '../plugins/builtin/crowd.js'

/**
 * A crowd driven by a fixed clock and stream, over the real Spatial Hash grid.
 *
 * The numbers come from the caller, as the plugin promises, so a run of these
 * tests is the same run every time and a position can be asserted exactly.
 */
function world(seed = 7) {
  let state = seed
  const context = {
    time: 0,
    random: () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 },
    bus: { on: () => {}, emit: () => {} }
  }
  spatialPlugin.onLoad(context)
  crowdPlugin.onLoad(context)
  return context
}

/** Members in a tight clump, each half a metre wide, so every pair overlaps. */
function clump(count, spread = 0.05) {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 0.209
    return { id: `m${index}`, x: Math.cos(angle) * spread, z: Math.sin(angle) * spread, properties: { radius: 0.5 } }
  })
}

function closestPair(members) {
  let closest = Infinity
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      closest = Math.min(closest, Math.hypot(members[i].x - members[j].x, members[i].z - members[j].z))
    }
  }
  return closest
}

test('a clump separates until no member overlaps another', () => {
  const context = world()
  const members = clump(30)
  const group = context.crowd.group('horde', { cellSize: 1.4 })
  for (const member of members) group.add(member)

  assert.ok(closestPair(members) < 0.1, 'the fixture starts overlapping')
  for (let step = 0; step < 60; step++) {
    context.time = step / 60
    assert.equal(group.drive(1 / 60, { separation: 1.2, relax: 1 }), 30)
  }
  // Two members of radius 0.5 may not be nearer than 1.0 without overlapping.
  assert.ok(closestPair(members) >= 0.95, `closest pair ${closestPair(members).toFixed(3)}`)
  assert.ok(group.stats.neighbourTests > 0, 'the pass reports the pairs it tested')
})

test('two members in the same place part, because no direction is available', () => {
  const context = world()
  const pair = [
    { id: 'a', x: 2, z: -1, properties: { radius: 0.5 } },
    { id: 'b', x: 2, z: -1, properties: { radius: 0.5 } }
  ]
  const group = context.crowd.group('horde', { cellSize: 1.4 })
  for (const member of pair) group.add(member)
  for (let step = 0; step < 30; step++) {
    context.time = step / 60
    group.drive(1 / 60, { separation: 1.2, relax: 1 })
  }
  assert.ok(closestPair(pair) >= 0.95, `closest pair ${closestPair(pair).toFixed(3)}`)
})

test('the same crowd driven twice moves identically', () => {
  const positions = () => {
    const context = world()
    const members = clump(20, 0.4)
    const group = context.crowd.group('horde', { cellSize: 1.4 })
    for (const member of members) group.add(member)
    for (let step = 0; step < 20; step++) {
      context.time = step / 60
      group.drive(1 / 60, { towards: { x: 3, z: 2 }, separation: 1.1 })
    }
    return members.map(member => [member.x, member.z, member.rotation])
  }
  assert.deepEqual(positions(), positions())
})

test('an empty group is driven without work and says so', () => {
  const context = world()
  const group = context.crowd.group('empty', { cellSize: 1.4 })
  assert.equal(group.drive(1 / 60, { towards: { x: 1, z: 1 } }), 0)
  assert.equal(group.stats.neighbourTests, 0)
  assert.equal(group.stats.drivenLastStep, 0)
})
