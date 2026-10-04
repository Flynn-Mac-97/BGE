/**
 * One Descent run as plain records. The journey keeps the shape the grid view reads
 * (`battle`, `phase`, `message`) and adds `descent`, the run itself:
 * `{ crew, floor, level, embers, pendingLevels, rerolls, bonus, columns, health, items: { id: { type, level, position } },
 *    nextItem, enemy, cards, chest, bells, evolutions, settled, story, forged }`. `forged` lists the forged item types this run may offer.
 * Phases: 'battle' (planning or fighting), 'chest', 'levelUp', 'dead'. Callers pass the engine's random.
 */
import { rules, itemReference } from '../rules.js'
import { tuning } from './tuning.js'
import { descentPool, descentCrew } from './pool.js'
import { regions, enemyTraits } from './enemies.js'
import { evolutionRecipes } from './evolutions.js'
import { towerBonus } from './tower.js'

/** A catalog stat at an item level. */
export const levelStat = (base, level) => Math.round(base * (1 + tuning.itemGrowth * (level - 1)))
/** Embers needed to go from this player level to the next. */
export const embersNeeded = level => tuning.embers.firstNeed + tuning.embers.needGrowth * (level - 1)
/** 'boss', 'elite' or 'normal'. */
export const floorKind = floor => floor % tuning.enemy.bossEvery === 0 ? 'boss' : floor % tuning.enemy.eliteEvery === 0 ? 'elite' : 'normal'
/** The region a floor is in. */
export const regionOf = floor => regions.filter(region => region.from <= floor).at(-1)
/** The recruit's max health at the run's level. */
export const maxHealthOf = run => tuning.recruit.health + run.bonus.maxHealth + tuning.recruit.healthPerLevel * (run.level - 1)
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
  return { name: enemy.name, mark: enemy.mark, team: 'dungeon', maxHealth: grown(enemy.health, tuning.enemy.healthGrowth, kind.health), stats,
    abilities: [{ id: 'enemyAttack', trigger: { event: 'ownTurn' }, target: { kind: 'enemy' }, effects: [{ type: 'damage', amount: { stat: 'damage' } }] }, ...traits.map(trait => trait.ability)] }
}

/** The floor's battle: every run item at its level; an item whose saved place no longer fits waits in reserve. */
export function battleFor(run) {
  const maxHealth = maxHealthOf(run)
  const battle = rules.createState({ columns: run.columns, rows: tuning.grid.rows,
    actors: { recruit: { name: descentCrew[run.crew].name, team: 'crew', maxHealth, health: Math.min(maxHealth, run.health), resources: { hunger: 0, salvage: 0 }, resourceCaps: { hunger: 9, salvage: 99 } }, enemy: enemyActor(run.enemy, run.floor) },
    items: Object.entries(run.items).map(([id, item]) => ({ id, type: item.type, owner: 'recruit', position: null })) })
  for (const [id, item] of Object.entries(run.items)) {
    const definition = rules.catalog.items[item.type]
    for (const [stat, base] of Object.entries(definition.stats)) battle.items[id].stats[stat] = levelStat(base, item.level)
    if (item.position) rules.place(battle, id, item.position)
  }
  return battle
}

function floorMessage(run) {
  const region = regionOf(run.floor)
  const entered = region.from === run.floor ? `You descend into ${region.name}. ${region.line} ` : ''
  const kind = { normal: '', elite: 'An elite blocks the stair. ', boss: 'The stair ends at a great door. ' }[run.enemy.kind]
  return `Floor ${run.floor}. ${entered}${kind}${run.enemy.line}`
}

/** A new run for one crew member, with the profile's Bell Tower ranks applied. */
export function createRun(profile, crewId, random) {
  const crew = descentCrew[crewId]
  const bonus = towerBonus(profile.tower)
  const items = Object.fromEntries(crew.kit.map(([type, position], index) => ['item-' + (index + 1), { type, level: 1 + bonus.startLevel, position: [...position] }]))
  const run = { crew: crewId, floor: 1, level: 1, embers: 0, pendingLevels: 0, rerolls: tuning.rerolls + bonus.rerolls, bonus,
    columns: Math.min(tuning.grid.maxColumns, tuning.grid.columns + bonus.columns + (crew.columns ?? 0)), health: 0,
    items, nextItem: crew.kit.length + 1, enemy: pickEnemy(1, random), cards: [], chest: null, bells: 0, evolutions: 0, settled: false, story: [], log: [],
    forged: (profile.forged ?? []).map(record => record.id) }
  run.health = maxHealthOf(run)
  const journey = { descent: run, battle: battleFor(run), phase: 'battle', message: '' }
  tell(journey, `${crew.name} takes the lantern. ${floorMessage(run)}`)
  return journey
}

/** Write the grid's current places into the run, so moves made while planning survive the next floor. */
function keepPlaces(journey) {
  for (const [id, item] of Object.entries(journey.descent.items)) item.position = journey.battle.items[id]?.position ?? null
}

