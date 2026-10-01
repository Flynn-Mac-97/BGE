/** Tooltips show actual rule state and derive links without item-specific cases. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { inspectItem, itemLinks } from '../plugins/bell/inspection.js'
import { battleWith, cycle } from '../tools/rule-fixtures.mjs'
const { test, suite } = defineSuite('Data-driven item inspection')
export default suite

test('planning distinguishes possible grid links from applied bonuses', () => {
  const battle = battleWith({ venom: [0, 0], dagger: [1, 0], tooth: [2, 0] })
  const reading = inspectItem(battle, 'dagger')
  assert.equal(reading.damage, 2)
  assert.equal(reading.poison, 0)
  assert.deepEqual(reading.bonuses, [])
  assert.deepEqual(reading.links.map(link => link.id).sort(), ['tooth', 'venom'])
})
test('prepared coating is visible before the strike and consumed afterwards', () => {
  const result = cycle(battleWith({ venom: [0, 0], dagger: [1, 0] }))
  const prepared = result.trace.find(step => step.ability?.id === 'coat')
  const strike = result.trace.find(step => step.ability?.id === 'strike')
  assert.equal(inspectItem(prepared.state, 'dagger').poison, 2)
  assert.equal(inspectItem(strike.state, 'dagger').poison, 0)
  assert.equal(inspectItem(strike.state, 'dagger').status, 'Already acted')
})
test('auras link through their data and increase the visible damage', () => {
  const battle = battleWith({ banner: [0, 0], dagger: [1, 0] })
  assert.deepEqual(itemLinks(battle, 'dagger').map(link => link.id), ['banner'])
  assert.equal(inspectItem(battle, 'dagger').damage, 3)
})
test('combat-limited effects report remaining uses after an activation', () => {
  const result = cycle(battleWith({ echo: [1, 0], dagger: [1, 1] }))
  assert.match(inspectItem(result.state, 'echo').abilities.join(''), /0 use\(s\) left/)
})
