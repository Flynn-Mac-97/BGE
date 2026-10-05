/** The Descent: levels scale stats, cards apply once, evolution needs its partner touching, and a death banks Bells once. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { createRun, finishFloor, collectChest, chooseCard, rerollCards, readyEvolutions, battleFor, levelStat, abandonRun, drawCards } from '../plugins/bell/descent/run.js'
import { createProfile, profileStore, settleRun, buyUpgrade, unlockedCrew } from '../plugins/bell/descent/profile-save.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
const { test, suite } = defineSuite('The Descent')
export default suite

/** Resolve cycles until the floor is decided. */
function fightFloor(journey, random) {
  while (journey.phase === 'battle') {
    journey.battle = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).state
    finishFloor(journey, random)
  }
}

test('item stats grow with level and the battle uses them', () => {
  const journey = createRun(createProfile(), 'rook', seededRandom(1))
  journey.descent.items['item-1'].level = 4
  const battle = battleFor(journey.descent)
  assert.equal(battle.items['item-1'].stats.damage, levelStat(2, 4))
  assert.equal(levelStat(2, 4), 8)
  assert.deepEqual(battle.items['item-1'].position, [1, 0])
})

test('a won floor gives Embers and Bells, and a level-up card applies once', () => {
  const random = seededRandom(3)
  const journey = createRun(createProfile(), 'rook', random)
  fightFloor(journey, random)
  assert.equal(journey.phase, 'levelUp')
  assert.equal(journey.descent.bells, 1)
  assert.equal(journey.descent.cards.length, 3)
  const before = structuredClone(journey.descent)
  const card = journey.descent.cards[0]
  assert.ok(chooseCard(journey, 0, random))
  assert.equal(journey.descent.level, before.level + 1)
  if (card.kind === 'level') assert.equal(journey.descent.items[card.id].level, before.items[card.id].level + 1)
  assert.equal(chooseCard(journey, 0, random), journey.phase === 'levelUp')
})

test('rerolls are limited and new item cards never repeat an owned type', () => {
  const random = seededRandom(5)
  const journey = createRun(createProfile(), 'pip', random)
  fightFloor(journey, random)
  const rerolls = journey.descent.rerolls
  for (let index = 0; index < rerolls; index++) assert.ok(rerollCards(journey, random))
  assert.equal(rerollCards(journey, random), false)
  for (let draw = 0; draw < 50; draw++) {
    const owned = new Set(Object.values(journey.descent.items).map(item => item.type))
    assert.ok(drawCards(journey.descent, random).every(card => card.kind !== 'item' || !owned.has(card.type)))
  }
})

test('an evolution needs its level and its partner touching on the grid', () => {
  const random = seededRandom(7)
  const journey = createRun(createProfile(), 'pip', random)
  journey.descent.items['item-1'].level = 5
  journey.battle = battleFor(journey.descent)
  assert.deepEqual(readyEvolutions(journey).map(ready => ready.into), ['widowFang'])
  rules.place(journey.battle, 'item-2', [3, 2])
  assert.deepEqual(readyEvolutions(journey), [])
  rules.place(journey.battle, 'item-2', [0, 0])
  journey.descent.floor = 5
  journey.descent.enemy = { name: 'Test Brute', mark: 't', health: 1, damage: 1, kind: 'elite', line: '' }
  journey.battle = battleFor(journey.descent)
  fightFloor(journey, random)
  assert.equal(journey.phase, 'chest')
  assert.equal(journey.descent.chest.kind, 'evolution')
  assert.equal(journey.descent.items['item-1'].type, 'widowFang')
  collectChest(journey, random)
  assert.notEqual(journey.phase, 'chest')
})

test('a death banks Bells and best floor once, and the profile survives a save', () => {
  const profile = createProfile()
  const random = seededRandom(9)
  const journey = createRun(profile, 'rook', random)
  fightFloor(journey, random)
  while (journey.phase === 'levelUp') chooseCard(journey, 0, random)
  assert.ok(abandonRun(journey))
  assert.equal(settleRun(profile, journey), journey.descent.bells)
  assert.equal(settleRun(profile, journey), 0)
  assert.equal(profile.bestFloor, 2)
  profile.bells = 40
  assert.ok(buyUpgrade(profile, 'vigor'))
  assert.equal(profile.tower.vigor, 1)
  const storage = new Map()
  const store = profileStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })
  profile.journey = createRun(profile, 'nettle', random)
  assert.ok(store.save(profile))
  assert.deepEqual(store.load(), profile)
  assert.equal(profile.journey.battle.actors.recruit.maxHealth, 29)
  assert.deepEqual(unlockedCrew(profile), ['rook', 'nettle', 'pip'])
})