/** Called after each resolved cycle. Returns true once the floor is decided. */
export function finishFloor(journey, random) {
  if (journey.phase !== 'battle') return false
  const run = journey.descent
  const winner = rules.winner(journey.battle)
  if (!winner && journey.battle.cycle <= tuning.cycleCap) return false
  keepPlaces(journey)
  const hero = journey.battle.actors.recruit, foe = journey.battle.actors.enemy
  note(run, `[Floor ${run.floor} ${run.enemy.kind} · ${foe.name}] ${journey.battle.cycle - 1} cycles · ${run.crew} HP ${Math.max(0, hero.health)}/${hero.maxHealth} · foe HP ${Math.max(0, foe.health)}/${foe.maxHealth}`)
  if (winner !== 'crew') {
    journey.phase = 'dead'
    tell(journey, winner ? `${descentCrew[run.crew].name} falls on floor ${run.floor}. ${capital(theName(run.enemy.name))} keeps the lantern.` : `Floor ${run.floor}: the fight drags on until the lantern gutters out. A build must kill to go deeper.`)
    return true
  }
  const kind = run.enemy.kind
  run.bells += tuning.bells[kind]
  const multiplier = { normal: 1, elite: tuning.embers.elite, boss: tuning.embers.boss }[kind]
  const gained = Math.round((tuning.embers.perFloor + tuning.embers.perFloorGrowth * run.floor) * multiplier * (1 + run.bonus.emberShare))
  run.embers += gained
  while (run.embers >= embersNeeded(run.level + run.pendingLevels)) { run.embers -= embersNeeded(run.level + run.pendingLevels); run.pendingLevels++ }
  const health = journey.battle.actors.recruit.health
  run.health = Math.min(maxHealthOf(run), health + Math.round(maxHealthOf(run) * (tuning.recruit.recoverShare + run.bonus.recoverShare)))
  run.chest = kind === 'normal' ? null : openChest(journey, kind, random)
  const levels = run.pendingLevels ? ` ${run.pendingLevels} level${run.pendingLevels > 1 ? 's' : ''} gained.` : ''
  tell(journey, `${capital(theName(run.enemy.name))} falls. +${gained} Embers, +${tuning.bells[kind]} Bell${tuning.bells[kind] > 1 ? 's' : ''}.${levels}`)
  if (run.chest) journey.phase = 'chest'
  else afterRewards(journey, random)
  return true
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
  nextFloor(journey, random)
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

/** Cards are drawn by group weight, then a random member; no card repeats in one draw. */
export function drawCards(run, random) {
  const ownedTypes = new Set(Object.values(run.items).map(item => item.type))
  const ownedCount = Object.keys(run.items).length
  const cards = []
  const count = tuning.cards.count + run.bonus.cards
  for (let draw = 0; draw < count; draw++) {
    const levels = Object.keys(run.items).filter(id => !cards.some(card => card.id === id))
    const fresh = ownedCount < tuning.cards.maxItems ? [...descentPool, ...(run.forged ?? [])].filter(type => !ownedTypes.has(type) && !cards.some(card => card.type === type)) : []
    const groups = [
      { weight: levels.length * tuning.cards.upgradeWeight, card: () => ({ kind: 'level', id: pick(levels, random) }) },
      { weight: fresh.length ? tuning.cards.newItemWeight * tuning.cards.newItemFalloff ** (ownedCount - 1) : 0, card: () => ({ kind: 'item', type: pick(fresh, random) }) },
      { weight: run.columns < tuning.grid.maxColumns && !cards.some(card => card.kind === 'widen') ? tuning.cards.widenWeight : 0, card: () => ({ kind: 'widen' }) }
    ]
    const total = groups.reduce((sum, group) => sum + group.weight, 0)
    if (!total) { if (!cards.some(card => card.kind === 'mend')) cards.push({ kind: 'mend' }); continue }
    let roll = Math.max(0, random()) * total
    const group = groups.find(group => (roll -= group.weight) < 0 && group.weight > 0) ?? groups.findLast(group => group.weight > 0)
    cards.push(group.card())
  }
  return cards
}

const applyCard = {
  level: (run, card) => { run.items[card.id].level++ },
  item: (run, card) => { run.items['item-' + run.nextItem++] = { type: card.type, level: 1, position: null } },
  widen: run => { run.columns = Math.min(tuning.grid.maxColumns, run.columns + 1) },
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
  afterRewards(journey, random)
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
  if (!['battle', 'levelUp', 'chest'].includes(journey.phase)) return false
  keepPlaces(journey)
  journey.phase = 'dead'
  tell(journey, `${descentCrew[journey.descent.crew].name} turns back on floor ${journey.descent.floor}. The lantern goes out on the stair.`)
  return true
}

/** One line for the log after a card is taken. */
function cardSummary(run, card) {
  const lines = {
    level: () => `${rules.catalog.items[run.items[card.id].type].name} reaches level ${run.items[card.id].level}.`,
    item: () => `${rules.catalog.items[card.type].name} found. Place it on the grid.`,
    widen: () => `Your back is wider: ${run.columns} columns.`,
    mend: () => 'You rest and mend.'
  }
  return lines[card.kind]()
}

/** The stat changes a card would make: `[{ stat, from, to }]`. */
export function cardStats(run, card) {
  if (card.kind !== 'level') return []
  const item = run.items[card.id]
  return Object.entries(rules.catalog.items[item.type].stats).map(([stat, base]) => ({ stat, from: levelStat(base, item.level), to: levelStat(base, item.level + 1) })).filter(change => change.from || change.to)
}

/** The recipe an item type can evolve by, or null. */
export const recipeFor = type => evolutionRecipes.find(recipe => recipe.from === type) ?? null
