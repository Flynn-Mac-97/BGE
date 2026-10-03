/** Discovery checks enforce search bounds, independence of holdouts and reproducible explanations. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { searchCombos } from '../plugins/npc-lab/combo-search.js'
import { canonicalKit, kitIdentity, acceptsKit, searchSettings, mutateKit } from '../plugins/npc-lab/combo-space.js'
import { objectives, scoreReport } from '../plugins/npc-lab/combo-score.js'
import { generateLoadout, validateLoadout } from '../plugins/npc-lab/loadouts.js'
import { evaluateLoadout, simulateDuel } from '../plugins/npc-lab/simulation.js'
const { test, suite } = defineSuite('Combo discovery')
export default suite
const training = [generateLoadout({ recipe: 'poison', budget: 5 })]
const holdout = [generateLoadout({ recipe: 'defender', budget: 8 })]

test('canonical identities remove item ID/order noise but retain placement differences', () => {
  const kit = training[0], copy = structuredClone(kit)
  copy.items.reverse(); copy.items.forEach((item, index) => { item.key = 'other-' + index })
  assert.equal(kitIdentity(kit), kitIdentity(copy))
  copy.items[0].position = [0, 1]
  assert.notEqual(kitIdentity(kit), kitIdentity(copy))
})
test('legal-space filters enforce budget, pool, duplicate count, max items and geometry', () => {
  const settings = searchSettings({ budget: 4, pool: ['dagger'], duplicateLimit: 1 })
  const kit = canonicalKit({ actor: 'scavenger', items: [{ type: 'dagger', position: [0, 0] }] })
  assert.equal(acceptsKit(kit, settings), true)
  kit.items.push({ key: 'second', type: 'dagger', position: [1, 0] })
  assert.equal(acceptsKit(kit, settings), false)
  assert.equal(acceptsKit(kit, { ...settings, duplicateLimit: 2 }), true)
  assert.equal(acceptsKit(kit, { ...settings, duplicateLimit: 2, budget: 3 }), false)
  assert.equal(acceptsKit(kit, { ...settings, duplicateLimit: 2, maxItems: 1 }), false)
  kit.items[1].position = [0, 0]
  assert.equal(acceptsKit(kit, { ...settings, duplicateLimit: 2 }), false)
})
test('mutation operations leave their parent intact and include item and placement changes', () => {
  const kit = canonicalKit(training[0]), before = structuredClone(kit), settings = searchSettings({ pool: ['dagger'] })
  for (const operation of ['add', 'remove', 'replace', 'move', 'swap']) {
    const result = mutateKit(kit, settings, () => 0.1, operation)
    assert.equal(result.operation, operation)
    assert.deepEqual(kit, before)
  }
  assert.equal(mutateKit(kit, settings, () => 0.1, 'add').kit.items.length, 3)
})
test('seeded search is reproducible, bounded and does not use holdouts to rank candidates', () => {
  const request = { training, holdout, evaluations: 20, finalists: 1, seed: 41, maxCycles: 8 }
  const first = searchCombos(request), second = searchCombos(request)
  assert.deepEqual(first, second)
  assert.ok(first.counts.evaluated <= request.evaluations)
  assert.ok(first.counts.attempts <= request.evaluations * 32)
  for (const candidate of first.archive) {
    assert.equal(acceptsKit(candidate.kit, first.settings), true)
    assert.equal(validateLoadout(candidate.kit).valid, true)
  }
  const alternate = searchCombos({ ...request, holdout: [generateLoadout({ recipe: 'hunger', budget: 10 })] })
  assert.deepEqual(first.archive, alternate.archive)
  assert.deepEqual(first.discoveries.map(item => item.id), alternate.discoveries.map(item => item.id))
  assert.ok(Object.values(first.mutations).filter(count => count > 0).length >= 4)
})
test('ablations compare actual held-out outcomes and replay requests reproduce selected matches', () => {
  const report = searchCombos({ training, holdout, evaluations: 12, finalists: 1, maxCycles: 8 })
  const best = report.discoveries[0]
  assert.ok(best.removals.length)
  const removal = best.removals.find(entry => !entry.skipped)
  const kit = canonicalKit({ ...best.kit, items: best.kit.items.filter(item => item.key !== removal.removed.key) })
  const measured = evaluateLoadout(kit, holdout, { maxCycles: 8 })
  assert.equal(removal.winRateDelta, best.holdout.winRate - measured.winRate)
  const replay = simulateDuel(best.replayRequest.first, best.replayRequest.second, best.replayRequest.options)
  assert.equal(replay.winner, best.holdout.matches[0].winner)
  assert.equal(replay.cycles, best.holdout.matches[0].cycles)
  assert.ok(replay.trace.length)
  assert.ok(report.authoring.catalog.items.dagger)
})
test('objective scores are explicit and malformed or leaking experiments are refused', () => {
  const report = evaluateLoadout(training[0], holdout, { maxCycles: 3 })
  for (const objective of objectives) assert.ok(Number.isFinite(scoreReport(report, 5, objective)))
  assert.throws(() => searchCombos({ evaluations: 129 }), /evaluations/)
  assert.throws(() => searchCombos({ duplicateLimit: 0 }), /duplicateLimit/)
  assert.throws(() => searchCombos({ pool: ['unknown'] }), /pool/)
  assert.throws(() => searchCombos({ objective: 'unknown' }), /objective/)
  assert.throws(() => searchCombos({ training, holdout: training }), /differ/)
  assert.throws(() => searchCombos({ training: [], holdout }), /valid kits/)
})