test('a seeded bot run reaches the first elite and every floor stays decidable', () => {
  const random = seededRandom(2)
  const journey = createRun(createProfile(), 'pip', random)
  for (let guard = 0; guard < 2000 && journey.phase !== 'dead' && journey.descent.floor <= 6; guard++) {
    if (journey.phase === 'battle') fightFloor(journey, random)
    else if (journey.phase === 'chest') collectChest(journey, random)
    else chooseCard(journey, 0, random)
  }
  assert.ok(journey.descent.floor > 5, journey.message)
})

test('the Lantern hub starts a run, a card is taken through the panel, and giving up banks Bells for the tower', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const storage = new Map()
  const game = fixture({ hub: true, storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })
  assert.equal(game.read().screen, 'hub')
  assert.match(game.panel.html(), /THE BELL TOWER/)
  // Every hub button must name an action the plugin has.
  for (const [, action] of game.panel.html().matchAll(/data-action="([^"]+)"/g)) assert.equal(typeof game.panel.on[action], 'function', action)
  game.panel.on.goDown('rook')
  assert.equal(game.read().screen, 'expedition')
  assert.match(game.panel.html(), /THE DESCENT · THE CELLARS · <\/span>FLOOR 1/)
  game.panel.on.fight()
  for (let tick = 0; tick < 200 && game.read().journey.phase === 'battle'; tick++) game.tick(1, 2)
  assert.equal(game.read().journey.phase, 'levelUp')
  assert.match(game.panel.html(), /ROOK GREW TO LEVEL 2! · CHOOSE ONE/)
  game.panel.on.card(0)
  assert.equal(game.read().journey.descent.level, 2)
  game.panel.on.menu(); game.panel.on.abandon()
  assert.match(game.panel.html(), /THE LANTERN GOES OUT/)
  game.panel.on.lantern()
  const profile = game.read().profile
  assert.equal(game.read().screen, 'hub')
  assert.equal(profile.bells, 1)
  assert.equal(profile.journey, null)
  assert.equal(JSON.parse(storage.get('black-bell-descent-v1')).bells, 1)
})

test('the battle box narrates hits, poison and statuses, and skips stack bookkeeping', async () => {
  const { battleLine } = await import('../plugins/bell/descent/battle-stage.js')
  const random = seededRandom(2)
  const journey = createRun(createProfile(), 'pip', random)
  const lines = []
  for (let cycle = 0; cycle < 3 && journey.phase === 'battle'; cycle++) {
    const result = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] })
    lines.push(...result.trace.map(battleLine).filter(Boolean))
    journey.battle = result.state
    finishFloor(journey, random)
  }
  assert.ok(lines.some(line => /^Rusty Dagger hits .+ for \d+!/.test(line)), lines.join('\n'))
  assert.ok(lines.every(line => !line.includes('→')), lines.join('\n'))
})

test('a won floor shows the faint line before the reward screen covers the stage', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const game = fixture({ hub: true })
  game.panel.on.goDown('rook')
  game.panel.on.fight()
  let sawFaint = false
  for (let tick = 0; tick < 400 && game.read().journey.phase === 'battle'; tick++) {
    game.tick(1, 0.05)
    if (game.read().step?.kind === 'combatEnd') {
      sawFaint = true
      assert.equal(game.read().journey.phase, 'battle')
      assert.match(game.panel.html(), /fainted!/)
    }
  }
  assert.ok(sawFaint)
  assert.equal(game.read().journey.phase, 'levelUp')
})

test('portrait frames keep one key through a whole floor, so their entrance never replays mid-fight', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const game = fixture({ hub: true })
  game.panel.on.goDown('rook')
  game.panel.on.fight()
  const keys = new Set()
  for (let tick = 0; tick < 400 && game.read().journey.phase === 'battle'; tick++) {
    game.tick(1, 0.05)
    const html = game.panel.html()
    assert.doesNotMatch(html, /class="battle-field[^"]*" data-key/)
    for (const [, key] of html.matchAll(/data-key="((?:enemy|recruit)-frame:\d+)"/g)) keys.add(key)
  }
  assert.deepEqual([...keys].sort(), ['enemy-frame:1', 'recruit-frame:1'])
})

