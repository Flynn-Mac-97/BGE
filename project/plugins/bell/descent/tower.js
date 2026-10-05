/**
 * Bell Tower upgrades: permanent, bought with Bells between runs.
 * A capped upgrade lists `cost[rank]` for each rank. An endless one has `baseCost` and `costGrowth`:
 * rank r costs baseCost × costGrowth^r, without end, so every run's Bells buy something.
 */
export const towerUpgrades = {
  vigor: { name: 'Vigor', text: '+4% max health', baseCost: 5, costGrowth: 1.35, bonus: { maxHealthShare: 0.04 } },
  might: { name: 'Might', text: '+3% to every item number', baseCost: 10, costGrowth: 1.4, bonus: { itemShare: 0.03 } },
  kindling: { name: 'Kindling', text: '+6% Embers', baseCost: 8, costGrowth: 1.35, bonus: { emberShare: 0.06 } },
  fortune: { name: 'Fortune', text: '+8% Coin', baseCost: 6, costGrowth: 1.3, bonus: { coinShare: 0.08 } },
  lanternOil: { name: 'Lantern Oil', text: '+10% health recovered after each floor', cost: [10, 25, 50], bonus: { recoverShare: 0.1 } },
  secondLook: { name: 'Second Look', text: '+1 reroll each run', cost: [10, 25, 50], bonus: { rerolls: 1 } },
  heirloom: { name: 'Heirloom', text: 'Starting items begin one level higher', cost: [30, 90], bonus: { startLevel: 1 } },
  wideBack: { name: 'Wide Back', text: '+1 grid column at the start', cost: [25, 75], bonus: { columns: 1 } },
  deepPockets: { name: 'Deep Pockets', text: 'Choose from four cards', cost: [120], bonus: { cards: 1 } }
}

/** The price of an upgrade's next rank, or null when it is at its last rank. */
export function upgradeCost(id, rank) {
  const upgrade = towerUpgrades[id]
  if (upgrade.cost) return upgrade.cost[rank] ?? null
  return Math.round(upgrade.baseCost * upgrade.costGrowth ** rank)
}

/** True when an upgrade has no last rank. */
export const isEndless = id => !towerUpgrades[id].cost

/** The summed bonus of every bought rank: `{ maxHealthShare, itemShare, emberShare, coinShare, recoverShare, rerolls, startLevel, columns, cards }`. */
export function towerBonus(ranks) {
  const total = { maxHealthShare: 0, itemShare: 0, emberShare: 0, coinShare: 0, recoverShare: 0, rerolls: 0, startLevel: 0, columns: 0, cards: 0 }
  for (const [id, rank] of Object.entries(ranks)) for (const [key, amount] of Object.entries(towerUpgrades[id]?.bonus ?? {})) total[key] += amount * rank
  return total
}
