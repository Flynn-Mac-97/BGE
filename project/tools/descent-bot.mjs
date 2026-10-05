/**
 * A Descent bot that plans by trying: it fights a short test bout for each layout or card it
 * considers and keeps the one that does most. A by-hand balance tool for `descent-sim.mjs`, not game code.
 *
 *   arrange(journey)     places new items in their best cell, then moves items that do nothing where they are
 *   cardChoice(journey)  the index of the level-up card worth most
 */
import { rules, itemReference } from '../plugins/bell/rules.js'
import { evolutionRecipes } from '../plugins/bell/descent/evolutions.js'
import { battleFor, recipeFor, maxHealthOf, completesOwned } from '../plugins/bell/descent/run.js'
import { consumablePool, poolNeeds } from '../plugins/bell/descent/pool.js'
import { tuning } from '../plugins/bell/descent/tuning.js'

// Two cycles see cycle-end payoffs (Shock, Curse, Poison) and keep a test bout cheap.
const TEST_CYCLES = 2
const ENDLESS = 1e6

/** Damage dealt minus health lost in a test bout against the floor's enemy, which cannot die. */
export function layoutScore(battle) {
  let bout = structuredClone(battle)
  bout.actors.enemy.health = bout.actors.enemy.maxHealth = ENDLESS
  // Half health, so healing counts and "waits if health is full" items act.
  bout.actors.recruit.maxHealth = ENDLESS
  bout.actors.recruit.health = ENDLESS / 2
  for (let cycle = 0; cycle < TEST_CYCLES; cycle++) bout = rules.resolveCycle(bout, { afterCycle: ['enemy'] }).state
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
  if (card.kind === 'item') copy.items['trial'] = { type: card.type, level: 1, position: null }
  if (card.kind === 'tome') copy.tomes[card.id] = (copy.tomes[card.id] ?? 0) + 1
  if (card.kind === 'widen') copy.columns++
  const battle = battleFor(copy)
  for (const item of Object.values(battle.items)) if (!item.position && isStorage(battle, item.id)) rules.place(battle, item.id, [battle.grid.columns, 0])
  for (const item of Object.values(battle.items)) if (!item.position) placeBest(battle, item.id)
  return battle
}

/** True when a type is worth more than its bout shows: it completes something owned, or it feeds a payoff. */
const isSynergy = (run, type) => completesOwned(new Set(Object.values(run.items).map(item => item.type)), type) || Object.values(poolNeeds).includes(type)

// What a card is worth besides its test bout, as a share of the current score.
const SYNERGY_BONUS = 0.15
const CONSUMABLE_WORTH = 0.08
const VIGOR_WORTH = 0.1

/** Index of the card worth most: its test-bout gain over the current gear, plus synergy. */
export function cardChoice(journey) {
  const run = journey.descent
  const base = layoutScore(battleFor(run))
  const share = score => (score - base) / Math.max(1, Math.abs(base))
  const worth = card => {
    if (card.kind === 'mend') return (1 - run.health / maxHealthOf(run)) * 0.5
    if (card.kind === 'item' && consumablePool.includes(card.type)) return CONSUMABLE_WORTH
    if (card.kind === 'tome' && card.id === 'vigor') return VIGOR_WORTH
    let value = share(layoutScore(battleAfter(run, card)))
    if (card.kind === 'item' && isSynergy(run, card.type)) value += SYNERGY_BONUS
    const item = run.items[card.id]
    const recipe = item && recipeFor(item.type)
    if (recipe && item.level < tuning.evolveLevel && Object.values(run.items).some(other => other.type === recipe.partner)) value += SYNERGY_BONUS
    return value
  }
  return run.cards.map((card, index) => ({ index, value: worth(card) })).sort((first, second) => second.value - first.value)[0].index
}
