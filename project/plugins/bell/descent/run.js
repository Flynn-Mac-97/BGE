/**
 * One Descent run as plain records. The journey keeps the shape the grid view reads
 * (`battle`, `phase`, `message`) and adds `descent`, the run itself:
 * `{ crew, floor, level, embers, pendingLevels, rerolls, bonus, columns, health, items: { id: { type, level, position } },
 *    nextItem, enemy, cards, chest, bells, evolutions, settled, story, forged }`. `forged` lists the forged item types this run may offer.
 *    coin, peddler, bestBefore, mastery, masteryGain }`. `coin` is spent at the Peddler (`peddler.js`), who visits after each boss.
 * `mastery` is the profile's mastery levels when the run began; `masteryGain` is the xp this run earns (`mastery.js`).
 * Phases: 'battle' (planning or fighting), 'chest', 'levelUp', 'train' (a level-up's free item level), 'peddler', 'dead'. Callers pass the engine's random.
 */
import { rules, itemReference } from '../rules.js'
import { tuning } from './tuning.js'
import { descentPool, consumablePool, descentCrew, poolNeeds } from './pool.js'
import { consumableCharges } from './consumables.js'
import { regions, enemyTraits, tireAbility } from './enemies.js'
import { evolutionRecipes } from './evolutions.js'
import { towerBonus } from './tower.js'
import { peddlerStock, buyWare, sellItem } from './peddler.js'
import { masteryLevels, gainMastery } from './mastery.js'
import { familyPowerAbilities } from './family-powers.js'
import { familyOf } from '../power-families.js'

/** A catalog stat at an item level. */
export const levelStat = (base, level) => Math.round(base * (1 + tuning.itemGrowth * (level - 1)))
/** Embers needed to go from this player level to the next. */
export const embersNeeded = level => tuning.embers.firstNeed + tuning.embers.needGrowth * (level - 1)
/** 'boss', 'elite' or 'normal'. */
export const floorKind = floor => floor % tuning.enemy.bossEvery === 0 ? 'boss' : floor % tuning.enemy.eliteEvery === 0 ? 'elite' : 'normal'
/** The region a floor is in. */
export const regionOf = floor => regions.filter(region => region.from <= floor).at(-1)
/** The recruit's max health at the run's level. */
export const maxHealthOf = run => Math.round((tuning.recruit.health + tuning.recruit.healthPerLevel * (run.level - 1) + (run.tomes?.vigor ?? 0) * tuning.tomes.vigor.health) * (1 + (run.bonus.maxHealthShare ?? 0)))
/** A run item's stat: its level-scaled base plus Tomes of Might. A zero base stays zero. */
export const itemStat = (base, item, run) => base ? Math.round((levelStat(base, item.level) + (run.tomes?.might ?? 0) * tuning.tomes.might.bonus) * (1 + (run.bonus.itemShare ?? 0) + tuning.mastery.share * (run.mastery?.[item.type] ?? 0))) : 0
/** "the Cellar Rat", or a name that already starts with "The". */
const theName = name => name.startsWith('The ') ? name : `the ${name}`
const capital = text => text[0].toUpperCase() + text.slice(1)
/** Set the message and keep the last few lines as the run's story. */
function tell(journey, text) {
  journey.message = text
  journey.descent.story = [...journey.descent.story, text].slice(-6)
  note(journey.descent, text)
}
// The run's full log for the play log; runs saved before it existed start one on their next line.
const LOG_LIMIT = 400
const note = (run, text) => { run.log = [...(run.log ?? []), text].slice(-LOG_LIMIT) }
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(Math.max(0, random()) * list.length))]
/** One entry of a list, each as likely as its weight. */
function pickWeighted(list, weightOf, random) {
  let roll = Math.max(0, random()) * list.reduce((sum, entry) => sum + weightOf(entry), 0)
  return list.find(entry => (roll -= weightOf(entry)) < 0) ?? list.at(-1)
}

