/** Balance contracts check useful choices rather than freezing every tuning number. */
import assert from 'node:assert/strict'
import { defineSuite } from '../tools/node-suite.mjs'
import { supportMatrix } from '../tools/balance-bench.mjs'
import { campaignEnemy, campaignChoices, lootPartners } from '../plugins/bell/campaign-rules.js'
import { rules } from '../plugins/bell/rules.js'
import { labItems } from '../plugins/bell/catalog/lab.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
const { test, suite } = defineSuite('Campaign balance contracts')
export default suite

test('linked support trades burst speed for damage or survival; no single kit wins every probe', () => {
  const matrix = supportMatrix(), get = (name, threat) => matrix.find(row => row.name === name && row.threat === threat)
  assert.ok(get('storm', 'attrition').cycles < get('weapons', 'attrition').cycles)
  assert.ok(get('growth', 'attrition').health > get('weapons', 'attrition').health)
  assert.equal(get('weapons', 'burst').winner, 'crew')
  assert.equal(get('growth', 'burst').winner, 'enemy')
  assert.equal(get('curse', 'heavyArmour').winner, 'crew')
  assert.notEqual(get('weapons', 'heavyArmour').winner, 'crew')
  assert.equal(get('salvage', 'attrition').winner, 'crew')
  assert.ok(get('salvage', 'attrition').health > get('weapons', 'attrition').health)
})
test('unrefined dagger damages the warden and a long fight faces escalating pressure', () => {
  let state = rules.createState({ actors: { recruit: { team: 'crew', maxHealth: 100 }, enemy: campaignEnemy(8) }, items: [{ id: 'blade', type: 'dagger', owner: 'recruit', position: [1, 0] }] })
  const health = state.actors.enemy.health, damage = state.actors.enemy.stats.damage
  for (let cycle = 0; cycle < 3; cycle++) state = rules.resolveCycle(state, { afterCycle: ['enemy'] }).state
  assert.ok(state.actors.enemy.health < health)
  assert.ok(state.actors.enemy.modifiers.some(modifier => modifier.stat === 'damage' && modifier.amount > 0) || state.actors.enemy.stats.damage > damage)
})
test('repeat expedition choices are distinct, include an unowned kit partner, and reach the full catalog', () => {
  const random = seededRandom(7331), found = new Set()
  const journey = { battle: { items: { blade: { type: 'dagger' } } } }
  for (let sample = 0; sample < 1000; sample++) {
    const choices = campaignChoices(journey, rules.catalog, random)
    assert.equal(new Set(choices).size, 3)
    assert.ok(choices.some(type => lootPartners.dagger.includes(type)))
    choices.forEach(type => found.add(type))
  }
  assert.deepEqual([...found].sort(), Object.keys(rules.catalog.items).filter(type => !labItems[type]).sort())
})
