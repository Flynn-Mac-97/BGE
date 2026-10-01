/** Dungeon progression tests cover real wins, losses and the economy between fights. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { createJourney, finishBattle, claim, searchCache, salvage, retryRoom } from '../plugins/bell/loop.js'
const { test, suite } = defineSuite('Endless dungeon and rewards')
export default suite
const random = () => 0.25
function finish(journey) {
  for (let index = 0; index < 31 && journey.phase === 'battle'; index++) {
    journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
    finishBattle(journey, random)
  }
}
test('the starter wins the first room and chooses one find with no duplicate claim exploit', () => {
  const journey = createJourney()
  finish(journey)
  assert.equal(journey.phase, 'reward')
  assert.equal(journey.battle.actors.recruit.health, 11)
  assert.deepEqual(journey.choices, ['venom', 'stone', 'salve'])
  assert.equal(claim(journey, 'sword'), false)
  const id = claim(journey, 'venom')
  assert.equal(id, 'item-2')
  assert.equal(journey.room, 2)
  assert.equal(journey.scrap, 1)
  assert.equal(journey.battle.actors.recruit.health, 12)
  assert.equal(journey.battle.items[id].position, null)
  assert.equal(claim(journey, 'venom'), false)
})
test('room transitions reset combat charges, statuses and Hunger, while preserving the arrangement', () => {
  const journey = createJourney()
  finish(journey); claim(journey, 'venom'); rules.place(journey.battle, 'item-2', [0, 0])
  finish(journey)
  journey.battle.actors.recruit.resources.hunger = 3
  claim(journey, journey.choices[0])
  assert.equal(journey.battle.cycle, 1)
  assert.deepEqual(journey.battle.items['item-2'].position, [0, 0])
  assert.deepEqual(journey.battle.items['item-2'].uses, {})
  assert.deepEqual(journey.battle.actors.recruit.statuses, {})
  assert.equal(journey.battle.actors.recruit.resources.hunger, 0)
})
test('cache choices cost scrap once, are unique and never advance the room or mint scrap', () => {
  const journey = createJourney()
  journey.scrap = 3
  assert.equal(searchCache(journey, random), true)
  assert.equal(journey.scrap, 0)
  assert.equal(new Set(journey.choices).size, 3)
  assert.equal(searchCache(journey, random), false)
  const id = claim(journey, journey.choices[0])
  assert.equal(journey.room, 1)
  assert.equal(journey.scrap, 0)
  assert.ok(journey.battle.items[id])
})
test('salvage respects phase locks and keeps the last weapon', () => {
  const journey = createJourney()
  assert.equal(salvage(journey, 'item-1'), false)
  rules.addItem(journey.battle, 'extra', 'salve', 'recruit')
  assert.equal(salvage(journey, 'extra'), true)
  assert.equal(journey.scrap, 1)
  assert.equal(salvage(journey, 'extra'), false)
  journey.battle.phase = 'resolving'
  assert.equal(searchCache(journey, random), false)
})
test('a weak build eventually loses; retry keeps the build and cannot create loot or free health', () => {
  const journey = createJourney()
  journey.room = 3
  journey.battle.actors.enemy.maxHealth = 80
  journey.battle.actors.enemy.health = 80
  journey.roomStartHealth = 7
  finish(journey)
  assert.equal(journey.phase, 'defeat')
  assert.equal(journey.cleared, 0)
  assert.equal(retryRoom(journey), true)
  assert.equal(journey.room, 3)
  assert.equal(journey.scrap, 0)
  assert.equal(journey.battle.actors.recruit.health, 7)
  assert.equal(Object.keys(journey.battle.items).length, 1)
  assert.equal(retryRoom(journey), false)
})
test('a non-attacking build terminates after thirty cycles instead of locking the prototype', () => {
  const journey = createJourney()
  rules.place(journey.battle, 'item-1', null)
  rules.addItem(journey.battle, 'healer', 'salve', 'recruit'); rules.place(journey.battle, 'healer', [0, 0])
  finish(journey)
  assert.equal(journey.phase, 'defeat')
  assert.match(journey.message, /stalled/)
})
test('depth rewards expand full-height columns at room four and seven without moving equipment', () => {
  const journey = createJourney()
  for (let room = 1; room <= 6; room++) {
    journey.battle.actors.enemy.health = 0
    assert.equal(finishBattle(journey, random), true)
    assert.equal(finishBattle(journey, random), false)
    claim(journey, journey.choices[0])
    assert.equal(journey.battle.grid.columns, room >= 6 ? 5 : room >= 3 ? 4 : 3)
    assert.deepEqual(journey.battle.items['item-1'].position, [1, 0])
  }
  assert.equal(journey.room, 7)
  assert.equal(journey.cleared, 6)
})
