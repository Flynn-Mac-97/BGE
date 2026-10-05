/** Enemy threats each do their one thing, and family powers switch on at 3 items, double at 5 and go out below 3. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { enemyTraits } from '../plugins/bell/descent/enemies.js'
import { familyPowerAbilities } from '../plugins/bell/descent/family-powers.js'
const { test, suite } = defineSuite('Threats and family powers')
export default suite

/** A fight: the recruit with family powers and `kit` items, against a foe with `traits` whose numbers are all `power`. */
function fight({ kit = [], traits = [], power = 4, cycles = 3, recruitStatuses = {}, foeStatuses = {} }) {
  const stats = { damage: 2 }
  for (const id of traits) stats[enemyTraits[id].stat] = power
  const state = rules.createState({ columns: 6, rows: 3, actors: {
    recruit: { name: 'Tester', team: 'crew', maxHealth: 300, health: 100, resources: { hunger: 0, salvage: 0 }, resourceCaps: { salvage: 99 }, abilities: familyPowerAbilities, statuses: recruitStatuses },
    enemy: { name: 'Foe', team: 'dungeon', maxHealth: 5000, health: 4000, stats, statuses: foeStatuses, abilities: [
      { id: 'enemyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }, ...traits.map(id => enemyTraits[id].ability)] }
  }, items: kit.map(([type, position], index) => ({ id: `${type}-${index}`, type, owner: 'recruit', position })) })
  let battle = state
  const trace = []
  for (let cycle = 0; cycle < cycles; cycle++) {
    const result = rules.resolveCycle(battle, { afterCycle: ['enemy'] })
    trace.push(...result.trace); battle = result.state
  }
  return { battle, trace }
}
const abilitySteps = (trace, id) => trace.filter(step => step.kind === 'ability' && step.ability.id.startsWith(id))
const total = (trace, id) => abilitySteps(trace, id).flatMap(step => step.effects).reduce((sum, effect) => sum + effect.amount, 0)
const poisonFor = stacks => ({ poison: { stacks, duration: 'combat', expires: null, source: null } })

test('Heavy Blow lands only on every 3rd cycle', () => {
  const { trace } = fight({ traits: ['heavyBlow'], cycles: 6 })
  assert.equal(abilitySteps(trace, 'heavyBlow').length, 2)
})

test('Plated grows a thick guard each cycle', () => {
  assert.ok(total(fight({ traits: ['plated'] }).trace, 'plating') >= 12)
})

test('Purifier washes Poison off itself', () => {
  const { trace } = fight({ traits: ['purifier'], foeStatuses: poisonFor(10) })
  assert.ok(total(trace, 'purify') >= 4)
})

test('Swarm strikes three extra blows each turn', () => {
  assert.equal(abilitySteps(fight({ traits: ['swarm'], cycles: 1 }).trace, 'swarmBites')[0].effects.length, 3)
})

test('Regrowth heals the foe at each cycle end', () => {
  assert.ok(total(fight({ traits: ['regrowth'] }).trace, 'regrowth') > 0)
})

test('Spiked hurts you each time you hit it', () => {
  const { trace } = fight({ traits: ['spiked'], kit: [['flail', [0, 0]]] })
  assert.ok(abilitySteps(trace, 'spikes').length >= 3)
})

const combatKit = count => [['dagger', [0, 0]], ['sword', [1, 0]], ['hammer', [2, 0]], ['buckler', [3, 0]], ['stone', [5, 0]]].slice(0, count)

test('Arms Drill: Combat at 3 items boosts weapon damage, at 5 boosts it twice, below 3 not at all', () => {
  assert.equal(abilitySteps(fight({ kit: combatKit(2), cycles: 1 }).trace, 'combatPower').length, 0)
  assert.equal(abilitySteps(fight({ kit: combatKit(3), cycles: 1 }).trace, 'combatPower3').length, 1)
  const five = abilitySteps(fight({ kit: combatKit(5), cycles: 1 }).trace, 'combatPower')
  assert.deepEqual(five.map(step => step.ability.id).sort(), ['combatPower3', 'combatPower5'])
})

test('Living Bark: Growth at 3 items turns heals into guard', () => {
  const growthKit = [['salve', [0, 0]], ['sprig', [1, 0]], ['venom', [2, 0]]]
  assert.ok(total(fight({ kit: growthKit }).trace, 'growthPower3') > 0)
  assert.equal(total(fight({ kit: growthKit.slice(0, 2) }).trace, 'growthPower'), 0)
})

test('Resonance: Scholarship at 3 items makes statuses on the foe deal damage', () => {
  const kit = [['moonAmulet', [0, 0]], ['echo', [1, 0]], ['salt', [2, 0]]]
  assert.ok(total(fight({ kit }).trace, 'scholarshipPower3') > 0)
})

test('Blood Frenzy: Hunger at 3 items only boosts weapons below half health', () => {
  const kit = [['warPick', [0, 0]], ['meatJoint', [1, 0]], ['ropeCoil', [2, 0]]]
  const hurt = fight({ kit, cycles: 1 })
  assert.equal(abilitySteps(hurt.trace, 'hungerPower3').length, 1)
  const healthy = fight({ kit, cycles: 1 })
  healthy.battle.actors.recruit.health = 300
  const full = rules.resolveCycle(healthy.battle, { afterCycle: ['enemy'] })
  assert.equal(abilitySteps(full.trace, 'hungerPower3').length, 0)
})

test('Lucky Haul: Scavenging at 3 items rolls Salvage every cycle', () => {
  const kit = [['pickaxe', [0, 0]], ['coinPurse', [1, 0]], ['lockpicks', [2, 0]]]
  assert.ok(fight({ kit, cycles: 2 }).battle.actors.recruit.resources.salvage > 0)
})
