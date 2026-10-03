/** Optimized fights must retain exact reference states, metrics, limits and live target semantics. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { costs } from '../plugins/npc-lab/definitions.js'
import { enumerateLoadouts } from '../plugins/npc-lab/enumeration.js'
import { simulateDuel, createEvaluator } from '../plugins/npc-lab/simulation.js'
import { generateLoadout } from '../plugins/npc-lab/loadouts.js'
import { createRules } from '../plugins/grid-game/api.js'
const { test, suite } = defineSuite('Prepared simulation parity')
export default suite

test('full final states, work and measurements match reference across sampled whole-catalog layouts', () => {
  const opponent = generateLoadout({ recipe: 'hunger', budget: 12, seed: 41 })
  let index = 0, compared = 0
  const types = new Set()
  for (const { kit } of enumerateLoadouts({ pool: Object.keys(costs), maxItems: 2, budget: 10 })) {
    if (index++ % 37) continue
    for (const item of kit.items) types.add(item.type)
    for (const firstActor of ['first', 'second']) {
      const options = { firstActor, maxCycles: 8 }
      assert.deepEqual(simulateDuel(kit, opponent, options), simulateDuel(kit, opponent, { ...options, reference: true }))
      compared++
    }
  }
  assert.ok(compared >= 200)
  assert.equal(types.size, Object.keys(costs).length)
})
test('prepared opponent templates are isolated from caller mutation', () => {
  const opponent = generateLoadout({ recipe: 'poison', budget: 10 })
  const kit = generateLoadout({ recipe: 'defender', budget: 12 })
  const evaluate = createEvaluator([opponent], { maxCycles: 8 })
  const first = evaluate(kit)
  opponent.items.length = 0
  assert.deepEqual(evaluate(kit), first)
})
function compare(custom, initial, cycles = 3) {
  let state = initial, work = 0, count = 0
  const events = []
  while (!custom.winner(state) && count < cycles) {
    const result = custom.resolveCycle(state, { trace: 'events' })
    state = result.state; work += result.work; count++
    events.push(...result.trace)
  }
  const recorded = []
  const fast = custom.resolveFight(initial, { maxCycles: cycles, record: (kind, detail = {}) => recorded.push({ kind, ...structuredClone(detail) }) })
  assert.deepEqual(fast, { state, work, cycles: count })
  assert.deepEqual(recorded, events)
  return fast
}
test('extra-action loop blocking and event order match exactly', () => {
  const custom = createRules({ items: { chain: { name: 'Chain', footprint: [1, 1], abilities: [{ id: 'chain', trigger: { event: 'ownTurn' }, target: { kind: 'adjacentItems' }, effects: [{ type: 'triggerItem' }] }] } } })
  const initial = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 } }, items: [{ id: 'first', type: 'chain', owner: 'owner', position: [0, 0] }, { id: 'second', type: 'chain', owner: 'owner', position: [1, 0] }] })
  compare(custom, initial)
})
test('dynamic enemy-targeted auras retarget after a death', () => {
  const custom = createRules({ items: { rod: { name: 'Rod', footprint: [1, 1], auras: [{ target: { kind: 'enemy' }, stat: 'exposure', amount: 2 }], abilities: [{ id: 'strike', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: 2 }] }] } }, statuses: { burn: { abilities: [{ id: 'burn', trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'damage', amount: { stat: 'exposure' } }] }] } } })
  const initial = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 }, first: { team: 'foe', maxHealth: 1 }, second: { team: 'foe', maxHealth: 8 } }, items: [{ id: 'rod', type: 'rod', owner: 'owner', position: [0, 0] }] })
  initial.actors.second.statuses.burn = { stacks: 1, duration: 'combat', source: { kind: 'item', id: 'rod' } }
  compare(custom, initial)
})
test('failed fast fights preserve input and retain the work limit', () => {
  const custom = createRules({ items: { loop: { name: 'Loop', footprint: [1, 1], abilities: [
    { id: 'start', trigger: { event: 'combatStart' }, target: { kind: 'self' }, effects: [{ type: 'applyStatus', status: 'curse', amount: 1 }] },
    { id: 'again', trigger: { event: 'statusApplied' }, target: { kind: 'self' }, effects: [{ type: 'applyStatus', status: 'curse', amount: 1 }] }
  ] } }, statuses: { curse: {} } })
  const initial = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 } }, items: [{ id: 'loop', type: 'loop', owner: 'owner', position: [0, 0] }] })
  const before = structuredClone(initial)
  assert.throws(() => custom.resolveFight(initial), /budget exceeded/)
  assert.deepEqual(initial, before)
  assert.throws(() => custom.resolveCycle(initial), /budget exceeded/)
})

test('captured fight runners isolate caller edits and repeated results', () => {
  const custom = createRules({ items: { blade: { name: 'Blade', footprint: [1, 1], abilities: [{ id: 'hit', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: 2 }] }] } } })
  const initial = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 }, enemy: { team: 'foe', maxHealth: 12 } }, items: [{ id: 'blade', type: 'blade', owner: 'owner', position: [0, 0] }] })
  const run = custom.createFightRunner(initial)
  const expected = custom.resolveFight(initial, { maxCycles: 3 })
  initial.actors.enemy.health = 1
  const first = run({ maxCycles: 3 })
  assert.deepEqual(first, expected)
  first.state.items.blade.stats.damage = 999
  assert.deepEqual(run({ maxCycles: 3 }), expected)
})

test('status routing follows removal, reapplication, stacking and next-action expiry', () => {
  const custom = createRules({ items: { charm: { name: 'Charm', footprint: [1, 1], abilities: [
    { id: 'strip', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'removeStatus', status: 'charge', amount: 99 }] },
    { id: 'charge', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'applyStatus', status: 'charge', amount: 1 }] },
    { id: 'stack', trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'applyStatus', status: 'charge', amount: 2 }] },
    { id: 'restore', trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'applyStatus', status: 'charge', amount: 1 }] }
  ] } }, statuses: { charge: { duration: 'nextAction', abilities: [{ id: 'release', trigger: { event: 'ownTurn' }, target: { kind: 'self' }, effects: [{ type: 'resource', resource: 'charge', amount: { stacks: true } }] }] } } })
  const initial = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 } }, items: [{ id: 'charm', type: 'charm', owner: 'owner', position: [0, 0] }] })
  const result = compare(custom, initial, 5)
  assert.equal(result.state.items.charm.resources.charge, 15)
})

test('dense adjacency reactions preserve complete event order over repeated cycles', () => {
  const custom = createRules({ items: { charm: { name: 'Charm', footprint: [1, 1], abilities: [
    { id: 'guard', trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'guard', amount: 1 }] },
    { id: 'echo', trigger: { event: 'itemActivated', source: { kind: 'adjacentItems' } }, target: { kind: 'self' }, effects: [{ type: 'resource', resource: 'charge', amount: 1 }] }
  ] } } })
  const initial = custom.createState({ columns: 4, rows: 3, actors: { owner: { team: 'crew', maxHealth: 12 } }, items: Array.from({ length: 12 }, (_, index) => ({ id: 'charm-' + index, type: 'charm', owner: 'owner', position: [index % 4, Math.floor(index / 4)] })) })
  const result = compare(custom, initial, 10)
  assert.equal(result.state.items['charm-5'].resources.charge, 40)
  assert.equal(result.state.items['charm-0'].resources.charge, 20)
})
