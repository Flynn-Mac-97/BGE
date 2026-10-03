/** NPC authoring tests exercise production combat, isolated inventories and bounded deterministic search. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { generateLoadout, validateLoadout } from '../plugins/npc-lab/loadouts.js'
import { createDuel, simulateDuel, evaluateLoadout } from '../plugins/npc-lab/simulation.js'
import { searchLoadouts, referenceLoadouts } from '../plugins/npc-lab/search.js'
const { test, suite } = defineSuite('NPC recipes and simulation')
export default suite
const poison = () => generateLoadout({ recipe: 'poison', budget: 5, seed: 7 })

test('actor-local grids accept identical coordinates without cross-owner adjacency or coating', () => {
  const state = createDuel(poison(), poison())
  assert.deepEqual(state.items['first-blade'].position, state.items['second-blade'].position)
  assert.equal(rules.adjacent(state, 'first-coating', 'second-blade'), false)
  const selector = { kind: 'directionalNeighbour', direction: 'right', tags: ['weapon'] }
  assert.deepEqual(rules.targets(state, { kind: 'item', id: 'second-coating' }, selector), [{ kind: 'item', id: 'second-blade' }])
  assert.equal(rules.place(state, 'second-coating', [1, 0]), false)
})
test('storage expansion and round-trip validation remain local to the owning actor', () => {
  const state = createDuel(poison(), poison())
  rules.addItem(state, 'bag', 'pack', 'first')
  assert.equal(rules.place(state, 'bag', [3, 0]), true)
  assert.equal(state.actors.first.inventory.columns, 5)
  assert.equal(state.actors.second.inventory.columns, 3)
  assert.equal(rules.place(state, 'second-blade', [3, 0]), false)
  assert.equal(rules.place(state, 'first-blade', [3, 0]), true)
  assert.equal(rules.place(state, 'bag', null), false)
  const result = rules.resolveCycle(JSON.parse(JSON.stringify(state)), { ownerOrder: ['first', 'second'], trace: 'events' })
  assert.equal(result.state.actors.first.inventory.columns, 5)
  assert.equal(result.state.actors.second.inventory.columns, 3)
})
test('actor traits expand shared ability references and run through the same damage events', () => {
  const hungry = generateLoadout({ recipe: 'hunger', budget: 7, seed: 1 })
  const state = createDuel(poison(), hungry)
  assert.equal(state.actors.second.abilities[0].id, 'endureHunger')
  const result = rules.resolveCycle(state, { ownerOrder: ['first', 'second'], trace: 'events' })
  assert.ok(result.trace.some(event => event.source?.id === 'second' && event.ability?.id === 'endureHunger'))
})
test('recipe constraints reject broken links, overlap, unknown actors and unaffordable essentials', () => {
  const kit = poison()
  assert.equal(validateLoadout(kit).valid, true)
  const broken = structuredClone(kit)
  broken.items.find(item => item.key === 'coating').position = [2, 0]
  assert.equal(validateLoadout(broken).valid, false)
  broken.items[0].position = [2, 0]
  assert.equal(validateLoadout(broken).valid, false)
  assert.equal(validateLoadout({ actor: 'missing', items: [] }).valid, false)
  assert.throws(() => generateLoadout({ recipe: 'poison', budget: 4 }), /at least 5/)
  assert.throws(() => generateLoadout({ recipe: 'missing', budget: 8 }), /Unknown recipe/)
})
test('generation is reproducible and all accepted optional items fit within the authoring budget', () => {
  for (const recipe of ['poison', 'defender', 'hunger']) for (const seed of [1, 41, 90001]) {
    const request = { recipe, budget: 12, seed }
    const first = generateLoadout(request)
    assert.deepEqual(first, generateLoadout(request))
    assert.equal(validateLoadout(first).valid, true)
    assert.ok(first.cost <= request.budget)
  }
})
test('cheap trace modes preserve exact outcome, work and input while dropping snapshots', () => {
  const state = createDuel(poison(), poison()), before = structuredClone(state)
  const options = { ownerOrder: ['first', 'second'] }
  const full = rules.resolveCycle(state, options)
  const events = rules.resolveCycle(state, { ...options, trace: 'events' })
  const none = rules.resolveCycle(state, { ...options, trace: 'none' })
  assert.deepEqual(full.state, events.state)
  assert.deepEqual(full.state, none.state)
  assert.equal(full.work, events.work)
  assert.equal(none.trace.length, 0)
  assert.ok(events.trace.every(event => !('state' in event)))
  assert.ok(JSON.stringify(events.trace).length < JSON.stringify(full.trace).length / 2)
  assert.deepEqual(state, before)
  assert.throws(() => rules.resolveCycle(state, { ownerOrder: ['first', 'first'] }), /ownerOrder/)
  assert.throws(() => rules.resolveCycle(state, { trace: 'typo' }), /trace/)
})
test('simulation replays match cheap results and non-attacking kits stop at the cycle cap', () => {
  const first = poison(), second = generateLoadout({ recipe: 'defender', budget: 8 })
  const cheap = simulateDuel(first, second)
  const replay = simulateDuel(first, second, { replay: true })
  const { trace, ...report } = replay
  assert.deepEqual(report, cheap)
  assert.ok(trace.length > 0)
  const empty = { actor: 'sentinel', items: [] }
  const stalled = simulateDuel(empty, empty, { maxCycles: 3 })
  assert.equal(stalled.winner, 'stalemate')
  assert.equal(stalled.cycles, 3)
  assert.throws(() => simulateDuel(first, second, { maxCycles: 101 }), /bounds/)
})
test('both initiatives are measured and repeated candidate kits reuse measured results', () => {
  const report = evaluateLoadout(poison(), [poison()])
  assert.equal(report.matches.length, 2)
  assert.equal(report.winRate, 0)
  assert.equal(report.draws, 2)
  assert.deepEqual(report.matches.map(match => match.firstActor), ['first', 'second'])
  const request = { recipes: ['poison'], budgets: [4, 5], seeds: [1, 2], references: [poison()] }
  const search = searchLoadouts(request)
  assert.equal(search.rejected.length, 2)
  assert.equal(search.uniqueLoadouts, 1)
  assert.equal(search.simulated, 2)
  assert.equal(search.candidates.length, 2)
  assert.deepEqual(search, searchLoadouts(request))
  assert.equal(referenceLoadouts().length, 3)
  assert.throws(() => searchLoadouts({ seeds: Array.from({ length: 129 }, (_, index) => index) }), /128/)
})

test('authoring inspection warns about late preparation even without a mandatory link', () => {
  const kit = poison()
  kit.links = []
  kit.items.find(item => item.key === 'coating').position = [0, 1]
  const report = validateLoadout(kit)
  assert.equal(report.valid, true)
  assert.ok(report.warnings.some(warning => warning.includes('preparation follows')))
})
test('status damage retains its original source for cheap simulation measurements', () => {
  const state = createDuel(poison(), { actor: 'sentinel', items: [] })
  const result = rules.resolveCycle(state, { ownerOrder: ['first', 'second'], trace: 'events' })
  const tick = result.trace.find(event => event.statusId === 'poison' && event.kind === 'ability')
  assert.deepEqual(tick.origin, { kind: 'item', id: 'first-blade' })
  const report = simulateDuel(poison(), { actor: 'sentinel', items: [] })
  assert.equal(report.metrics.first.damage, 12)
  assert.equal(report.metrics.second.damage, 0)
})
