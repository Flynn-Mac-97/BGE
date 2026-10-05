/** Every family has a playable kit, visible effect feedback and a reversible practice session. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { familyKits, createFamilyJourney, resetPractice } from '../plugins/bell/family-lab.js'
import { rules } from '../plugins/bell/rules.js'
import { finishBattle } from '../plugins/bell/loop.js'
import { describeStep } from '../plugins/bell/feedback.js'
import { fixture } from '../tools/ui-fixture.mjs'
const { test, suite } = defineSuite('Family item laboratory')
export default suite
for (const family of Object.keys(familyKits)) test(family + ' kit plays full cycles and defeats its practice dummy', () => {
  const journey = createFamilyJourney(family), events = []
  assert.equal(Object.keys(journey.battle.items).length, Object.keys(rules.catalog.items).length)
  let cycles = 0
  while (!rules.winner(journey.battle) && cycles++ < 30) {
    const result = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] })
    for (const step of result.trace) { assert.equal(typeof describeStep(step), 'string'); events.push(step) }
    journey.battle = result.state
  }
  assert.equal(rules.winner(journey.battle), 'crew')
  const expected = { growth: 'rootMend', combat: 'breakArmour', scholarship: 'shockTick', hunger: 'reapCurse', scavenging: 'patchGuard', thorn: 'thornLash' }[family]
  assert.ok(events.some(step => step.kind === 'ability' && step.ability.id.includes(expected) && step.effects.some(effect => effect.amount > 0)), expected)
  assert.ok(finishBattle(journey, () => 0))
  assert.equal(journey.phase, 'practiceComplete')
  assert.equal(journey.scrap, 0)
  const positions = Object.values(journey.battle.items).map(item => item.position)
  resetPractice(journey)
  assert.deepEqual(Object.values(journey.battle.items).map(item => item.position), positions)
  assert.equal(journey.battle.actors.enemy.health, 60)
  assert.equal(journey.battle.actors.recruit.resources.salvage, 0)
})
test('touch flow enters, mixes, resets and returns to the untouched dungeon', () => {
  const game = fixture(), before = game.read().journey
  game.panel.on.family('scholarship')
  assert.equal(game.read().auto, false)
  assert.match(game.panel.html(), /LAB · Scholarship/)
  game.panel.on.select('lab-stormTotem'); game.panel.on.details()
  assert.match(game.panel.html(), /Grants shockHit/)
  game.panel.on.deselect(); game.panel.on.select('lab-rootTotem'); game.panel.on.cell(10)
  assert.deepEqual(game.read().journey.battle.items['lab-rootTotem'].position, [0, 2])
  game.panel.on.fight(); game.tick(10)
  game.panel.on.practiceReset()
  assert.equal(game.read().queue.length, 0)
  assert.deepEqual(game.read().journey.battle.items['lab-rootTotem'].position, [0, 2])
  game.panel.on.select('lab-rootTotem'); game.panel.on.salvage()
  assert.ok(game.read().journey.battle.items['lab-rootTotem'])
  game.panel.on.leaveLab()
  assert.deepEqual(game.read().journey, before)
  assert.equal(game.read().auto, true)
})
test('entering practice cannot discard a pending dungeon combat', () => {
  const game = fixture()
  game.panel.on.fight()
  const before = game.read()
  game.panel.on.family('growth')
  assert.deepEqual(game.read(), before)
})
test('Thorn Warden reacts only to hits on its owner, and Sapped lowers the next hit', () => {
  let battle = createFamilyJourney('thorn').battle
  // The kit holds seven Growth items, so its family power would turn heals into guard and block the dummy; this test is about the thorns.
  battle.actors.recruit.abilities = []
  const fired = []
  for (let cycle = 0; cycle < 3; cycle++) {
    const result = rules.resolveCycle(battle, { afterCycle: ['enemy'] })
    fired.push(...result.trace.filter(step => step.kind === 'ability'))
    battle = result.state
  }
  const hits = fired.filter(step => step.ability.id === 'dummyAttack')
  assert.equal(fired.filter(step => step.ability.id === 'thornLash').length, hits.length)
  assert.deepEqual(hits.map(step => step.effects[0].amount), [2, 1, 1])
})
test('the grid shows live item effects and labelled edge links without selecting anything', () => {
  const game = fixture()
  game.panel.on.family('thorn')
  const html = game.panel.html()
  // The Spore Idol raises the Totem from 2 to 3 potency, so its label is live and marked boosted.
  assert.match(html, /glance-line boosted"><span class="glance-trigger">HIT<\/span> 3 PSN/)
  assert.match(html, /glance-trigger">HIT<\/span> −1 DMG/)
  assert.match(html, /edge-badge edge-right link-target">\+2 POT ▶/)
  assert.match(html, /edge-badge edge-down link-aura">\+1 POT ▼/)
})
