/** The Forge and the Duel Pit: forged items cost Bells and work in fights; duels draft in turn, fight, and log how fun they were. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { forgeItem, forgeCost, forgeTargets, isForgeValid } from '../plugins/bell/descent/forge.js'
import { createProfile, profileStore } from '../plugins/bell/descent/profile-save.js'
import { createRun } from '../plugins/bell/descent/run.js'
import { createDuel, readyDraft, takeHandoff, finishDuel, canPlaceDraft, rateDuel, funByRule, fightAgain, redraft } from '../plugins/bell/duel/duel.js'
import { startingRules, nextRule } from '../plugins/bell/duel/duel-rules.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
const { test, suite } = defineSuite('Forge and Duel Pit')
export default suite

const shelfId = (journey, type) => Object.values(journey.battle.items).find(item => item.type === type).id

test('forging costs Bells, rejects parts that do not fit, and the item fights and saves', () => {
  const profile = createProfile()
  profile.bells = 30
  assert.equal(forgeItem(profile, { when: 'turn', do: 'poison', to: 'attacker', power: 'spark' }), null)
  assert.deepEqual(forgeTargets('hit', 'poison'), ['enemy', 'attacker'])
  const record = forgeItem(profile, { when: 'hit', do: 'poison', to: 'attacker', power: 'flame' })
  assert.equal(profile.bells, 30 - forgeCost(record))
  assert.ok(isForgeValid(record))
  const definition = rules.catalog.items[record.id]
  assert.equal(definition.stats.potency, 4)
  const run = createRun(profile, 'rook', seededRandom(1))
  assert.deepEqual(run.descent.forged, [record.id])
  const storage = new Map()
  const store = profileStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
  store.save(profile)
  assert.deepEqual(store.load().forged, profile.forged)
})

test('a duel drafts in turn with an item cap, fights, and logs a rating', () => {
  const random = seededRandom(4)
  const journey = createDuel({ ...startingRules(), items: 2 }, [], random)
  rules.place(journey.battle, shelfId(journey, 'dagger'), [1, 0])
  rules.place(journey.battle, shelfId(journey, 'venom'), [0, 0])
  assert.equal(canPlaceDraft(journey, shelfId(journey, 'sword')), false)
  assert.ok(readyDraft(journey))
  assert.equal(journey.duel.stage, 'handoff')
  assert.ok(takeHandoff(journey))
  rules.place(journey.battle, shelfId(journey, 'sword'), [1, 0])
  assert.ok(readyDraft(journey))
  assert.equal(journey.duel.stage, 'fight')
  assert.deepEqual(Object.values(journey.battle.items).map(item => item.owner).sort(), ['enemy', 'recruit', 'recruit'])
  for (let cycle = 0; cycle < 40 && journey.duel.stage === 'fight'; cycle++) {
    journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
    finishDuel(journey)
  }
  assert.equal(journey.duel.stage, 'result')
  const profile = createProfile()
  assert.ok(rateDuel(profile, journey, 3))
  assert.equal(rateDuel(profile, journey, 1), false)
  assert.equal(funByRule(profile.duels).find(entry => entry.rule === 'items').average, 3)
  assert.ok(fightAgain(journey))
  assert.equal(journey.duel.stage, 'fight')
  journey.duel.stage = 'result'
  assert.ok(redraft(journey))
  assert.ok(Object.values(journey.battle.items).some(item => item.type === 'dagger' && item.position))
})

test('sudden death ends a duel of two builds that cannot hurt each other', () => {
  const journey = createDuel({ ...startingRules(), suddenDeath: 6 }, [], seededRandom(2))
  rules.place(journey.battle, shelfId(journey, 'salve'), [0, 0])
  readyDraft(journey); takeHandoff(journey)
  rules.place(journey.battle, shelfId(journey, 'salve'), [0, 0])
  readyDraft(journey)
  for (let cycle = 0; cycle < 40 && journey.duel.stage === 'fight'; cycle++) {
    journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
    finishDuel(journey)
  }
  assert.equal(journey.duel.stage, 'result')
  assert.ok(journey.battle.cycle < 20)
})

test('rule cards cycle through their options', () => {
  let ruleSet = startingRules()
  assert.equal(ruleSet.items, 4)
  ruleSet = nextRule(ruleSet, 'items')
  assert.equal(ruleSet.items, 5)
  for (let step = 0; step < 3; step++) ruleSet = nextRule(ruleSet, 'items')
  assert.equal(ruleSet.items, 4)
})

test('the Lantern opens the Forge and the Duel Pit, and a duel plays through the panel from draft to rating', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const game = fixture({ hub: true })
  const actionsExist = () => { for (const [, action] of game.panel.html().matchAll(/data-action="([^"]+)"/g)) assert.equal(typeof game.panel.on[action], 'function', action) }
  game.panel.on.openForge()
  assert.match(game.panel.html(), /THE FORGE/)
  actionsExist()
  game.panel.on.forgePart('do:heal')
  assert.equal(game.read().forgeDraft.to, 'you')
  game.panel.on.hub()
  game.panel.on.openDuel()
  assert.match(game.panel.html(), /RULE CARDS/)
  actionsExist()
  game.panel.on.duelRule('items')
  assert.equal(game.read().duelRules.items, 5)
  game.panel.on.duelStart()
  const draft = player => {
    const battle = game.read().journey.battle
    const [first, second] = Object.keys(battle.items)
    for (const [id, cell] of [[first, 0], [second, 1]]) { game.panel.on.select(id); game.panel.on.cell(cell) }
    assert.equal(game.read().journey.duel.players[player].build.length, 0)
    assert.match(game.panel.html(), /2\/5 ON THE GRID/)
    actionsExist()
    game.panel.on.duelReady()
  }
  draft(0)
  assert.match(game.panel.html(), /PASS THE PHONE TO PLAYER 2/)
  game.panel.on.duelHandoff()
  draft(1)
  assert.equal(game.read().journey.duel.stage, 'fight')
  assert.match(game.panel.html(), /duel-board/)
  game.panel.on.fight()
  for (let tick = 0; tick < 2000 && game.read().journey.duel.stage === 'fight'; tick++) game.tick(1, 2)
  assert.equal(game.read().journey.duel.stage, 'result')
  assert.match(game.panel.html(), /HOW FUN WAS THAT/)
  game.panel.on.duelRate(3)
  assert.equal(game.read().profile.duels[0].fun, 3)
  game.panel.on.leaveDuel()
  assert.equal(game.read().screen, 'duelRules')
})
