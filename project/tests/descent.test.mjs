/** The Descent: levels scale stats, cards apply once, evolution needs its partner touching, and a death banks Bells once. */
import { defineSuite } from '../tools/node-suite.mjs'
import assert from 'node:assert/strict'
import { rules } from '../plugins/bell/rules.js'
import { peddlerStock } from '../plugins/bell/descent/peddler.js'
import { completesOwned, createRun, finishFloor, collectChest, chooseCard, rerollCards, readyEvolutions, battleFor, levelStat, abandonRun, drawCards, trainItem, buyFromPeddler, sellToPeddler, leavePeddler } from '../plugins/bell/descent/run.js'
import { createProfile, profileStore, settleRun, buyUpgrade, unlockedCrew } from '../plugins/bell/descent/profile-save.js'
import { seededRandom } from '../plugins/npc-lab/combo-space.js'
const { test, suite } = defineSuite('The Descent')
export default suite

/** Take a level-up card, then put its free training level on the first item. */
function takeCard(journey, index, random) {
  chooseCard(journey, index, random)
  if (journey.phase === 'train') trainItem(journey, Object.keys(journey.descent.items)[0], random)
}

/** A fresh run holding the dagger and Venom Vial, Widow's Fang's recipe: the dagger is item-1, the vial item-2. */
function daggerAndVenomRun(random) {
  const journey = createRun(createProfile(), 'rook', random)
  journey.descent.items = { 'item-1': { type: 'dagger', level: 1, position: [1, 0] }, 'item-2': { type: 'venom', level: 1, position: [0, 0] } }
  journey.battle = battleFor(journey.descent)
  return journey
}

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
  assert.equal(levelStat(2, 4), 12, 'base × level, × 1.5 for the level 2 surge')
  assert.equal(levelStat(2, 5), 23, 'level 5 is the next surge: × 1.5 again')
  assert.deepEqual(battle.items['item-1'].position, [1, 0])
})

test('a won floor gives Embers and Bells, and a level-up card applies once', () => {
  const random = seededRandom(3)
  const journey = createRun(createProfile(), 'rook', random)
  fightFloor(journey, random)
  assert.equal(journey.phase, 'levelUp')
  assert.equal(journey.descent.bells, 2)
  assert.equal(journey.descent.cards.length, 3)
  const before = structuredClone(journey.descent)
  const card = journey.descent.cards[0]
  const lucky = () => 0
  assert.ok(chooseCard(journey, 0, lucky), 'a roll under trainChance makes this level-up a lucky one')
  assert.equal(journey.descent.level, before.level + 1)
  if (card.kind === 'level') assert.equal(journey.descent.items[card.id].level, before.items[card.id].level + 1)
  assert.equal(journey.phase, 'train')
  const trained = Object.keys(journey.descent.items).at(-1), levelBefore = journey.descent.items[trained].level
  assert.ok(trainItem(journey, trained, random))
  assert.equal(journey.descent.items[trained].level, levelBefore + 1)
  assert.notEqual(journey.phase, 'train')
})

test('a level-up without the lucky roll gives no training', () => {
  const random = seededRandom(3)
  const journey = createRun(createProfile(), 'rook', random)
  fightFloor(journey, random)
  assert.ok(chooseCard(journey, 0, () => 0.99))
  assert.notEqual(journey.phase, 'train')
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
  const journey = daggerAndVenomRun(random)
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
  while (journey.phase === 'levelUp') takeCard(journey, 0, random)
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
  assert.equal(profile.journey.battle.actors.recruit.maxHealth, 25)
  assert.deepEqual(unlockedCrew(profile), ['rook', 'nettle', 'pip'])
})

