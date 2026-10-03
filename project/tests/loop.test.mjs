/** Dungeon progression tests cover real wins, losses and the economy between fights. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { createJourney, finishBattle, claim, searchCache, salvage, retryRoom, descend } from '../plugins/bell/loop.js'
const { test, suite } = defineSuite('Endless dungeon and rewards')
export default suite
const random = () => 0.25
function finish(journey) {
  for (let index = 0; index < 31 && journey.phase === 'battle'; index++) {
    journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
    finishBattle(journey, random)
  }
}
test('ordinary rooms grant salvage once; the fourth room earns the first item', () => {
  const journey = createJourney()
  for (let room = 1; room <= 3; room++) {
    finish(journey)
    assert.equal(journey.rewardKind, 'salvage')
    assert.deepEqual(journey.choices, [])
    assert.equal(claim(journey, 'venom'), false)
    assert.equal(finishBattle(journey, random), false)
    assert.equal(descend(journey), true)
    assert.equal(descend(journey), false)
    assert.equal(Object.keys(journey.battle.items).length, 1)
    assert.equal(journey.scrap, room)
  }
  finish(journey)
  assert.equal(journey.rewardKind, 'room')
  assert.deepEqual(journey.choices, ['venom', 'stormTotem', 'salve'])
  assert.equal(descend(journey), false)
  const id = claim(journey, 'venom')
  assert.equal(id, 'item-2')
  assert.equal(journey.room, 5)
  assert.equal(journey.scrap, 4)
  assert.equal(journey.battle.items[id].position, null)
  assert.equal(claim(journey, 'venom'), false)
})
test('room transitions reset combat state but retain storage, item identity and arrangement', () => {
  const journey = createJourney()
  rules.addItem(journey.battle, 'bag', 'pouch', 'recruit')
  rules.place(journey.battle, 'bag', [3, 0])
  rules.place(journey.battle, 'item-1', [3, 0])
  finish(journey)
  journey.battle.actors.recruit.resources.hunger = 3
  descend(journey)
  assert.equal(journey.battle.cycle, 1)
  assert.equal(journey.battle.grid.columns, 4)
  assert.deepEqual(journey.battle.items['item-1'].position, [3, 0])
  assert.deepEqual(journey.battle.items['item-1'].uses, {})
  assert.deepEqual(journey.battle.actors.recruit.statuses, {})
  assert.equal(journey.battle.actors.recruit.resources.hunger, 0)
})
test('cache choices cost scrap once, are unique and never advance the room or mint scrap', () => {
  const journey = createJourney()
  journey.scrap = 12
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
test('room depth never grants slots; room eight offers an earned storage choice', () => {
  const journey = createJourney()
  for (let room = 1; room <= 8; room++) {
    journey.battle.actors.enemy.health = 0
    assert.equal(finishBattle(journey, random), true)
    assert.equal(finishBattle(journey, random), false)
    if (room === 8) assert.deepEqual(journey.choices, ['pouch', 'pack', 'sword'])
    if (journey.rewardKind === 'salvage') descend(journey)
    else claim(journey, journey.choices[0])
    assert.equal(journey.battle.grid.columns, 3)
    assert.deepEqual(journey.battle.items['item-1'].position, [1, 0])
  }
  assert.equal(journey.room, 9)
  assert.equal(Object.keys(journey.battle.items).length, 3)
})
test('salvaging occupied storage is rejected without changing items, slots or scrap', () => {
  const journey = createJourney()
  rules.addItem(journey.battle, 'bag', 'pouch', 'recruit')
  rules.place(journey.battle, 'bag', [3, 0])
  rules.place(journey.battle, 'item-1', [3, 0])
  const before = structuredClone(journey.battle)
  assert.equal(salvage(journey, 'bag'), false)
  assert.deepEqual(journey.battle, before)
  assert.equal(journey.scrap, 0)
  rules.place(journey.battle, 'item-1', [1, 0])
  assert.equal(salvage(journey, 'bag'), true)
  assert.equal(journey.battle.grid.columns, 3)
})

test('every new family item can be obtained from an ordinary dungeon cache', () => {
  const pool = Object.keys(rules.catalog.items)
  for (const type of ['rootTotem', 'hammer', 'stormTotem', 'curseIdol', 'reapingSeal', 'salvagePack', 'patchKit']) {
    const journey = createJourney()
    journey.scrap = 12
    assert.ok(searchCache(journey, () => (['rootTotem', 'hammer', 'stormTotem', 'curseIdol', 'reapingSeal', 'salvagePack', 'patchKit'].indexOf(type) + 0.1) / 7))
    assert.ok(journey.choices.includes(type), type)
    const id = claim(journey, type)
    assert.equal(journey.battle.items[id].type, type)
  }
})
test('first dungeon item find offers an equipable Storm Totem with working Shock', () => {
  const journey = createJourney()
  for (let room = 1; room <= 4; room++) {
    finish(journey)
    if (room < 4) descend(journey)
  }
  assert.ok(journey.choices.includes('stormTotem'))
  const id = claim(journey, 'stormTotem')
  assert.ok(rules.place(journey.battle, id, [0, 0]))
  const result = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] })
  assert.ok(result.trace.some(step => step.kind === 'ability' && step.effects.some(effect => effect.type === 'applyStatus' && effect.status === 'shock' && effect.amount > 0)))
})

test('every later find and cache guarantees an unowned family item while choices stay unique', () => {
  const families = ['rootTotem', 'hammer', 'stormTotem', 'curseIdol', 'reapingSeal', 'salvagePack', 'patchKit']
  const journey = createJourney()
  for (let index = 0; index < families.length; index++) {
    const owned = new Set(Object.values(journey.battle.items).map(item => item.type))
    journey.scrap = 12
    assert.ok(searchCache(journey, () => 0))
    assert.equal(journey.choices.length, 3)
    assert.equal(new Set(journey.choices).size, 3)
    const featured = journey.choices[0]
    assert.ok(families.includes(featured))
    assert.ok(!owned.has(featured))
    claim(journey, featured)
  }
})
