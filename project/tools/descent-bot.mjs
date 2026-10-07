/**
 * A Descent bot that plans by trying: it fights a short test bout for each layout or card it
 * considers and keeps the one that does most. A by-hand balance tool for `descent-sim.mjs`, not game code.
 *
 *   arrange(journey)     places new items in their best cell, then moves items that do nothing where they are
 *   cardChoice(journey)  the index of the level-up card worth most
 *   trainChoice(journey) the item whose free training level is worth most
 *   shop(journey)        buys the Peddler's wares worth their price, selling gear that does nothing to make room
 */
import { rules, itemReference } from '../plugins/bell/rules.js'
import { evolutionRecipes } from '../plugins/bell/descent/evolutions.js'
import { battleFor, recipeFor, maxHealthOf, completesOwned, buyFromPeddler, sellToPeddler } from '../plugins/bell/descent/run.js'
import { consumablePool, poolNeeds } from '../plugins/bell/descent/pool.js'
import { tuning } from '../plugins/bell/descent/tuning.js'
import { familyOf } from '../plugins/bell/power-families.js'
import { familyPowerThresholds } from '../plugins/bell/descent/family-powers.js'

// Two cycles see cycle-end payoffs (Shock, Curse, Poison) and keep a placement bout cheap. A card is worth what it does
// over a whole fight, so stacking and growing items count: eight cycles is longer than a boss fight lasts.
const TEST_CYCLES = 2
const WORTH_CYCLES = 8
const ENDLESS = 1e6

/** Damage dealt minus health lost in a test bout of `cycles` against the floor's enemy, which cannot die. */
export function layoutScore(battle, cycles = TEST_CYCLES) {
  let bout = structuredClone(battle)
  bout.actors.enemy.health = bout.actors.enemy.maxHealth = ENDLESS
  // Half health, so healing counts and "waits if health is full" items act.
  bout.actors.recruit.maxHealth = ENDLESS
  bout.actors.recruit.health = ENDLESS / 2
  for (let cycle = 0; cycle < cycles; cycle++) bout = rules.resolveCycle(bout, { afterCycle: ['enemy'], trace: 'none' }).state
  return (ENDLESS - bout.actors.enemy.health) - (ENDLESS / 2 - bout.actors.recruit.health)
}

/** How many evolution partners an item touches: an evolution only happens with the partner on an edge. */
function partnersTouched(battle, id) {
  const type = battle.items[id].type
  const touching = rules.targets(battle, itemReference(id), { kind: 'adjacentItems', ownerOnly: true }).map(target => battle.items[target.id].type)
  return touching.filter(other => evolutionRecipes.some(recipe => (recipe.from === type && recipe.partner === other) || (recipe.partner === type && recipe.from === other))).length
}

// A cell touching an evolution partner is worth this share more: the evolution outgrows a small loss now.
const PARTNER_SHARE = 0.25

/** Every top-left cell an item could take, including inside attached packs. */
function cellsOf(battle) {
  const cells = []
  for (let y = 0; y < battle.grid.rows; y++) for (let x = 0; x < battle.grid.columns; x++) cells.push([x, y])
  return cells
}

/** Put one unplaced item in the cell that scores best; leave it in reserve when nothing fits. */
function placeBest(battle, id) {
  let best = null
  for (const cell of cellsOf(battle)) {
    if (!rules.place(battle, id, cell)) continue
    const score = layoutScore(battle) * (1 + PARTNER_SHARE * partnersTouched(battle, id))
    if (!best || score > best.score) best = { cell, score }
    rules.place(battle, id, null)
  }
  if (best) rules.place(battle, id, best.cell)
}

const isStorage = (battle, id) => !!rules.catalog.items[battle.items[id].type].storage
const signatures = new WeakMap()

/** Arrange the grid when the run's gear changed since the last arrangement. */
export function arrange(journey) {
  const battle = journey.battle
  const signature = JSON.stringify([journey.descent.columns, Object.values(journey.descent.items).map(item => item.type)])
  if (signatures.get(journey.descent) === signature && Object.values(battle.items).every(item => item.position)) return
  signatures.set(journey.descent, signature)
  // A pack attaches at the right edge first, so the items after it can go inside.
  for (const item of Object.values(battle.items)) if (!item.position && isStorage(battle, item.id)) rules.place(battle, item.id, [battle.grid.columns, 0])
  for (const item of Object.values(battle.items)) if (!item.position) placeBest(battle, item.id)
  // An item whose removal costs nothing is in the wrong place: an Echo Chime with no weapon below, a weapon outside the Salvager Pack.
  const whole = layoutScore(battle)
  for (const item of Object.values(battle.items)) {
    if (!item.position || isStorage(battle, item.id) || partnersTouched(battle, item.id)) continue
    const kept = item.position
    rules.place(battle, item.id, null)
    if (layoutScore(battle) < whole) { rules.place(battle, item.id, kept); continue }
    placeBest(battle, item.id)
    if (!item.position) rules.place(battle, item.id, kept)
  }
}