test('every effect a pool item can make has a battle box sentence, not an arrow', async () => {
  const { battleLine } = await import('../plugins/bell/descent/battle-stage.js')
  const { descentPool } = await import('../plugins/bell/descent/pool.js')
  for (const type of descentPool) {
    const random = seededRandom(3)
    const journey = createRun(createProfile(), 'rook', random)
    journey.descent.items['item-3'] = { type, level: 3, position: null }
    journey.battle = battleFor(journey.descent)
    for (const item of Object.values(journey.battle.items)) if (!item.position) for (let y = 0; y < 3 && !item.position; y++) for (let x = 0; x < 4 && !item.position; x++) rules.place(journey.battle, item.id, [x, y])
    const trace = rules.resolveCycle(journey.battle, { afterCycle: ['enemy'] }).trace
    for (const line of trace.map(battleLine)) assert.ok(!line.includes('→'), `${type}: ${line}`)
  }
})

test('a banked run goes into the play log with its build and each floor fought', async () => {
  const { playLogText } = await import('../plugins/bell/descent/play-log.js')
  const profile = createProfile()
  const random = seededRandom(9)
  const journey = createRun(profile, 'rook', random)
  fightFloor(journey, random)
  while (journey.phase === 'levelUp') chooseCard(journey, 0, random)
  abandonRun(journey)
  settleRun(profile, journey)
  assert.equal(profile.history.length, 1)
  const text = playLogText(profile)
  assert.match(text, /RUN 1: Rook · floor 2/)
  assert.match(text, /\[Floor 1 normal · .+\] \d+ cycles/)
  assert.match(text, /Build: Rusty Dagger L\d @/)
})

test('a level-3 item names what its evolution still needs, and consumables keep turning up in draws', async () => {
  const { evolutionHints } = await import('../plugins/bell/descent/view.js')
  const random = seededRandom(7)
  const journey = createRun(createProfile(), 'pip', random)
  const hint = () => evolutionHints(journey)[0]?.text
  assert.equal(hint(), undefined)
  journey.descent.items['item-1'].level = 3
  journey.battle = battleFor(journey.descent)
  assert.equal(hint(), "Rusty Dagger L3 → Widow's Fang: reach L5.")
  rules.place(journey.battle, 'item-2', [3, 2])
  assert.equal(hint(), "Rusty Dagger L3 → Widow's Fang: touch Venom Vial.")
  delete journey.descent.items['item-2']
  journey.battle = battleFor(journey.descent)
  assert.equal(hint(), "Rusty Dagger L3 → Widow's Fang: find Venom Vial.")
  const { consumablePool } = await import('../plugins/bell/descent/pool.js')
  let draws = 0
  for (let draw = 0; draw < 200; draw++) if (drawCards(journey.descent, random).some(card => consumablePool.includes(card.type))) draws++
  assert.ok(draws > 60, `consumables in ${draws} of 200 draws`)
})

test('a draw holds at most two level cards and ends with something new while new things are left', () => {
  const random = seededRandom(11)
  const journey = createRun(createProfile(), 'pip', random)
  for (const type of ['sword', 'hammer', 'buckler', 'salve']) journey.descent.items[`extra-${type}`] = { type, level: 1, position: null }
  for (let draw = 0; draw < 300; draw++) {
    const cards = drawCards(journey.descent, random)
    assert.ok(cards.filter(card => card.kind === 'level').length <= 2)
    assert.ok(cards.some(card => ['item', 'tome'].includes(card.kind)), JSON.stringify(cards))
  }
})

test('every Descent item shows its power family on the grid, the tooltip and the level-up cards', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const { familyOf } = await import('../plugins/bell/power-families.js')
  const { descentPool } = await import('../plugins/bell/descent/pool.js')
  assert.ok(descentPool.filter(type => !rules.catalog.items[type].tags.includes('consumable')).every(type => familyOf(rules.catalog.items[type])), 'each pool item that is not a consumable names a family')
  const game = fixture({ hub: true })
  game.panel.on.goDown('rook')
  assert.match(game.panel.html(), /class="equipment-shape[^>]*>(?:<span class="scan-marker"[^<]*<\/span>)?<span class="family-emblem" title="Combat family">/)
  game.panel.on.select(Object.keys(game.read().journey.battle.items)[0])
  assert.match(game.panel.html(), /<strong>[^<]+<span class="family-emblem" title="Combat family">/)
  game.panel.on.fight()
  for (let tick = 0; tick < 600 && game.read().journey.phase === 'battle'; tick++) game.tick(1, 0.05)
  assert.equal(game.read().journey.phase, 'levelUp')
  assert.ok((game.panel.html().match(/<\/span><\/strong>/g) ?? []).length >= 1, 'a level-up card shows the family emblem by its name')
})
