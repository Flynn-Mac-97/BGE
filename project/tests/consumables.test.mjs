/** Consumables act once at the next cycle start after a tap, spend a charge, and refill at a chest; tome cards stack for the run. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { createRun, readyItem, armReadied, chargesLeft, finishFloor, battleFor, maxHealthOf, levelStat, chooseCard, drawCards } from '../plugins/bell/descent/run.js'
import { createProfile } from '../plugins/bell/descent/profile-save.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
const { test, suite } = defineSuite('Consumables and tomes')
export default suite

/** A Rook run with one consumable placed at [3, 2]. */
function runWith(type) {
  const journey = createRun(createProfile(), 'rook', seededRandom(4))
  journey.descent.items['item-9'] = { type, level: 1, position: [3, 2] }
  journey.battle = battleFor(journey.descent)
  return journey
}
const cycle = journey => {
  armReadied(journey)
  const result = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] })
  journey.battle = result.state
  return result.trace
}
const fired = (trace, ability) => trace.filter(step => step.kind === 'ability' && step.source.id === 'item-9').length

test('a tapped draught heals once at the next cycle start and spends its only charge', () => {
  const journey = runWith('mendingDraught')
  assert.equal(fired(cycle(journey)), 0)
  journey.battle.actors.recruit.health = 5
  assert.ok(readyItem(journey, 'item-9'))
  assert.equal(readyItem(journey, 'item-9'), false)
  assert.match(journey.descent.log.at(-1), /^Tapped Mending Draught in cycle 2 at HP 5\//)
  const trace = cycle(journey)
  assert.equal(fired(trace), 1)
  assert.ok(journey.battle.actors.recruit.health > 5)
  assert.equal(chargesLeft(journey.descent.items['item-9']), 0)
  assert.equal(readyItem(journey, 'item-9'), false)
  assert.equal(fired(cycle(journey)), 0)
})

test('rot bloom turns all the foe\'s poison into damage at once', () => {
  const journey = runWith('rotBloom')
  journey.battle.actors.enemy.statuses.poison = { stacks: 7, duration: 'combat' }
  journey.battle.actors.enemy.health = journey.battle.actors.enemy.maxHealth = 200
  readyItem(journey, 'item-9')
  const step = cycle(journey).find(step => step.kind === 'ability' && step.source.id === 'item-9')
  assert.deepEqual(step.effects.filter(effect => effect.type === 'damage').map(effect => effect.amount), [7, 3])
  assert.equal(step.state.actors.enemy.statuses.poison, undefined)
})

test('a tap the floor never used comes back, and a chest refills every charge', () => {
  const journey = runWith('brambleWard')
  readyItem(journey, 'item-9')
  journey.battle.actors.enemy.health = 0
  finishFloor(journey, seededRandom(1))
  assert.equal(chargesLeft(journey.descent.items['item-9']), 2)
  journey.descent.items['item-9'].used = 2
  journey.descent.floor = 5
  journey.descent.enemy = { name: 'Test Brute', mark: 't', health: 1, damage: 1, kind: 'elite', line: '' }
  journey.battle = battleFor(journey.descent)
  journey.phase = 'battle'
  journey.battle.actors.enemy.health = 0
  finishFloor(journey, seededRandom(1))
  assert.equal(chargesLeft(journey.descent.items['item-9']), 2)
})

test('a tome card stacks for the run: Vigor adds max health, Might adds to every number on all gear', () => {
  const random = seededRandom(2)
  const journey = createRun(createProfile(), 'rook', random)
  const run = journey.descent
  const health = maxHealthOf(run)
  for (const id of ['vigor', 'might', 'might']) {
    journey.phase = 'levelUp'; run.pendingLevels = 1; run.cards = [{ kind: 'tome', id }]
    assert.ok(chooseCard(journey, 0, random))
  }
  assert.deepEqual(run.tomes, { vigor: 1, might: 2 })
  assert.equal(maxHealthOf(run), health + 3 * 2 + 6)
  const battle = battleFor(run)
  assert.equal(battle.items['item-1'].stats.damage, levelStat(rules.catalog.items.dagger.stats.damage, 1) + 2)
  assert.equal(battle.items['item-1'].stats.poisonOnHit ?? 0, 0)
  for (let draw = 0; draw < 40; draw++) assert.ok(drawCards(run, random).filter(card => card.kind === 'tome').length <= 1)
})

test('through the panel: tap a draught while the fight plays', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const profile = createProfile()
  profile.journey = runWith('mendingDraught')
  const storage = new Map([['black-bell-descent-v1', JSON.stringify(profile)]])
  const game = fixture({ hub: true, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })
  game.panel.on.continueRun()
  game.panel.on.fight()
  game.panel.on.select('item-9')
  assert.match(game.panel.html(), /Use · 1 left/)
  for (const [, action] of game.panel.html().matchAll(/data-action="([^"]+)"/g)) assert.equal(typeof game.panel.on[action], 'function', action)
  game.panel.on.useItem('item-9')
  assert.match(game.panel.html(), /Readied · next cycle/)
  for (let tick = 0; tick < 400 && game.read().journey.descent.items['item-9'].readied; tick++) game.tick(1, 0.5)
  assert.equal(game.read().journey.descent.items['item-9'].used, 1)
})