/** The run after taking a card, as a fresh battle with the new gear placed. */
function battleAfter(run, card) {
  const copy = structuredClone(run)
  if (card.kind === 'level') copy.items[card.id].level++
  if (card.kind === 'item') copy.items['trial'] = { type: card.type, level: card.level ?? 1, position: null }
  if (card.kind === 'sell') delete copy.items[card.id]
  if (card.kind === 'tome') copy.tomes[card.id] = (copy.tomes[card.id] ?? 0) + 1
  if (card.kind === 'widen') copy.columns++
  const battle = battleFor(copy)
  for (const item of Object.values(battle.items)) if (!item.position && isStorage(battle, item.id)) rules.place(battle, item.id, [battle.grid.columns, 0])
  for (const item of Object.values(battle.items)) if (!item.position) placeBest(battle, item.id)
  return battle
}

/** True when a type is worth more than its bout shows: it completes something owned, or it feeds a payoff. */
const isSynergy = (run, type) => completesOwned(new Set(Object.values(run.items).map(item => item.type)), type) || Object.values(poolNeeds).includes(type) || isNearFamilyPower(run, type)

/** True when owning this type brings its family to within one item of a power threshold (2, 3, 4 or 5 of a family). */
function isNearFamilyPower(run, type) {
  const family = familyOf(rules.catalog.items[type])
  if (!family) return false
  const owned = Object.values(run.items).filter(item => familyOf(rules.catalog.items[item.type]) === family).length + 1
  return familyPowerThresholds.some(threshold => owned === threshold || owned === threshold - 1)
}

// What a card is worth besides its test bout, as a share of the current score.
const SYNERGY_BONUS = 0.15
const CONSUMABLE_WORTH = 0.08
const VIGOR_WORTH = 0.1

/** What a card does for the run, as a share of the current test-bout score, plus synergy. */
function cardWorth(run, base, card) {
  if (card.kind === 'mend') return (1 - run.health / maxHealthOf(run)) * 0.5
  if (card.kind === 'item' && consumablePool.includes(card.type)) return CONSUMABLE_WORTH
  if (card.kind === 'tome' && card.id === 'vigor') return VIGOR_WORTH
  let value = (layoutScore(battleAfter(run, card), WORTH_CYCLES) - base) / Math.max(1, Math.abs(base))
  if (card.kind === 'item' && isSynergy(run, card.type)) value += SYNERGY_BONUS
  const item = run.items[card.id]
  const recipe = item && card.kind === 'level' && recipeFor(item.type)
  if (recipe && item.level < tuning.evolveLevel && Object.values(run.items).some(other => other.type === recipe.partner)) value += SYNERGY_BONUS
  return value
}

/** The entry of `options` worth most, by `worthOf`. */
const best = (options, worthOf) => options.map(option => ({ option, value: worthOf(option) })).sort((first, second) => second.value - first.value)[0]

/** What each offered card is worth, in offer order: a whole-fight test bout as a share of the current score, plus synergy. */
export function cardWorths(journey) {
  const run = journey.descent, base = layoutScore(battleFor(run), WORTH_CYCLES)
  return run.cards.map(card => cardWorth(run, base, card))
}

/** Index of the card worth most. */
export function cardChoice(journey) {
  const worths = cardWorths(journey)
  return worths.indexOf(Math.max(...worths))
}

/** The item id whose training level is worth most. */
export function trainChoice(journey) {
  const run = journey.descent, base = layoutScore(battleFor(run), WORTH_CYCLES)
  return best(Object.keys(run.items), id => cardWorth(run, base, { kind: 'level', id })).option
}

// A ware is bought only when it is worth at least this share of the score per Coin it costs.
const WORTH_PER_COIN = 0.01

/** Shop until nothing more is worth its price: sell gear that adds nothing, then buy the best affordable ware. */
export function shop(journey) {
  const run = journey.descent
  for (let guard = 0; guard < 12; guard++) {
    const base = layoutScore(battleFor(run), WORTH_CYCLES)
    const dead = Object.keys(run.items).find(id => !isSynergy(run, run.items[id].type) && cardWorth(run, base, { kind: 'sell', id }) >= 0)
    if (dead && Object.keys(run.items).length > 1) { sellToPeddler(journey, dead); continue }
    const affordable = run.peddler.stock.map((ware, index) => index).filter(index => run.peddler.stock[index].price <= run.coin)
    if (!affordable.length || Object.keys(run.items).length >= tuning.cards.maxItems) return
    const pick = best(affordable, index => cardWorth(run, base, { kind: 'item', ...run.peddler.stock[index] }) / run.peddler.stock[index].price)
    if (pick.value < WORTH_PER_COIN) return
    buyFromPeddler(journey, pick.option)
  }
}