/** True when a type completes something the run owns: an evolution partner, or the payoff a feeder unlocks. */
export function completesOwned(ownedTypes, type) {
  return evolutionRecipes.some(recipe => (recipe.partner === type && ownedTypes.has(recipe.from)) || (recipe.from === type && ownedTypes.has(recipe.partner))) || ownedTypes.has(poolNeeds[type])
}

function pickEnemy(floor, random) {
  const kind = floorKind(floor)
  return { ...structuredClone(pick(regionOf(floor)[kind], random)), kind }
}

function enemyActor(enemy, floor) {
  const kind = tuning.enemy.kinds[enemy.kind]
  const grown = (base, growth, share) => Math.max(1, Math.round(base * growth ** (floor - 1) * share))
  const traits = (enemy.traits ?? []).map(id => enemyTraits[id])
  const stats = { damage: grown(enemy.damage, tuning.enemy.damageGrowth, kind.damage) }
  for (const trait of traits) stats[trait.stat] = grown(trait.base, tuning.enemy.damageGrowth, kind.damage)
  const maxHealth = grown(enemy.health, tuning.enemy.healthGrowth, kind.health)
  stats.tire = Math.max(1, Math.round(maxHealth * tuning.enemy.tire.share))
  return { name: enemy.name, mark: enemy.mark, team: 'dungeon', maxHealth, stats,
    abilities: [{ id: 'enemyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }, tireAbility, ...traits.map(trait => trait.ability)] }
}

/** The floor's battle: every run item at its level; an item whose saved place no longer fits waits in reserve. */
export function battleFor(run) {
  const maxHealth = maxHealthOf(run)
  const battle = rules.createState({ columns: run.columns, rows: tuning.grid.rows,
    actors: { recruit: { name: descentCrew[run.crew].name, team: 'crew', maxHealth, health: Math.min(maxHealth, run.health), resources: { hunger: 0, salvage: 0 }, resourceCaps: { hunger: 9, salvage: 99 }, abilities: familyPowerAbilities }, enemy: enemyActor(run.enemy, run.floor) },
    items: Object.entries(run.items).map(([id, item]) => ({ id, type: item.type, owner: 'recruit', position: null })) })
  // Dice differ from floor to floor but replay the same on one floor.
  battle.rolls = { seed: run.floor * 7919 + run.level, count: 0 }
  // Packs go first: an item stored in a pack only fits once the pack is attached.
  const packsFirst = Object.entries(run.items).sort(([, first], [, second]) => Number(!rules.catalog.items[first.type].storage) - Number(!rules.catalog.items[second.type].storage))
  for (const [id, item] of packsFirst) {
    const definition = rules.catalog.items[item.type]
    for (const [stat, base] of Object.entries(definition.stats)) battle.items[id].stats[stat] = itemStat(base, item, run)
    if (item.position) rules.place(battle, id, item.position)
  }
  return battle
}

function floorMessage(run) {
  const region = regionOf(run.floor)
  const entered = region.from === run.floor ? `You descend into ${region.name}. ${region.line} ` : ''
  const kind = { normal: '', elite: 'An elite blocks the stair. ', boss: 'The stair ends at a great door. ' }[run.enemy.kind]
  const threats = (run.enemy.traits ?? []).map(id => enemyTraits[id].name)
  return `Floor ${run.floor}. ${entered}${kind}${run.enemy.line}${threats.length ? ` Threat: ${threats.join(', ')}.` : ''}`
}

/** A new run for one crew member, with the profile's Bell Tower ranks applied. */
export function createRun(profile, crewId, random) {
  const crew = descentCrew[crewId]
  const bonus = towerBonus(profile.tower)
  const items = Object.fromEntries(crew.kit.map(([type, position], index) => ['item-' + (index + 1), { type, level: 1 + bonus.startLevel, position: [...position] }]))
  const run = { crew: crewId, floor: 1, level: 1, embers: 0, pendingLevels: 0, rerolls: tuning.rerolls + bonus.rerolls, bonus,
    columns: Math.min(tuning.grid.maxColumns, tuning.grid.columns + bonus.columns + (crew.columns ?? 0)), health: 0,
    items, nextItem: crew.kit.length + 1, enemy: pickEnemy(1, random), cards: [], chest: null, bells: 0, evolutions: 0, settled: false, story: [], log: [], tomes: { vigor: 0, might: 0 }, coin: 0, peddler: null,
    bestBefore: profile.bestFloor ?? 0, mastery: masteryLevels(profile.mastery), masteryGain: {},
    forged: (profile.forged ?? []).map(record => record.id) }
  run.health = maxHealthOf(run)
  const journey = { descent: run, battle: battleFor(run), phase: 'battle', message: '' }
  tell(journey, `${crew.name} takes the lantern. ${floorMessage(run)}`)
  return journey
}

/** Write the grid's current places into the run, so moves made while planning survive the next floor. */
export function keepPlaces(journey) {
  for (const [id, item] of Object.entries(journey.descent.items)) item.position = journey.battle.items[id]?.position ?? null
}

/** Charges a consumable has left, or null for any other item. */
export const chargesLeft = item => consumableCharges[item.type] === undefined ? null : consumableCharges[item.type] - (item.used ?? 0)

/** Tap a placed consumable during a floor: spend a charge; it acts at the start of the next cycle. */
export function readyItem(journey, id) {
  const item = journey.descent?.items[id]
  if (journey.phase !== 'battle' || !item || !journey.battle.items[id]?.position || !chargesLeft(item) || item.readied) return false
  item.used = (item.used ?? 0) + 1
  item.readied = true
  const hero = journey.battle.actors.recruit
  note(journey.descent, `Tapped ${rules.catalog.items[item.type].name} in cycle ${journey.battle.cycle} at HP ${Math.max(0, hero.health)}/${hero.maxHealth}.`)
  return true
}

/** Move readied consumables into the battle, just before a cycle resolves. */
export function armReadied(journey) {
  for (const [id, item] of Object.entries(journey.descent?.items ?? {})) {
    if (!item.readied) continue
    item.readied = false
    journey.battle.items[id].resources.readied = 1
  }
}

// A tap that never got to act (the floor ended first) gives its charge back.
function refundReadied(journey) {
  for (const [id, item] of Object.entries(journey.descent.items)) {
    if (!item.readied && !journey.battle.items[id]?.resources.readied) continue
    item.readied = false
    item.used--
  }
}

/** Called after each resolved cycle. Returns true once the floor is decided. */
export function finishFloor(journey, random) {
  if (journey.phase !== 'battle') return false
  const run = journey.descent
  const winner = rules.winner(journey.battle)
  if (!winner && journey.battle.cycle <= tuning.cycleCap) return false
  keepPlaces(journey)
  refundReadied(journey)
  const hero = journey.battle.actors.recruit, foe = journey.battle.actors.enemy
  note(run, `[Floor ${run.floor} ${run.enemy.kind} · ${foe.name}] ${journey.battle.cycle} cycles · ${run.crew} HP ${Math.max(0, hero.health)}/${hero.maxHealth} · foe HP ${Math.max(0, foe.health)}/${foe.maxHealth}`)
  if (winner !== 'crew') {
    journey.phase = 'dead'
    tell(journey, winner ? `${descentCrew[run.crew].name} falls on floor ${run.floor}. ${capital(theName(run.enemy.name))} keeps the lantern.` : `Floor ${run.floor}: the fight drags on until the lantern gutters out. A build must kill to go deeper.`)
    return true
  }
  const kind = run.enemy.kind
  const bells = bellsFor(run)
  run.bells += bells
  const coin = Math.round(tuning.coin[kind] * (1 + (run.bonus.coinShare ?? 0)))
  run.coin = (run.coin ?? 0) + coin
  gainMastery(run, Object.values(run.items).filter(item => item.position).map(item => item.type))
  if (kind === 'boss') run.peddler = { stock: [] }
  const multiplier = { normal: 1, elite: tuning.embers.elite, boss: tuning.embers.boss }[kind]
  const gained = Math.round((tuning.embers.perFloor + tuning.embers.perFloorGrowth * run.floor) * multiplier * (1 + run.bonus.emberShare))
  run.embers += gained
  while (run.embers >= embersNeeded(run.level + run.pendingLevels)) { run.embers -= embersNeeded(run.level + run.pendingLevels); run.pendingLevels++ }
  const health = journey.battle.actors.recruit.health
  run.health = Math.min(maxHealthOf(run), health + Math.round(maxHealthOf(run) * (tuning.recruit.recoverShare + run.bonus.recoverShare)))
  run.chest = kind === 'normal' ? null : openChest(journey, kind, random)
  if (run.chest) for (const item of Object.values(run.items)) item.used = 0
  const levels = run.pendingLevels ? ` ${run.pendingLevels} level${run.pendingLevels > 1 ? 's' : ''} gained.` : ''
  tell(journey, `${capital(theName(run.enemy.name))} falls. +${gained} Embers, +${coin} Coin, +${bells} Bell${bells > 1 ? 's' : ''}${run.floor > run.bestBefore ? ' (new record!)' : ''}.${levels}`)
  if (run.chest) journey.phase = 'chest'
  else afterRewards(journey, random)
  return true
}

/**
 * Bells for a won floor: the floor kind's base, growing by `bells.growth` each floor, plus a record bonus
 * of `bells.record` × floor for a floor deeper than the profile had reached. Pushing your wall pays most.
 */
export function bellsFor(run) {
  const grown = tuning.bells[run.enemy.kind] * tuning.bells.growth ** (run.floor - 1)
  const record = run.floor > (run.bestBefore ?? 0) ? tuning.bells.record * run.floor : 0
  return Math.round(grown + record)
}

/** Recipes ready now: the item is high enough and its partner touches it on the grid. */
export function readyEvolutions(journey) {
  const run = journey.descent, battle = journey.battle
  const ready = []
  for (const [id, item] of Object.entries(run.items)) {
    const recipe = evolutionRecipes.find(recipe => recipe.from === item.type)
    if (!recipe || item.level < tuning.evolveLevel || !battle.items[id]?.position) continue
    const touching = rules.targets(battle, itemReference(id), { kind: 'adjacentItems', ownerOnly: true })
    if (touching.some(target => battle.items[target.id].type === recipe.partner)) ready.push({ id, ...recipe })
  }
  return ready
}

function openChest(journey, kind, random) {
  const run = journey.descent
  const [evolution] = readyEvolutions(journey)
  if (evolution) {
    run.items[evolution.id].type = evolution.into
    run.evolutions++
    return { kind: 'evolution', id: evolution.id, from: evolution.from, into: evolution.into }
  }
  const ups = []
  for (let roll = 0; roll < tuning.chest[kind]; roll++) {
    const id = pick(Object.keys(run.items), random)
    ups.push({ id, type: run.items[id].type, from: run.items[id].level, to: ++run.items[id].level })
  }
  return { kind: 'levels', ups }
}

/** Leave the chest screen for any pending cards, or the next floor. */
export function collectChest(journey, random) {
  if (journey.phase !== 'chest') return false
  journey.descent.chest = null
  afterRewards(journey, random)
  return true
}

function afterRewards(journey, random) {
  const run = journey.descent
  if (run.pendingLevels) { journey.phase = 'levelUp'; run.cards = drawCards(run, random); return }
  if (run.peddler) { run.peddler.stock = peddlerStock(run, random); journey.phase = 'peddler'; journey.battle = battleFor(run); tell(journey, 'A travelling Peddler sets down his pack on the stair.'); return }
  nextFloor(journey, random)
}

/** A level-up's second gift: one more level on an item the player picks. */
export function trainItem(journey, id, random) {
  const item = journey.descent.items[id]
  if (journey.phase !== 'train' || !item) return false
  item.level++
  tell(journey, `${rules.catalog.items[item.type].name} trains to level ${item.level}.`)
  afterRewards(journey, random)
  return true
}

/** Buy a Peddler's ware into the reserve. */
export function buyFromPeddler(journey, index) {
  const ware = journey.descent.peddler?.stock[index]
  if (journey.phase !== 'peddler' || !buyWare(journey.descent, index)) return false
  journey.battle = battleFor(journey.descent)
  tell(journey, `Bought ${rules.catalog.items[ware.type].name} (level ${ware.level}) for ${ware.price} Coin.`)
  return true
}

/** Sell an owned item to the Peddler. */
export function sellToPeddler(journey, id) {
  const type = journey.descent.items[id]?.type
  if (journey.phase !== 'peddler' || !sellItem(journey.descent, id)) return false
  journey.battle = battleFor(journey.descent)
  tell(journey, `Sold ${rules.catalog.items[type].name}.`)
  return true
}

/** Send the Peddler on his way and go down. */
export function leavePeddler(journey, random) {
  if (journey.phase !== 'peddler') return false
  journey.descent.peddler = null
  afterRewards(journey, random)
  return true
}

function nextFloor(journey, random) {
  const run = journey.descent
  run.floor++
  run.enemy = pickEnemy(run.floor, random)
  run.cards = []
  journey.battle = battleFor(run)
  journey.phase = 'battle'
  tell(journey, floorMessage(run))
}

const familyOfType = type => familyOf(rules.catalog.items[type] ?? {})

/**
 * How likely a new item is to be offered: `synergyWeight` times when it completes something owned, `newFamilyWeight` times when
 * the run owns nothing of its family, and `repeatFamilyWeight` times when this draw already offers its family, so a draw shows different families.
 */
function freshWeight(type, ownedTypes, cards) {
  const family = familyOfType(type)
  const completes = completesOwned(ownedTypes, type) ? tuning.cards.synergyWeight : 1
  const isNewFamily = family && ![...ownedTypes].some(owned => familyOfType(owned) === family) ? tuning.cards.newFamilyWeight : 1
  const isRepeat = family && cards.some(card => card.kind === 'item' && familyOfType(card.type) === family) ? tuning.cards.repeatFamilyWeight : 1
  return completes * isNewFamily * isRepeat
}

/**
 * Cards are drawn by group weight, then a random member; no card repeats in one draw.
 * A draw holds at most `maxLevelCards` level cards, and its last card is new (an item, a consumable or a tome) whenever one is left.
 */
export function drawCards(run, random) {
  const ownedTypes = new Set(Object.values(run.items).map(item => item.type))
  const ownedCount = Object.keys(run.items).length
  const cards = []
  const count = tuning.cards.count + run.bonus.cards
  for (let draw = 0; draw < count; draw++) {
    const levels = cards.filter(card => card.kind === 'level').length < tuning.cards.maxLevelCards ? Object.keys(run.items).filter(id => !cards.some(card => card.id === id)) : []
    const fresh = ownedCount < tuning.cards.maxItems ? [...descentPool, ...(run.forged ?? [])].filter(type => !ownedTypes.has(type) && !cards.some(card => card.type === type) && (!poolNeeds[type] || ownedTypes.has(poolNeeds[type]))) : []
    const flasks = ownedCount < tuning.cards.maxItems ? consumablePool.filter(type => !ownedTypes.has(type) && !cards.some(card => card.type === type)) : []
    const groups = [
      { weight: levels.length * tuning.cards.upgradeWeight, card: () => ({ kind: 'level', id: pick(levels, random) }) },
      { isNew: true, weight: fresh.length ? tuning.cards.newItemWeight * tuning.cards.newItemFalloff ** (ownedCount - 1) : 0, card: () => ({ kind: 'item', type: pickWeighted(fresh, type => freshWeight(type, ownedTypes, cards), random) }) },
      { isNew: true, weight: flasks.length ? tuning.cards.consumableWeight : 0, card: () => ({ kind: 'item', type: pick(flasks, random) }) },
      { isNew: true, weight: cards.some(card => card.kind === 'tome') ? 0 : tuning.cards.tomeWeight, card: () => ({ kind: 'tome', id: pick(Object.keys(tuning.tomes), random) }) },
      { weight: run.columns < tuning.grid.maxColumns && !cards.some(card => card.kind === 'widen') ? tuning.cards.widenWeight : 0, card: () => ({ kind: 'widen' }) }
    ]
    const needsNew = draw === count - 1 && !cards.some(card => ['item', 'tome'].includes(card.kind)) && groups.some(group => group.isNew && group.weight > 0)
    const open = needsNew ? groups.filter(group => group.isNew) : groups
    const total = open.reduce((sum, group) => sum + group.weight, 0)
    if (!total) { if (!cards.some(card => card.kind === 'mend')) cards.push({ kind: 'mend' }); continue }
    let roll = Math.max(0, random()) * total
    const group = open.find(group => (roll -= group.weight) < 0 && group.weight > 0) ?? open.findLast(group => group.weight > 0)
    cards.push(group.card())
  }
  return cards
}

const applyCard = {
  level: (run, card) => { run.items[card.id].level++ },
  item: (run, card) => { run.items['item-' + run.nextItem++] = { type: card.type, level: 1, position: null } },
  widen: run => { run.columns = Math.min(tuning.grid.maxColumns, run.columns + 1) },
  tome: (run, card) => { run.tomes = { ...run.tomes, [card.id]: (run.tomes?.[card.id] ?? 0) + 1 }; if (card.id === 'vigor') run.health += tuning.tomes.vigor.health },
  mend: run => { run.health = Math.min(maxHealthOf(run), run.health + Math.round(maxHealthOf(run) * tuning.cards.mendShare)) }
}

/** Take one card: apply it, gain the level, and draw again or go down. */
export function chooseCard(journey, index, random) {
  const run = journey.descent
  const card = run.cards[index]
  if (journey.phase !== 'levelUp' || !card) return false
  applyCard[card.kind](run, card)
  run.level++; run.pendingLevels--
  run.health = Math.min(maxHealthOf(run), run.health + tuning.recruit.healthPerLevel)
  tell(journey, `Level ${run.level}. ${cardSummary(run, card)}`)
  journey.phase = 'train'
  return true
}

/** Spend a reroll on a fresh set of cards. */
export function rerollCards(journey, random) {
  const run = journey.descent
  if (journey.phase !== 'levelUp' || run.rerolls < 1) return false
  run.rerolls--
  run.cards = drawCards(run, random)
  return true
}

/** Give up the run where it stands; it ends as a death. */
export function abandonRun(journey) {
  if (!['battle', 'levelUp', 'train', 'chest', 'peddler'].includes(journey.phase)) return false
  keepPlaces(journey)
  journey.phase = 'dead'
  tell(journey, `${descentCrew[journey.descent.crew].name} turns back on floor ${journey.descent.floor}. The lantern goes out on the stair.`)
  return true
}

/** Tome names, for cards and the log. */
export const tomeNames = { vigor: 'Tome of Vigor', might: 'Tome of Might' }

/** One line for the log after a card is taken. */
function cardSummary(run, card) {
  const lines = {
    level: () => `${rules.catalog.items[run.items[card.id].type].name} reaches level ${run.items[card.id].level}.`,
    item: () => `${rules.catalog.items[card.type].name} found. Place it on the grid.`,
    widen: () => `Your back is wider: ${run.columns} columns.`,
    mend: () => 'You rest and mend.',
    tome: () => `You read the ${tomeNames[card.id]} (${run.tomes[card.id]} read).`
  }
  return lines[card.kind]()
}

/** The stat changes a card would make: `[{ stat, from, to }]`. */
export function cardStats(run, card) {
  if (card.kind !== 'level') return []
  const item = run.items[card.id]
  return Object.entries(rules.catalog.items[item.type].stats).map(([stat, base]) => ({ stat, from: itemStat(base, item, run), to: itemStat(base, { ...item, level: item.level + 1 }, run) })).filter(change => change.from || change.to)
}

/** The recipe an item type can evolve by, or null. */
export const recipeFor = type => evolutionRecipes.find(recipe => recipe.from === type) ?? null
