/** Bell Tower upgrades: permanent, bought with Bells between runs. `cost[rank]` buys the next rank. */
export const towerUpgrades = {
  vigor: { name: 'Vigor', text: '+5 max health', cost: [5, 10, 20, 35, 55], bonus: { maxHealth: 5 } },
  kindling: { name: 'Kindling', text: '+15% Embers', cost: [8, 16, 30, 50, 80], bonus: { emberShare: 0.15 } },
  lanternOil: { name: 'Lantern Oil', text: '+10% health recovered after each floor', cost: [10, 25, 50], bonus: { recoverShare: 0.1 } },
  secondLook: { name: 'Second Look', text: '+1 reroll each run', cost: [10, 25, 50], bonus: { rerolls: 1 } },
  heirloom: { name: 'Heirloom', text: 'Starting items begin one level higher', cost: [30, 90], bonus: { startLevel: 1 } },
  wideBack: { name: 'Wide Back', text: '+1 grid column at the start', cost: [25, 75], bonus: { columns: 1 } },
  deepPockets: { name: 'Deep Pockets', text: 'Choose from four cards', cost: [120], bonus: { cards: 1 } }
}

/** The summed bonus of every bought rank: `{ maxHealth, emberShare, recoverShare, rerolls, startLevel, columns, cards }`. */
export function towerBonus(ranks) {
  const total = { maxHealth: 0, emberShare: 0, recoverShare: 0, rerolls: 0, startLevel: 0, columns: 0, cards: 0 }
  for (const [id, rank] of Object.entries(ranks)) for (const [key, amount] of Object.entries(towerUpgrades[id]?.bonus ?? {})) total[key] += amount * rank
  return total
}
