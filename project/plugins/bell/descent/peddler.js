/**
 * The travelling Peddler, who visits after each boss. Plain functions over the run record:
 * `run.peddler` is `{ stock: [{ type, level, price, kind }] }` while he is here, null otherwise.
 * `kind` is 'family' (one per power family), 'evolved' (only he sells these) or 'consumable'.
 * Coin is earned every floor (`tuning.coin`) and is spent only here.
 */
import { rules } from '../rules.js'
import { tuning } from './tuning.js'
import { descentPool, consumablePool, poolNeeds } from './pool.js'
import { evolvedItems } from './evolutions.js'
import { powerFamilies, familyOf } from '../power-families.js'

const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(Math.max(0, random()) * list.length))]

/** The level the Peddler's wares come at: higher with every boss beaten, so they stay worth buying. */
export const wareLevel = run => 1 + tuning.peddler.levelsPerVisit * Math.floor(run.floor / tuning.enemy.bossEvery)

/** What an owned item sells for. */
export const sellPrice = item => tuning.peddler.sellBase + item.level

/** A fresh stock: one item from each power family the run can still take, one evolved item and one consumable. */
export function peddlerStock(run, random) {
  const owned = new Set(Object.values(run.items).map(item => item.type))
  const canTake = type => !owned.has(type) && (!poolNeeds[type] || owned.has(poolNeeds[type]))
  const level = wareLevel(run)
  const ware = (type, kind) => ({ type, level: kind === 'consumable' ? 1 : level, price: tuning.peddler.price[kind], kind })
  const stock = []
  for (const family of Object.keys(powerFamilies)) {
    const choices = descentPool.filter(type => canTake(type) && familyOf(rules.catalog.items[type]) === family)
    if (choices.length) stock.push(ware(pick(choices, random), 'family'))
  }
  const evolved = Object.keys(evolvedItems).filter(canTake)
  if (evolved.length) stock.push(ware(pick(evolved, random), 'evolved'))
  const flasks = consumablePool.filter(canTake)
  if (flasks.length) stock.push(ware(pick(flasks, random), 'consumable'))
  return stock
}

/**
 * Buy one ware into the reserve. False when he is not here, it is gone or Coin is short.
 */
export function buyWare(run, index) {
  const ware = run.peddler?.stock[index]
  if (!ware || (run.coin ?? 0) < ware.price) return false
  run.coin -= ware.price
  run.items['item-' + run.nextItem++] = { type: ware.type, level: ware.level, position: null }
  run.peddler.stock.splice(index, 1)
  return true
}

/** Sell an owned item. The run keeps at least one item. */
export function sellItem(run, id) {
  const item = run.items[id]
  if (!run.peddler || !item || Object.keys(run.items).length < 2) return false
  run.coin = (run.coin ?? 0) + sellPrice(item)
  delete run.items[id]
  return true
}
