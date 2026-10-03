/** Spatial links, granted abilities and numeric primitives must match both execution paths. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { createRules } from '../plugins/grid-game/api.js'
import { stormExample } from '../plugins/grid-game/storm-example.js'
const { test, suite } = defineSuite('Composable item primitives')
export default suite

function compare(rules, input, cycles = 3) {
  const events = [], fastEvents = []
  let state = input, work = 0, count = 0
  while (!rules.winner(state) && count < cycles) {
    const result = rules.resolveCycle(state, { trace: 'events' })
    state = result.state; work += result.work; count++
    events.push(...result.trace)
  }
  const fast = rules.resolveFight(input, { maxCycles: cycles, record: (kind, detail = {}) => fastEvents.push({ kind, ...structuredClone(detail) }) })
  assert.deepEqual(fast, { state, work, cycles: count })
  assert.deepEqual(fastEvents, events)
  return fast.state
}
function stormState(rules) {
  return rules.createState({ actors: { hero: { team: 'crew', maxHealth: 100, inventory: { columns: 5, rows: 5 } }, enemy: { team: 'foe', maxHealth: 100, inventory: { columns: 5, rows: 5 } } }, items: [
    { id: 'totem', type: 'totem', owner: 'hero', position: [2, 2] },
    ...[[2, 1], [2, 3], [1, 2], [3, 2], [1, 1], [4, 2]].map((position, index) => ({ id: 'blade-' + index, type: 'blade', owner: 'hero', position })),
    { id: 'enemy-blade', type: 'blade', owner: 'enemy', position: [2, 1] }
  ] })
}
test('four-edge totem grants shocks once per linked weapon, excluding diagonal and other inventories', () => {
  const rules = createRules(stormExample), initial = stormState(rules)
  const graph = rules.relationships(initial)
  assert.deepEqual(graph.edges.map(edge => edge.to.id).sort(), ['blade-0', 'blade-1', 'blade-2', 'blade-3'])
  const final = compare(rules, initial, 2)
  assert.equal(final.actors.enemy.health, 68)
  assert.equal(final.actors.hero.health, 96)
  assert.equal(final.actors.enemy.statuses.shock, undefined)
  assert.equal(initial.actors.enemy.health, 100)
  rules.place(initial, 'totem', null)
  assert.equal(rules.relationships(initial).edges.length, 0)
  assert.equal(compare(rules, initial, 1).actors.enemy.health, 88)
})
test('rays stop at blockers, row/radius queries deduplicate and returned graphs are isolated', () => {
  const rules = createRules(stormExample), state = stormState(rules), source = { kind: 'item', id: 'totem' }
  assert.deepEqual(rules.targets(state, source, { kind: 'area', shape: 'rays', directions: ['right'], range: 3, first: true }).map(item => item.id), ['blade-3'])
  assert.equal(rules.targets(state, source, { kind: 'area', shape: 'row' }).length, 3)
  assert.equal(rules.targets(state, source, { kind: 'area', shape: 'radius', range: 1 }).length, 4)
  const graph = rules.relationships(state)
  graph.edges[0].abilities[0].effects[0].amount = 99
  assert.equal(rules.relationships(state).edges[0].abilities[0].effects[0].amount, 1)
})
test('multiple aura sources contribute independently', () => {
  const rules = createRules(stormExample), initial = stormState(rules)
  rules.addItem(initial, 'totem-two', 'totem', 'hero'); rules.place(initial, 'totem-two', [3, 1])
  assert.equal(rules.relationships(initial).edges.filter(edge => edge.to.id === 'blade-0').length, 2)
  assert.equal(compare(rules, initial, 1).actors.enemy.health, 82)
})
test('status consumption uses actual stacks, resource transfer respects caps and timing gates effects', () => {
  const rules = createRules({ statuses: { curse: {} }, items: { test: { name: 'Test', footprint: [1, 1], resources: { energy: 8 }, abilities: [
    { id: 'transfer', trigger: { event: 'cycleStart' }, target: { kind: 'owner' }, conditions: [{ kind: 'cycleEvery', amount: 2 }], effects: [{ type: 'transferResource', from: { kind: 'self' }, resource: 'energy', amount: 5 }] },
    { id: 'curse', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'applyStatus', status: 'curse', amount: 2 }, { type: 'consumeStatus', status: 'curse', amount: 5 }, { type: 'damage', amount: { previous: true, scale: 3 } }] }
  ] } } })
  const initial = rules.createState({ actors: { hero: { team: 'a', maxHealth: 100, resourceCaps: { energy: 3 } }, enemy: { team: 'b', maxHealth: 100 } }, items: [{ id: 'test', type: 'test', owner: 'hero', position: [0, 0] }] })
  const final = compare(rules, initial, 3)
  assert.equal(final.actors.hero.resources.energy, 3)
  assert.equal(final.items.test.resources.energy, 5)
  assert.equal(final.actors.enemy.health, 82)
})
test('invalid spatial and granted ability records fail at authoring boundary', () => {
  const invalid = structuredClone(stormExample)
  invalid.items.totem.grants[0].target.directions = ['northish']
  assert.throws(() => createRules(invalid), /directions/)
  invalid.items.totem.grants[0].target = { kind: 'enemy' }
  assert.throws(() => createRules(invalid), /fixed item/)
})

test('an emitter killed before a recipient acts contributes no Shock', () => {
  const catalog = structuredClone(stormExample)
  catalog.items.totem.grants[0].target.ownerOnly = false
  catalog.items.executioner = { name: 'Executioner', footprint: [1, 1], stats: { damage: 100 }, abilities: ['strike'] }
  const rules = createRules(catalog)
  const initial = rules.createState({ actors: { donor: { team: 'crew', maxHealth: 1 }, hero: { team: 'crew', maxHealth: 100 }, enemy: { team: 'foe', maxHealth: 100 } }, items: [
    { id: 'executioner', type: 'executioner', owner: 'enemy', position: [0, 0] },
    { id: 'totem', type: 'totem', owner: 'donor', position: [1, 1] },
    { id: 'blade', type: 'blade', owner: 'hero', position: [1, 2] }
  ] })
  assert.equal(rules.relationships(initial).edges.length, 1)
  const final = compare(rules, initial, 1)
  assert.equal(final.actors.donor.health, 0)
  assert.equal(final.actors.enemy.health, 98)
})
test('charge restoration does not reset other limits; guard stripping precedes damage', () => {
  const rules = createRules({ items: {
    blade: { name: 'Blade', footprint: [1, 1], abilities: [{ id: 'hit', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, limit: { charges: 1, perCycle: 1 }, effects: [{ type: 'removeGuard', amount: 2 }, { type: 'damage', amount: 4 }] }] },
    battery: { name: 'Battery', footprint: [1, 1], abilities: [{ id: 'refill', trigger: { event: 'ownTurn' }, target: { kind: 'directionalNeighbour', direction: 'left' }, effects: [{ type: 'modifyCharges', ability: 'hit', amount: 1 }, { type: 'triggerItem' }] }] }
  } })
  const initial = rules.createState({ actors: { hero: { team: 'crew', maxHealth: 100 }, enemy: { team: 'foe', maxHealth: 100 } }, items: [{ id: 'blade', type: 'blade', owner: 'hero', position: [0, 0] }, { id: 'battery', type: 'battery', owner: 'hero', position: [1, 0] }] })
  initial.actors.enemy.guard = 3
  const final = compare(rules, initial, 2)
  assert.equal(final.actors.enemy.health, 93)
  assert.equal(final.items.blade.uses['item:hit'].charges, 1)
})
test('pack contents and four-edge contact cross the attachment seam', () => {
  const catalog = structuredClone(stormExample)
  catalog.items.pack = { name: 'Pack', footprint: [1, 1], storage: { columns: 1 } }
  const rules = createRules(catalog)
  const state = rules.createState({ actors: { hero: { team: 'crew', maxHealth: 100, inventory: { columns: 3, rows: 3 } } }, items: [
    { id: 'pack', type: 'pack', owner: 'hero', position: [3, 0] }, { id: 'totem', type: 'totem', owner: 'hero', position: [2, 1] }, { id: 'blade', type: 'blade', owner: 'hero', position: [3, 1] }
  ] })
  assert.deepEqual(rules.targets(state, { kind: 'item', id: 'pack' }, { kind: 'containerItems' }), [{ kind: 'item', id: 'blade' }])
  assert.equal(rules.relationships(state).edges[0].to.id, 'blade')
})

test('full footprint edges reach every touching item without duplicate grant contributions', () => {
  const catalog = structuredClone(stormExample)
  catalog.items.totem.footprint = [2, 2]
  catalog.items.blade.footprint = [1, 2]
  const rules = createRules(catalog)
  const initial = rules.createState({ columns: 5, rows: 4, actors: { hero: { team: 'crew', maxHealth: 100 }, enemy: { team: 'foe', maxHealth: 100 } }, items: [
    { id: 'totem', type: 'totem', owner: 'hero', position: [1, 1] }, { id: 'blade', type: 'blade', owner: 'hero', position: [3, 1] }
  ] })
  assert.equal(rules.relationships(initial).edges.length, 1)
  assert.equal(compare(rules, initial, 1).actors.enemy.health, 97)
})
