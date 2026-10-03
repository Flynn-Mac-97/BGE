/** Persistent crew progression banks once, survives reloads and preserves departure gear on defeat. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { createCompany, hire, embark, returnToTavern, rest, learn, refine } from '../plugins/bell/campaign.js'
import { companyStore, companySaveKey } from '../plugins/bell/company-save.js'
import { rules } from '../plugins/bell/rules.js'
import { finishBattle, descend, claim } from '../plugins/bell/loop.js'
import { fixture } from '../tools/ui-fixture.mjs'
const { test, suite } = defineSuite('Persistent tavern campaign')
export default suite
const memory = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } }
function win(journey) {
  for (let count = 0; count < 31 && journey.phase === 'battle'; count++) {
    journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
    finishBattle(journey, () => 0.25)
  }
  assert.equal(journey.phase, 'reward')
}
function fourth(company) {
  hire(company, 'rook'); const journey = embark(company, 'rook')
  for (let room = 1; room <= 4; room++) { win(journey); if (room < 4) descend(journey) }
  claim(journey, 'venom'); rules.place(journey.battle, 'item-2', [0, 0])
  return journey
}
test('first visit offers three applicants, affordable first hire and narrative next step', () => {
  const game = fixture({ tavern: true, storage: memory() })
  assert.match(game.panel.html(), /THE LAST LANTERN/)
  assert.equal(game.read().screen, 'tavern')
  game.panel.on.hire('rook'); game.panel.on.hire('rook')
  assert.equal(game.read().company.coins, 0)
  assert.equal(Object.keys(game.read().company.roster).length, 1)
  game.panel.on.embark('rook')
  assert.equal(game.read().screen, 'expedition')
  assert.match(game.read().journey.message, /warden waits on floor 8/)
})
test('safe return banks personal kit, experience, coin and recruit unlock only once', () => {
  const company = createCompany(), journey = fourth(company)
  assert.ok(returnToTavern(company, journey))
  assert.equal(company.coins, 4)
  assert.equal(company.roster.rook.experience, 4)
  assert.equal(company.roster.rook.kit.length, 2)
  assert.equal(company.bestDepth, 4)
  assert.equal(returnToTavern(company, journey), false)
  assert.ok(hire(company, 'toll'))
  assert.equal(hire(company, 'moss'), false)
})
test('trait and item refinement persist through room transitions and save reload', () => {
  let company = createCompany(); const first = fourth(company); returnToTavern(company, first)
  assert.ok(learn(company, 'rook', 'brace'))
  assert.equal(learn(company, 'rook', 'mend'), false)
  assert.ok(refine(company, 'rook', 'item-1'))
  assert.equal(refine(company, 'rook', 'item-1'), false)
  const store = companyStore(memory()); store.save(company); company = store.load()
  const journey = embark(company, 'rook')
  assert.equal(journey.battle.items['item-1'].stats.damage, 3)
  win(journey); descend(journey)
  assert.equal(journey.battle.items['item-1'].stats.damage, 3)
  assert.equal(journey.battle.actors.recruit.abilities[0].id, 'crewBrace')
})
test('defeat loses unbanked finds, retains original gear and never causes an unaffordable recovery', () => {
  const company = createCompany(); hire(company, 'rook'); const journey = embark(company, 'rook')
  rules.addItem(journey.battle, 'item-2', 'stormTotem', 'recruit')
  journey.scrap = 10; journey.battle.actors.recruit.health = 0; finishBattle(journey, () => 0)
  assert.ok(returnToTavern(company, journey))
  assert.equal(company.roster.rook.kit.length, 1)
  assert.equal(company.coins, 0)
  assert.equal(company.roster.rook.injuries, 1)
  assert.equal(embark(company, 'rook'), null)
  assert.ok(rest(company, 'rook'))
  assert.ok(embark(company, 'rook'))
})
test('warden ends an eight-room expedition and its keepsake can be banked', () => {
  const company = createCompany(), journey = fourth(company)
  for (let room = 5; room <= 8; room++) {
    if (room === 8) assert.equal(journey.battle.actors.enemy.name, 'Cellar Warden')
    win(journey); if (room < 8) descend(journey)
  }
  assert.ok(claim(journey, 'pack'))
  assert.equal(journey.phase, 'expeditionComplete')
  assert.equal(descend(journey), false)
  assert.ok(returnToTavern(company, journey))
  assert.equal(company.bestDepth, 8)
  assert.equal(company.roster.rook.kit.length, 3)
  assert.ok(hire(company, 'moss'))
})
test('storage restores stable expedition; interrupted animation replays from last safe boundary', () => {
  const storage = memory(), game = fixture({ tavern: true, storage })
  game.panel.on.hire('pip'); game.panel.on.embark('pip')
  const stored = storage.getItem(companySaveKey)
  game.panel.on.fight()
  assert.equal(storage.getItem(companySaveKey), stored)
  const reopened = fixture({ tavern: true, storage })
  assert.equal(reopened.read().screen, 'expedition')
  assert.equal(reopened.read().journey.battle.phase, 'planning')
  assert.equal(reopened.read().journey.expedition.recruit, 'pip')
  reopened.panel.on.family('growth'); reopened.panel.on.leaveLab()
  assert.equal(reopened.read().journey.expedition.recruit, 'pip')
})
test('invalid saves remain untouched and storage failures are visible', () => {
  const storage = memory(); storage.setItem(companySaveKey, '{invalid')
  const store = companyStore(storage); store.load()
  assert.equal(store.save(createCompany()), false)
  assert.equal(storage.getItem(companySaveKey), '{invalid')
  assert.match(store.warning(), /preserved/)
  const blocked = companyStore({ getItem: () => null, setItem: () => { throw new Error('quota') } })
  blocked.save(createCompany()); assert.match(blocked.warning(), /session/)
})
