/** Core placement and combat regressions use public rule operations and arbitrary instances. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules, itemReference } from '../plugins/bell/rules.js'
import { createRules } from '../plugins/grid-game/api.js'
import { catalog } from '../plugins/bell/catalog.js'
import { battleWith, cycle } from '../tools/rule-fixtures.mjs'
const { test, suite } = defineSuite('Modular grid rules')
export default suite

test('placement is atomic, bounds use the whole shape and diagonal neighbours do not link', () => {
  const battle = battleWith({ dagger: [1, 0], venom: [0, 0], tooth: [2, 2] })
  const before = structuredClone(battle)
  assert.equal(rules.place(battle, 'dagger', [0, 0]), false)
  assert.equal(rules.place(battle, 'dagger', [1, 2]), false)
  assert.deepEqual(battle, before)
  assert.equal(rules.adjacent(battle, 'dagger', 'tooth'), false)
  assert.equal(rules.place(battle, 'tooth', [2, 1]), true)
  assert.equal(rules.adjacent(battle, 'dagger', 'tooth'), true)
})
test('full-height right expansion preserves positions and refuses occupied shrinkage', () => {
  const battle = battleWith()
  assert.equal(rules.resize(battle, 4, 3), true)
  assert.deepEqual(battle.items.dagger.position, [1, 0])
  assert.equal(rules.place(battle, 'dagger', [3, 1]), true)
  assert.equal(rules.resize(battle, 3, 3), false)
  assert.equal(battle.grid.columns, 4)
})
test('one multi-cell shield acts once per scan, even with four occupied cells', () => {
  const result = cycle(battleWith({ dagger: [0, 0], buckler: [1, 0] }))
  assert.equal(result.state.actors.recruit.health, 11)
  assert.equal(result.trace.filter(step => step.ability?.id === 'protect').length, 1)
})
test('venom → dagger → adjacent tooth reproduces the prototype combo', () => {
  let battle = battleWith({ venom: [0, 0], dagger: [1, 0], tooth: [2, 0] })
  const first = cycle(battle)
  assert.equal(first.state.actors.enemy.health, 10)
  assert.equal(first.state.actors.recruit.health, 10)
  assert.equal(first.state.actors.enemy.statuses.poison.stacks, 1)
  assert.equal(first.state.actors.recruit.guard, 0)
  assert.equal(first.trace.filter(step => step.ability?.id === 'venomGuard').length, 1)
  battle = cycle(cycle(first.state).state).state
  assert.equal(rules.winner(battle), 'crew')
  assert.equal(battle.actors.recruit.health, 8)
})
test('preparation uses any touching footprint cell and expires when applied too late', () => {
  const early = cycle(battleWith({ venom: [0, 0], dagger: [1, 0] }))
  const late = cycle(battleWith({ venom: [0, 1], dagger: [1, 0] }))
  assert.equal(early.state.actors.enemy.health, 10)
  assert.equal(late.state.actors.enemy.health, 12)
  assert.ok(late.trace.some(step => step.kind === 'expired'))
  assert.deepEqual(late.state.items.dagger.statuses, {})
  assert.ok(late.trace.some(step => step.ability?.id === 'coat'))
})
test('wrong-facing preparation misses and does not spend the per-cycle use', () => {
  const result = cycle(battleWith({ dagger: [0, 0], venom: [1, 0] }))
  assert.equal(result.state.actors.enemy.health, 12)
  assert.deepEqual(result.state.items.venom.uses, {})
})
test('temporary damage consumes once and does not alter base damage', () => {
  const result = cycle(battleWith({ stone: [0, 0], dagger: [1, 0] }))
  assert.equal(result.state.actors.enemy.health, 10)
  assert.equal(result.state.items.dagger.stats.damage, 2)
  assert.deepEqual(result.state.items.dagger.modifiers, [])
})
test('two copies have independent placement and charges, with stable deterministic snapshots', () => {
  const battle = battleWith({ salve: [0, 0], dagger: [1, 0] }, { health: 5 })
  assert.equal(rules.addItem(battle, 'second-salve', 'salve', 'recruit'), true)
  rules.place(battle, 'second-salve', [2, 0])
  const original = structuredClone(battle)
  const result = cycle(battle)
  assert.equal(result.state.actors.recruit.health, 5)
  assert.equal(result.state.items.salve.uses['item:mend'].charges, 0)
  assert.equal(result.state.items['second-salve'].uses['item:mend'].charges, 0)
  assert.deepEqual(battle, original)
  assert.deepEqual(cycle(battle), result)
  result.state.actors.recruit.health = 1
  assert.notEqual(result.trace[0].state.actors.recruit.health, 1)
})
test('healing caps at maximum and charges refill on the next cycle', () => {
  const first = cycle(battleWith({ salve: [0, 0], dagger: [1, 0] }, { health: 11 }))
  assert.equal(first.state.actors.recruit.health, 8)
  const second = cycle(first.state)
  assert.equal(second.state.actors.recruit.health, 6)
})
test('aura is derived from current placement and never permanently changes stats', () => {
  const battle = battleWith({ dagger: [0, 0], banner: [1, 0] })
  assert.equal(rules.stat(battle, itemReference('dagger'), 'damage'), 3)
  rules.place(battle, 'banner', null)
  assert.equal(rules.stat(battle, itemReference('dagger'), 'damage'), 2)
})
test('owner Hunger is gained by reactions and atomically spent by a later cup', () => {
  const battle = battleWith({ dagger: [0, 0], hungryTooth: [1, 0], bloodCup: [2, 0] }, { health: 5 })
  battle.actors.recruit.resources.hunger = 2
  const result = cycle(battle)
  assert.equal(result.state.actors.recruit.resources.hunger, 0)
  assert.equal(result.state.actors.recruit.health, 7)
  assert.deepEqual(result.state.items.hungryTooth.resources, {})
})
test('unaffordable costs do not partially spend or heal and conditions protect a full-health cup', () => {
  const battle = battleWith({ bloodCup: [0, 0], dagger: [1, 0] }, { health: 5 })
  battle.actors.recruit.resources.hunger = 2
  assert.equal(cycle(battle).state.actors.recruit.resources.hunger, 2)
  battle.actors.recruit.health = 12
  battle.actors.recruit.resources.hunger = 3
  assert.equal(cycle(battle).state.actors.recruit.resources.hunger, 3)
})
test('poison and regeneration reuse effects at their declared lifecycle events', () => {
  const battle = battleWith({ sprig: [0, 0], dagger: [1, 0] }, { health: 6 })
  const first = cycle(battle)
  assert.equal(first.state.actors.recruit.health, 2)
  const second = cycle(first.state)
  const regeneration = second.trace.find(step => step.ability?.id === 'regenerationTick')
  assert.equal(regeneration.state.actors.recruit.health, 4)
  assert.equal(regeneration.state.actors.recruit.statuses.regeneration.stacks, 1)
})
test('cleansing removes status before its damage event', () => {
  const battle = battleWith({ salt: [0, 0], dagger: [1, 0] })
  battle.actors.recruit.statuses.poison = { stacks: 3, duration: 'combat' }
  const result = cycle(battle)
  assert.equal(result.state.actors.recruit.health, 8)
  assert.deepEqual(result.state.actors.recruit.statuses, {})
})
test('echo grants an extra weapon action once per combat, then normal scan still happens', () => {
  const first = cycle(battleWith({ echo: [1, 0], dagger: [1, 1] }))
  assert.equal(first.state.actors.enemy.health, 10)
  assert.equal(first.trace.filter(step => step.ability?.id === 'strike').length, 2)
  assert.equal(cycle(first.state).state.actors.enemy.health, 8)
})
test('circular item activation is blocked without freezing or suppressing the rest of the scan', () => {
  const custom = createRules({ items: { chain: { name: 'Chain', footprint: [1, 1], abilities: [{ id: 'chain', trigger: { event: 'ownTurn' }, target: { kind: 'adjacentItems' }, effects: [{ type: 'triggerItem' }] }] } } })
  const battle = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 } }, items: [{ id: 'first', type: 'chain', owner: 'owner', position: [0, 0] }, { id: 'second', type: 'chain', owner: 'owner', position: [1, 0] }] })
  const result = custom.resolveCycle(battle)
  assert.ok(result.trace.some(step => step.kind === 'blocked'))
  assert.equal(result.state.phase, 'planning')
  assert.ok(result.work < 100)
})
test('an unbounded status reaction fails transactionally instead of hanging', () => {
  const custom = createRules({ items: { loop: { name: 'Loop', footprint: [1, 1], abilities: [{ id: 'again', trigger: { event: 'statusApplied' }, target: { kind: 'self' }, effects: [{ type: 'applyStatus', status: 'curse', amount: 1 }] }] } }, statuses: { curse: {} } })
  const battle = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12 } }, items: [{ id: 'loop', type: 'loop', owner: 'owner', position: [0, 0] }] })
  const before = structuredClone(battle)
  assert.throws(() => custom.resolveEvent(battle, { kind: 'statusApplied', source: itemReference('loop') }, { budget: 30 }), /budget exceeded/)
  assert.deepEqual(battle, before)
})
test('an unfamiliar item type works by composing blocks; bad authoring fails at compile time', () => {
  const definitions = structuredClone(catalog)
  definitions.items.newRelic = { name: 'Unnamed Prototype', footprint: [1, 1], abilities: ['mend'], stats: { heal: 5 } }
  const custom = createRules(definitions)
  const battle = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12, health: 2 } }, items: [{ id: 'copy', type: 'newRelic', owner: 'owner', position: [0, 0] }] })
  assert.equal(custom.resolveCycle(battle).state.actors.owner.health, 7)
  definitions.abilities.mend.effects[0].type = 'typo'
  assert.throws(() => createRules(definitions), /unknown effect typo/)
  assert.equal(custom.catalog.abilities.mend.effects[0].type, 'heal')
})

test('all conditions can gate the same reusable effects, including empty cells and local resources', () => {
  const custom = createRules({ items: { worker: { name: 'Worker', tags: ['tool'], footprint: [1, 1], resources: { charge: 1 }, abilities: [{
    id: 'work', trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, conditions: [
      { kind: 'hasTag', subject: 'selfItem', tag: 'tool' }, { kind: 'cellEmpty', direction: 'right' },
      { kind: 'resourceAtLeast', subject: 'selfItem', resource: 'charge', amount: 1 }, { kind: 'hasStatus', status: 'ready' }, { kind: 'healthBelow', ratio: 1 }
    ], costs: [{ target: { kind: 'selfItem' }, resource: 'charge', amount: 1 }], effects: [{ type: 'heal', amount: 3 }]
  }] } }, statuses: { ready: {} } })
  const battle = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12, health: 5 } }, items: [{ id: 'worker', type: 'worker', owner: 'owner', position: [0, 0] }] })
  battle.actors.owner.statuses.ready = { stacks: 1, duration: 'combat' }
  const result = custom.resolveCycle(battle)
  assert.equal(result.state.actors.owner.health, 8)
  assert.equal(result.state.items.worker.resources.charge, 0)
  assert.equal(custom.resolveCycle(result.state).state.actors.owner.health, 8)
  custom.place(battle, 'worker', [2, 0])
  assert.equal(custom.resolveCycle(battle).state.actors.owner.health, 5)
})
test('while-adjacent statuses stop contributing when stowed and combat expiry removes temporary effects', () => {
  const definitions = structuredClone(catalog)
  definitions.statuses.aid = { duration: 'whileAdjacent', modifiers: [{ stat: 'damage', amount: 3 }] }
  const custom = createRules(definitions)
  const battle = battleWith({ dagger: [1, 0], stone: [0, 0] })
  battle.items.dagger.statuses.aid = { stacks: 1, duration: 'whileAdjacent', source: itemReference('stone') }
  assert.equal(custom.stat(battle, itemReference('dagger'), 'damage'), 5)
  custom.place(battle, 'stone', null)
  assert.equal(custom.stat(battle, itemReference('dagger'), 'damage'), 2)
  battle.items.dagger.modifiers.push({ stat: 'damage', amount: 20, duration: 'combat', source: itemReference('dagger') })
  const result = custom.resolveCycle(battle)
  assert.equal(custom.winner(result.state), 'crew')
  assert.deepEqual(result.state.items.dagger.modifiers, [])
})
test('resource costs aggregate atomically and resource gains respect caps', () => {
  const custom = createRules({ items: { vessel: { name: 'Vessel', footprint: [1, 1], resources: { charge: 2 }, resourceCaps: { charge: 3 }, abilities: [
    { id: 'spend', trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, costs: [{ target: { kind: 'selfItem' }, resource: 'charge', amount: 2 }, { target: { kind: 'selfItem' }, resource: 'charge', amount: 2 }], effects: [{ type: 'heal', amount: 10 }] },
    { id: 'refill', trigger: { event: 'cycleEnd' }, target: { kind: 'selfItem' }, effects: [{ type: 'resource', resource: 'charge', amount: 5 }] }
  ] } } })
  const battle = custom.createState({ actors: { owner: { team: 'crew', maxHealth: 12, health: 1 } }, items: [{ id: 'vessel', type: 'vessel', owner: 'owner', position: [0, 0] }] })
  const result = custom.resolveCycle(battle)
  assert.equal(result.state.actors.owner.health, 1)
  assert.equal(result.state.items.vessel.resources.charge, 3)
})
test('a stat lowered below zero deals nothing instead of failing the cycle', () => {
  const rules = createRules({ items: { staff: { name: 'Staff', footprint: [1, 1], stats: { potency: 5 }, abilities: [{ id: 'sap', trigger: { event: 'damageTaken', target: { kind: 'owner' } }, target: { kind: 'eventSource' }, effects: [{ type: 'applyStatus', status: 'sapped', amount: { stat: 'potency' } }] }] } },
    statuses: { sapped: { name: 'Sapped', stacking: 'max', duration: 'combat', modifiers: [{ stat: 'damage', amount: { stacks: true, scale: -1 } }] } } })
  let battle = rules.createState({ actors: { hero: { team: 'crew', maxHealth: 20 }, foe: { team: 'dungeon', maxHealth: 20, stats: { damage: 2 }, abilities: [{ id: 'hit', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }] } }, items: [{ id: 'staff', type: 'staff', owner: 'hero', position: [0, 0] }] })
  battle = rules.resolveCycle(battle, { afterCycle: ['foe'] }).state
  battle = rules.resolveCycle(battle, { afterCycle: ['foe'] }).state
  assert.equal(battle.actors.hero.health, 18)
})
