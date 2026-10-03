/** Exhaustive coverage is checked against small independently constructed permutation spaces. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { enumerateLoadouts } from '../plugins/npc-lab/enumeration.js'
import { exhaustiveBatch } from '../plugins/npc-lab/exhaustive.js'
import { canonicalKit, kitIdentity } from '../plugins/npc-lab/combo-space.js'
import { validateLoadout } from '../plugins/npc-lab/loadouts.js'
import { evaluateLoadout } from '../plugins/npc-lab/simulation.js'
const { test, suite } = defineSuite('Exhaustive loadouts')
export default suite

test('single-cell duplicate enumeration has the exact combinatorial count', () => {
  const all = [...enumerateLoadouts({ pool: ['salve'], maxItems: 2, duplicateLimit: 2, budget: 6 })]
  assert.equal(all.length, 1 + 9 + 36)
  assert.equal(new Set(all.map(entry => kitIdentity(entry.kit))).size, all.length)
  assert.equal([...enumerateLoadouts({ pool: ['salve'], maxItems: 2, duplicateLimit: 1, budget: 6 })].length, 10)
  assert.equal([...enumerateLoadouts({ pool: ['salve'], maxItems: 2, duplicateLimit: 2, budget: 3 })].length, 10)
})
test('enumerator matches brute-force ordered placements including multi-cell items', () => {
  const options = []
  for (const type of ['dagger', 'salve']) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) options.push({ type, position: [x, y] })
  const expected = new Set()
  const accept = items => {
    const kit = canonicalKit({ actor: 'scavenger', items })
    if (validateLoadout(kit).valid) expected.add(kitIdentity(kit))
  }
  accept([])
  for (const first of options) { accept([first]); for (const second of options) accept([first, second]) }
  const actual = [...enumerateLoadouts({ pool: ['dagger', 'salve'], maxItems: 2, duplicateLimit: 2, budget: 6 })].map(entry => kitIdentity(entry.kit))
  assert.equal(actual.length, new Set(actual).size)
  assert.deepEqual(new Set(actual), expected)
})
test('storage chains, required items and contents are included without invalid or duplicate layouts', () => {
  const all = [...enumerateLoadouts({ pool: ['pouch', 'pack', 'dagger'], maxItems: 2, budget: 8, required: ['pouch'] })]
  assert.ok(all.some(entry => entry.kit.items.some(item => item.type === 'dagger' && item.position[0] === 3)))
  assert.ok(all.some(entry => entry.kit.items.filter(item => item.type === 'pouch').length === 2))
  for (const entry of all) assert.equal(validateLoadout(entry.kit).valid, true)
  assert.equal(new Set(all.map(entry => kitIdentity(entry.kit))).size, all.length)
})
test('checkpointed batches equal uninterrupted full-cycle simulations with both initiatives', () => {
  const references = [{ actor: 'sentinel', items: [{ key: 'blade', type: 'dagger', position: [1, 0] }] }]
  const request = { settings: { pool: ['dagger'], maxItems: 1 }, references, maxCycles: 12 }
  const full = exhaustiveBatch({ ...request, limit: 100 })
  let resumed = exhaustiveBatch({ ...request, limit: 2 })
  assert.equal(resumed.complete, false)
  assert.equal(resumed.nextIndex, 2)
  while (!resumed.complete) resumed = exhaustiveBatch({ ...request, limit: 2, checkpoint: resumed })
  assert.deepEqual(resumed, full)
  assert.equal(full.nextIndex, 7)
  assert.equal(full.simulated, 14)
  assert.equal(full.failures, 0)
  for (const entry of full.top) {
    assert.deepEqual(entry.report, evaluateLoadout(entry.kit, references, { maxCycles: 12 }))
    assert.ok(entry.report.matches.some(match => match.cycles > 1))
  }
  assert.throws(() => exhaustiveBatch({ ...request, maxCycles: 10, checkpoint: resumed }), /Checkpoint/)
})
test('cycle-limited fights remain stalemates and required pools reject malformed experiments', () => {
  const report = exhaustiveBatch({ settings: { pool: ['salve'], maxItems: 1 }, references: [{ actor: 'sentinel', items: [] }], maxCycles: 2 })
  assert.equal(report.stalemates, 20)
  assert.ok(report.top.every(entry => entry.report.wins === 0))
  assert.throws(() => [...enumerateLoadouts({ required: ['missing'] })], /Required/)
  assert.throws(() => exhaustiveBatch({ limit: 0 }), /limits/)
})
