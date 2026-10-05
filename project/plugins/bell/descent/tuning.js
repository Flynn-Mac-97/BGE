/** Every number of the Descent in one table. Change values here; `node tools/descent-sim.mjs` shows the effect on depth. */
export const tuning = {
  grid: { columns: 4, rows: 3, maxColumns: 8 },
  recruit: { health: 24, healthPerLevel: 2, recoverShare: 0.3 },
  // A stat at level L is base × (1 + itemGrowth × (L − 1)), rounded; level 1 is the catalog value.
  itemGrowth: 1,
  // Embers for a floor: perFloor + perFloorGrowth × floor, times the floor kind's multiplier.
  // Embers needed for the next player level: firstNeed + needGrowth × (level − 1).
  embers: { perFloor: 5, perFloorGrowth: 0.6, elite: 2, boss: 3, firstNeed: 3, needGrowth: 3 },
  // Card weights: each owned item, each new item (falling as you own more), one wider grid, one tome, one new consumable.
  // Consumables have their own weight, so they keep turning up however many items you own.
  // synergyWeight: a new item that completes something you own (an evolution partner, a payoff) is this many times as likely.
  cards: { synergyWeight: 4, count: 3, maxLevelCards: 2, upgradeWeight: 2.5, newItemWeight: 8, newItemFalloff: 0.9, maxItems: 9, widenWeight: 1.5, tomeWeight: 2, consumableWeight: 3, mendShare: 0.5 },
  rerolls: 2,
  evolveLevel: 5,
  // Enemy health and damage are base × growth^(floor − 1), then × the floor kind's multiplier.
  // Set against the test-bout bot (tools/descent-bot.mjs) so a median run ends near floor 20 and bosses cause about half the deaths (see design/descent.md, Scaling).
  enemy: { healthGrowth: 1.13, damageGrowth: 1.09, eliteEvery: 5, bossEvery: 10, kinds: { normal: { health: 1.45, damage: 1.35 }, elite: { health: 1.45, damage: 1.1 }, boss: { health: 1.6, damage: 1.25 } } },
  // A chest holds an evolution when one is ready; otherwise this many free level-ups.
  chest: { elite: 1, boss: 3 },
  bells: { normal: 1, elite: 3, boss: 10 },
  cycleCap: 30,
  // Tomes come as level-up cards and stack for the run. Vigor adds max health; Might adds `bonus` to every nonzero number on all gear.
  tomes: { vigor: { health: 6 }, might: { bonus: 1 } }
}
