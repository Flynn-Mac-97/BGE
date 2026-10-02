/** Readable hit presentation preserves combat results and identifies the actual source and victim. */
import assert from 'node:assert/strict'
import { defineSuite } from '../tools/node-suite.mjs'
import { damageFeedback, stageFeedback, stepDuration } from '../plugins/bell/feedback.js'
import { battleWith, cycle } from '../tools/rule-fixtures.mjs'
import { createRules } from '../plugins/grid-game/api.js'
import { fixture } from '../tools/ui-fixture.mjs'
const { test, suite } = defineSuite('Readable damage feedback')
export default suite

test('weapon and enemy hits identify their victim and actual before/after health', () => {
  const result = cycle(battleWith())
  const strike = result.trace.find(step => step.ability?.id === 'strike')
  const enemy = result.trace.find(step => step.ability?.id === 'attack')
  assert.deepEqual(damageFeedback(strike).map(hit => [hit.id, hit.amount, hit.before, hit.after, hit.source]), [['enemy', 2, 14, 12, 'Rusty Dagger']])
  assert.deepEqual(damageFeedback(enemy).map(hit => [hit.id, hit.amount, hit.before, hit.after]), [['recruit', 4, 12, 8]])
})
test('poison on the recruit is identified as Poison rather than a self attack', () => {
  const battle = battleWith()
  battle.actors.recruit.statuses.poison = { stacks: 2, duration: 'combat' }
  const poison = cycle(battle).trace.find(step => step.statusId === 'poison')
  const hit = damageFeedback(poison)[0]
  assert.equal(hit.source, 'Poison')
  assert.equal(hit.id, 'recruit')
  assert.equal(hit.amount, 2)
})
test('a fully blocked hit gets a hold and reports no health loss', () => {
  const result = cycle(battleWith({ dagger: [0, 0], buckler: [1, 0] }, { attack: 2 }))
  const step = result.trace.find(step => step.ability?.id === 'attack')
  assert.equal(damageFeedback(step)[0].amount, 0)
  assert.equal(damageFeedback(step)[0].blocked, 2)
  assert.match(stageFeedback({ step, serial: 1 }), /BLOCKED.*HP 12 → 12.*2 blocked/)
  assert.equal(stepDuration(step, 'normal'), 1.1)
})
test('damage holds for 1.1 seconds, remains pausable, then proceeds without changing rules', () => {
  const game = fixture()
  game.panel.on.auto(false); game.panel.on.fight(); game.tick(1, 0.23)
  assert.equal(game.read().step.ability.id, 'strike')
  assert.match(game.panel.html(), /Rusty Dagger → Cellar Rat/)
  assert.match(game.panel.html(), /−2 HP/)
  assert.match(game.panel.html(), /HP 4 → 2/)
  game.tick(1, 0.9)
  assert.equal(game.read().step.ability.id, 'strike')
  game.panel.on.pause(); const held = game.panel.html(); game.tick(1, 5)
  assert.equal(game.panel.html(), held)
  game.panel.on.pause(); game.tick(1, 0.21)
  assert.equal(game.read().step.ability.id, 'enemyAttack')
  assert.match(game.panel.html(), /Cellar Rat → Nameless Recruit/)
  game.tick(20)
  assert.equal(game.read().journey.battle.actors.recruit.health, 11)
  assert.equal(game.read().journey.battle.actors.enemy.health, 2)
})
test('Slow lengthens impact holds while non-damage bookkeeping retains its old pacing', () => {
  const step = cycle(battleWith()).trace.find(step => step.ability?.id === 'strike')
  assert.equal(stepDuration(step, 'slow'), 1.8)
  assert.equal(stepDuration({ kind: 'planning' }, 'normal'), 0.22)
})

test('a self-damaging item groups multiple hits and explains healing in the same action', () => {
  const rules = createRules({ items: { dagger: { name: 'Rusty Dagger', footprint: [1, 2], abilities: [{ id: 'curse', trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'damage', amount: 2 }, { type: 'damage', amount: 1 }, { type: 'heal', amount: 1 }] }] } } })
  const battle = rules.createState({ actors: { recruit: { name: 'Recruit', team: 'crew', maxHealth: 12 } }, items: [{ id: 'charm', type: 'dagger', owner: 'recruit', position: [0, 0] }] })
  const step = rules.resolveCycle(battle).trace.find(step => step.kind === 'ability')
  const hits = damageFeedback(step)
  assert.equal(hits.length, 1)
  assert.deepEqual([hits[0].id, hits[0].amount, hits[0].before, hits[0].after, hits[0].healed], ['recruit', 3, 12, 10, 1])
  assert.match(stageFeedback({ step, serial: 1 }), /Rusty Dagger → Recruit.*−3 HP.*HP 12 → 10.*\+1 healed/)
})