test('a seeded bot run reaches the first elite and every floor stays decidable', () => {
  const random = seededRandom(2)
  const journey = createRun(createProfile(), 'pip', random)
  for (let guard = 0; guard < 2000 && journey.phase !== 'dead' && journey.descent.floor <= 6; guard++) {
    if (journey.phase === 'battle') fightFloor(journey, random)
    else if (journey.phase === 'chest') collectChest(journey, random)
    else if (journey.phase === 'peddler') leavePeddler(journey, random)
    else takeCard(journey, 0, random)
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
  assert.equal(profile.bells, 2)
  assert.equal(profile.journey, null)
  assert.equal(JSON.parse(storage.get('black-bell-descent-v1')).bells, 2)
})

test('the battle box narrates hits, poison and statuses, and skips stack bookkeeping', async () => {
  const { battleLine } = await import('../plugins/bell/descent/battle-stage.js')
  const random = seededRandom(2)
  const journey = daggerAndVenomRun(random)
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
  while (journey.phase === 'levelUp') takeCard(journey, 0, random)
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
  const journey = daggerAndVenomRun(random)
  const hint = () => evolutionHints(journey)[0]?.text
  assert.equal(hint(), undefined)
  journey.descent.items['item-1'].level = 3
  journey.battle = battleFor(journey.descent)
  assert.equal(hint(), "Rusty Dagger L3 → Widow's Fang: reach L4.")
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

test('a pack is placed before the items inside it, so both keep their places from floor to floor', () => {
  const journey = createRun(createProfile(), 'rook', seededRandom(1))
  const run = journey.descent
  run.items['item-3'] = { type: 'scrapCrossbow', level: 1, position: [run.columns, 0] }
  run.items['item-4'] = { type: 'salvagePack', level: 1, position: [run.columns, 0] }
  const battle = battleFor(run)
  assert.deepEqual(battle.items['item-4'].position, [run.columns, 0])
  assert.deepEqual(battle.items['item-3'].position, [run.columns, 0])
})

test('an ability a totem grants grows with the totem’s level, not the weapon’s', () => {
  const salvageAfterOneCycle = level => {
    const journey = createRun(createProfile(), 'rook', seededRandom(1))
    const run = journey.descent
    run.items['item-3'] = { type: 'salvagePack', level, position: [run.columns, 0] }
    run.items['item-1'].position = [run.columns, 0]
    return rules.resolveCycle(battleFor(run), { afterCycle: ['enemy'] }).state.actors.recruit.resources.salvage
  }
  assert.equal(salvageAfterOneCycle(1), 2)
  assert.equal(salvageAfterOneCycle(3), levelStat(2, 3))
})

test('a payoff item is offered only once the run owns the item that feeds it', async () => {
  const { poolNeeds } = await import('../plugins/bell/descent/pool.js')
  const offered = owned => {
    const seen = new Set()
    for (let seed = 1; seed <= 300; seed++) {
      const journey = createRun(createProfile(), 'rook', seededRandom(seed))
      if (owned) journey.descent.items['item-9'] = { type: owned, level: 1, position: null }
      for (const card of drawCards(journey.descent, seededRandom(seed))) if (card.kind === 'item') seen.add(card.type)
    }
    return seen
  }
  const without = offered(null)
  for (const payoff of Object.keys(poolNeeds)) assert.ok(!without.has(payoff), payoff + ' is offered without its feeder')
  assert.ok(offered('curseIdol').has('reapingSeal'))
})

test('a new item that completes something owned is offered more often than one that does not', () => {
  const offers = { reapingSeal: 0, salt: 0 }
  for (let seed = 1; seed <= 400; seed++) {
    const journey = createRun(createProfile(), 'rook', seededRandom(seed))
    journey.descent.items['item-9'] = { type: 'curseIdol', level: 1, position: null }
    for (const card of drawCards(journey.descent, seededRandom(seed))) if (card.type in offers) offers[card.type]++
  }
  assert.ok(offers.reapingSeal > offers.salt, JSON.stringify(offers))
})

test('the Peddler visits after a boss with one ware per family, and buying and selling move Coin', () => {
  const random = seededRandom(4)
  const journey = createRun(createProfile(), 'rook', random)
  const run = journey.descent
  run.floor = 10; run.coin = 20
  run.enemy = { ...run.enemy, kind: 'boss' }
  journey.battle.actors.enemy.health = 0
  finishFloor(journey, random)
  while (journey.phase !== 'peddler') {
    if (journey.phase === 'chest') collectChest(journey, random)
    else takeCard(journey, 0, random)
  }
  assert.equal(run.coin, 20 + 8)
  const kinds = run.peddler.stock.map(ware => ware.kind)
  assert.equal(kinds.filter(kind => kind === 'family').length, 5)
  assert.ok(kinds.includes('evolved'))
  const ware = run.peddler.stock[0], owned = Object.keys(run.items).length
  assert.ok(buyFromPeddler(journey, 0))
  assert.equal(run.coin, 28 - ware.price)
  assert.equal(Object.keys(run.items).length, owned + 1)
  assert.equal(Object.values(run.items).at(-1).level, 3)
  const sold = Object.keys(run.items)[0], price = 2 + run.items[sold].level
  assert.ok(sellToPeddler(journey, sold))
  assert.equal(run.coin, 28 - ware.price + price)
  assert.ok(leavePeddler(journey, random))
  assert.equal(journey.phase, 'battle')
  assert.equal(run.floor, 11)
})

test('a run with many items is still offered new items at level-ups', () => {
  const random = seededRandom(2)
  const run = createRun(createProfile(), 'rook', random).descent
  for (const type of ['sword', 'buckler', 'salve', 'sprig', 'banner', 'hammer', 'venom', 'hungryTooth', 'bloodCup']) run.items['item-' + run.nextItem++] = { type, level: 1, position: null }
  assert.ok(Object.keys(run.items).length > 9)
  const offersNew = Array.from({ length: 50 }, () => drawCards(run, random)).some(cards => cards.some(card => card.kind === 'item'))
  assert.ok(offersNew)
})

test('only Coin limits buying from the Peddler: a full bag still buys every ware it can pay for', () => {
  const random = seededRandom(1)
  const journey = createRun(createProfile(), 'rook', random)
  const run = journey.descent
  for (const type of ['sword', 'buckler', 'salve', 'sprig', 'banner', 'hammer']) run.items['item-' + run.nextItem++] = { type, level: 1, position: null }
  run.floor = 10; run.coin = 100
  run.peddler = { stock: peddlerStock(run, random) }
  journey.phase = 'peddler'
  const wares = run.peddler.stock.length
  let bought = 0
  while (buyFromPeddler(journey, 0)) bought++
  assert.equal(bought, wares)
})

test('Bells grow with depth and pay a record bonus; endless tower ranks never cap', async () => {
  const { bellsFor } = await import('../plugins/bell/descent/run.js')
  const { upgradeCost } = await import('../plugins/bell/descent/tower.js')
  const run = { floor: 30, bestBefore: 40, enemy: { kind: 'normal' } }
  const deep = bellsFor(run)
  assert.ok(deep > bellsFor({ ...run, floor: 10 }) * 3, 'floor 30 pays several times floor 10')
  assert.equal(bellsFor({ ...run, bestBefore: 20 }), deep + 30, 'a record floor adds record × floor')
  assert.ok(upgradeCost('vigor', 50) > upgradeCost('vigor', 49))
  assert.equal(upgradeCost('deepPockets', 1), null)
})

test('item mastery grows across runs and adds to that item’s numbers', async () => {
  const { masteryLevel } = await import('../plugins/bell/descent/mastery.js')
  const profile = createProfile()
  for (let runIndex = 0; runIndex < 2; runIndex++) {
    const random = seededRandom(9)
    const journey = createRun(profile, 'rook', random)
    for (let floor = 0; floor < 3 && journey.phase !== 'dead'; floor++) {
      fightFloor(journey, random)
      while (journey.phase !== 'battle' && journey.phase !== 'dead') {
        if (journey.phase === 'chest') collectChest(journey, random)
        else if (journey.phase === 'peddler') leavePeddler(journey, random)
        else takeCard(journey, 0, random)
      }
    }
    abandonRun(journey)
    settleRun(profile, journey)
  }
  assert.equal(profile.mastery.dagger, 6)
  assert.equal(masteryLevel(profile.mastery.dagger), 0)
  profile.mastery.dagger = 30
  const run = createRun(profile, 'rook', seededRandom(1)).descent
  assert.equal(run.mastery.dagger, 2)
  run.items['item-1'].level = 5
  assert.equal(battleFor(run).items['item-1'].stats.damage, 25, 'level 5 dagger: 23 damage after two surges, +10% from mastery 2')
})

test('the Fast toggle plays a floor many times quicker than normal speed', async () => {
  const { fixture } = await import('../tools/ui-fixture.mjs')
  const secondsToWin = isFast => {
    const game = fixture({ hub: true })
    game.panel.on.goDown('rook')
    if (isFast) game.panel.on.fast(true)
    game.panel.on.fight()
    let ticks = 0
    while (game.read().journey.phase === 'battle' && ticks < 4000) { game.tick(1, 0.05); ticks++ }
    return ticks * 0.05
  }
  const normal = secondsToWin(false), fast = secondsToWin(true)
  assert.ok(fast * 4 < normal, `fast ${fast}s, normal ${normal}s`)
  const game = fixture({ hub: true })
  game.panel.on.goDown('rook')
  assert.match(game.panel.html(), /data-action="fast"/)
})

test('a draw one or two floors before a boss opens with a new item that guards or heals; other draws are not forced', () => {
  const isDefence = type => (rules.catalog.items[type].stats?.guard ?? 0) > 0 || (rules.catalog.items[type].stats?.heal ?? 0) > 0
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const run = createRun(createProfile(), 'rook', seededRandom(seed)).descent
    for (const floor of [8, 9, 18, 19]) {
      run.floor = floor
      const first = drawCards(run, seededRandom(seed + floor))[0]
      assert.ok(first.kind === 'item' && isDefence(first.type), `floor ${floor} seed ${seed}`)
    }
  }
  const quiet = createRun(createProfile(), 'rook', seededRandom(1)).descent
  quiet.floor = 5
  const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => drawCards(quiet, seededRandom(seed * 7919))[0].kind))
  assert.ok(firsts.size > 1, 'away from a boss the first card varies in kind')
})

test('a known strong pair across families makes the second item count as completing the first', () => {
  assert.ok(completesOwned(new Set(['dagger', 'tooth']), 'oilLantern'))
  assert.ok(completesOwned(new Set(['oilLantern']), 'tooth'))
  assert.ok(!completesOwned(new Set(['dagger']), 'oilLantern'))
})
