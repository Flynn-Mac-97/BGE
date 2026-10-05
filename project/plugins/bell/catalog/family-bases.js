/**
 * Family base items: one for each item icon no other item uses, eight per power family.
 * Each id is its art id. Numbers are first drafts, not a balance pass.
 * Statuses they add: Grit (guard each cycle), Rage (+damage on an item), Insight (study stacks),
 * Bleed (never fades), Burn (hits guard first, never fades). Dice use `{ roll }` (see design/item-primitives.md).
 */
const enemy = { kind: 'enemy' }
const owner = { kind: 'owner' }
const selfItem = { kind: 'selfItem' }
const touchingWeapons = { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true }
const touching = { kind: 'adjacentItems', ownerOnly: true }
const whenHit = { event: 'damageTaken', target: owner }

export const familyBaseStatuses = {
  grit: { short: 'GRIT', name: 'Grit', stacking: 'add', duration: 'combat', abilities: ['gritGuard'] },
  rage: { name: 'Rage', stacking: 'add', duration: 'combat', modifiers: [{ stat: 'damage', amount: { stacks: true } }] },
  insight: { short: 'INSIGHT', name: 'Insight', stacking: 'add', duration: 'combat', abilities: [] },
  bleed: { short: 'BLEED', name: 'Bleed', stacking: 'add', duration: 'combat', abilities: ['bleedTick'] },
  burn: { short: 'BURN', name: 'Burn', stacking: 'add', duration: 'combat', abilities: ['burnTick'] }
}

export const familyBaseAbilities = {
  gritGuard: { trigger: { event: 'cycleStart' }, target: { kind: 'self' }, effects: [{ type: 'guard', amount: { stacks: true } }] },
  bleedTick: { trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'damage', amount: { stacks: true }, bypassGuard: true }] },
  burnTick: { trigger: { event: 'cycleEnd' }, target: { kind: 'self' }, effects: [{ type: 'damage', amount: { stacks: true } }] },
  // Combat
  axeMomentum: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }, { type: 'modifyStat', stat: 'damage', amount: 1, target: selfItem }] },
  cleave: { trigger: { event: 'ownTurn' }, target: enemy, conditions: [{ kind: 'cycleEvery', amount: 2 }], effects: [{ type: 'damage', amount: { stat: 'damage' }, bypassGuard: true }] },
  hookAndBrace: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'removeGuard', amount: { stat: 'potency' } }, { type: 'guard', amount: { previous: true }, target: owner }, { type: 'damage', amount: { stat: 'damage' } }] },
  flurry: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }, { type: 'damage', amount: { stat: 'damage' } }, { type: 'damage', amount: { stat: 'damage' } }] },
  openingThrow: { trigger: { event: 'combatStart' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }] },
  shieldBash: { trigger: whenHit, target: { kind: 'directionalNeighbour', direction: 'right', tags: ['weapon'], ownerOnly: true }, effects: [{ type: 'triggerItem' }], limit: { perCycle: 1 } },
  gainGrit: { trigger: whenHit, target: owner, effects: [{ type: 'applyStatus', status: 'grit', amount: { stat: 'potency' } }] },
  grip: { trigger: { event: 'damageDealt', source: { kind: 'directionalNeighbour', direction: 'right', tags: ['weapon'], ownerOnly: true } }, target: { kind: 'eventSource' }, effects: [{ type: 'modifyStat', stat: 'damage', amount: { stat: 'potency' } }], limit: { perCycle: 1 } },
  // Growth
  antlerGrowth: { trigger: { event: 'cycleStart' }, target: selfItem, effects: [{ type: 'modifyStat', stat: 'potency', amount: 1 }] },
  // Honey is stored at a fixed 2 a cycle, so its 6-Honey cost keeps the meal every third cycle at any level; the heal grows.
  storeHoney: { trigger: { event: 'cycleEnd' }, target: owner, effects: [{ type: 'resource', resource: 'honey', amount: 2 }] },
  eatHoney: { trigger: { event: 'ownTurn' }, target: owner, conditions: [{ kind: 'healthBelow', ratio: 0.5 }], costs: [{ target: owner, resource: 'honey', amount: 6 }], effects: [{ type: 'heal', amount: { stat: 'heal' } }] },
  rebirth: { trigger: { event: 'cycleStart' }, target: owner, conditions: [{ kind: 'healthBelow', ratio: 0.3 }], effects: [{ type: 'heal', amount: { stat: 'heal' } }], limit: { perCombat: 1 } },
  breakBread: { trigger: { event: 'combatStart' }, target: owner, effects: [{ type: 'applyStatus', status: 'regeneration', amount: { stat: 'potency' } }] },
  quench: { trigger: { event: 'ownTurn' }, target: owner, effects: [{ type: 'removeStatus', status: 'poison', amount: { stat: 'potency' } }, { type: 'heal', amount: { previous: true } }] },
  nap: { trigger: { event: 'cycleStart' }, target: owner, conditions: [{ kind: 'cycleEvery', amount: 2 }], effects: [{ type: 'heal', amount: { stat: 'heal' } }] },
  ripen: { trigger: { event: 'cycleStart' }, target: selfItem, effects: [{ type: 'modifyStat', stat: 'heal', amount: 1 }] },
  briar: { trigger: whenHit, target: enemy, effects: [{ type: 'damage', amount: { stat: 'potency' } }] },
  // Scholarship
  turnTheGlass: { trigger: { event: 'cycleStart' }, target: touchingWeapons, conditions: [{ kind: 'cycleEvery', amount: 3 }], effects: [{ type: 'triggerItem' }] },
  study: { trigger: { event: 'ownTurn' }, target: selfItem, effects: [{ type: 'applyStatus', status: 'insight', amount: 1 }] },
  recite: { trigger: { event: 'ownTurn' }, target: enemy, conditions: [{ kind: 'hasStatus', status: 'insight', amount: 4, subject: 'selfItem' }], effects: [{ type: 'consumeStatus', status: 'insight', amount: 99, target: selfItem }, { type: 'damage', amount: { previous: true, scale: 5 }, bypassGuard: true }] },
  kindle: { trigger: { event: 'statusApplied', status: 'shock', target: enemy }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'shock', amount: { stat: 'potency' } }], limit: { perCycle: 1 } },
  moonCharge: { trigger: { event: 'cycleStart' }, target: enemy, effects: [{ type: 'applyStatus', status: 'shock', amount: { stat: 'potency' } }] },
  ignite: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'applyStatus', status: 'burn', amount: { stat: 'potency' } }] },
  unlock: { trigger: { event: 'combatStart' }, target: { kind: 'directionalNeighbour', direction: 'down', ownerOnly: true }, effects: [{ type: 'triggerItem' }] },
  distil: { trigger: { event: 'statusApplied', status: 'poison', target: enemy }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'poison', amount: { stat: 'potency' } }], limit: { perCycle: 1 } },
  staticShot: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }, { type: 'applyStatus', status: 'shock', amount: { stat: 'potency' } }] },
  // Hunger
  ravenous: { trigger: { event: 'cycleEnd' }, target: owner, effects: [{ type: 'resource', resource: 'hunger', amount: { stat: 'potency' } }] },
  pierce: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }, { type: 'applyStatus', status: 'bleed', amount: { stat: 'potency' } }] },
  bloodPrice: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }, { type: 'damage', amount: 1, bypassGuard: true, target: owner }] },
  spite: { trigger: whenHit, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }], limit: { perCycle: 2 } },
  rage: { trigger: whenHit, target: touchingWeapons, effects: [{ type: 'applyStatus', status: 'rage', amount: { stat: 'potency' } }] },
  penance: { trigger: whenHit, target: enemy, effects: [{ type: 'applyStatus', status: 'curse', amount: 1 }] },
  noose: { trigger: { event: 'statusApplied', status: 'curse', target: enemy }, target: { kind: 'eventTarget' }, effects: [{ type: 'applyStatus', status: 'curse', amount: { stat: 'potency' } }], limit: { perCycle: 1 } },
  desperation: { trigger: { event: 'cycleStart' }, target: touchingWeapons, conditions: [{ kind: 'healthBelow', ratio: 0.5, subject: 'owner' }], effects: [{ type: 'modifyStat', stat: 'damage', amount: { stat: 'potency' }, duration: 'cycle' }] },
  // Scavenging
  luckyRoll: { trigger: { event: 'cycleStart' }, target: touching, effects: [{ type: 'modifyStat', stat: 'damage', amount: { roll: 6, scaleStat: 'potency' }, duration: 'cycle' }, { type: 'modifyStat', stat: 'potency', amount: { roll: 6 }, duration: 'cycle' }] },
  gamblersChest: { trigger: { event: 'cycleStart' }, target: owner, effects: [{ type: 'resource', resource: 'salvage', amount: { roll: 6 } }] },
  pickLock: { trigger: { event: 'ownTurn' }, target: enemy, costs: [{ target: owner, resource: 'salvage', amount: 1 }], effects: [{ type: 'removeGuard', amount: { roll: 6, scaleStat: 'potency' } }] },
  prospect: { trigger: { event: 'ownTurn' }, target: enemy, effects: [{ type: 'damage', amount: { stat: 'damage' } }, { type: 'resource', resource: 'salvage', amount: 1, target: owner }] },
  digDeep: { trigger: { event: 'ownTurn' }, target: enemy, costs: [{ target: owner, resource: 'salvage', amount: 3 }], effects: [{ type: 'damage', amount: { roll: 6, scaleStat: 'potency' } }] },
  tailor: { trigger: { event: 'cycleEnd' }, target: touchingWeapons, costs: [{ target: owner, resource: 'salvage', amount: 4 }], effects: [{ type: 'modifyStat', stat: 'damage', amount: { stat: 'potency' } }] },
  looseArrow: { trigger: { event: 'damageDealt', source: touchingWeapons }, target: enemy, effects: [{ type: 'damage', amount: { roll: 4, scaleStat: 'potency' } }], limit: { perCycle: 1 } }
}

const item = (name, family, kind, footprint, stats, abilities, description, extra = {}) => ({ name, mark: name[0], footprint, tags: [kind, family].filter(Boolean), stats, abilities, description, ...extra })

export const familyBaseItems = {
  // Combat: weapons and armour that build on each hit.
  handAxe: item('Hand Axe', 'combat', 'weapon', [1, 1], { damage: 2 }, ['axeMomentum'], 'Strike, then gain +1 damage for the rest of the fight. Grows every swing.'),
  battleAxe: item('Battle Axe', 'combat', 'weapon', [1, 2], { damage: 7 }, ['cleave'], 'Every 2nd cycle, cleave for its damage straight through guard.'),
  halberd: item('Halberd', 'combat', 'weapon', [1, 3], { damage: 4, potency: 3 }, ['hookAndBrace'], 'Hook away up to 3 of the foe’s guard, keep it as your own, then strike.'),
  flail: item('Flail', 'combat', 'weapon', [1, 2], { damage: 1 }, ['flurry'], 'Strike three times. Every bonus to its damage counts three times.'),
  throwingKnife: item('Throwing Knife', 'combat', 'weapon', [1, 2], { damage: 2 }, ['openingThrow', 'strike'], 'Throw once when the fight starts, then strike each turn.'),
  towerShield: item('Tower Shield', 'combat', 'armour', [1, 2], { guard: 3 }, ['protect', 'shieldBash'], 'Gain 3 guard each turn. When you are hit, the weapon to its right strikes back. Once per cycle.'),
  ironHelm: item('Iron Helm', 'combat', 'armour', [1, 1], { potency: 1 }, ['gainGrit'], 'Each time you are hit, gain 1 Grit. Every cycle starts with guard equal to your Grit. Stacks all fight.'),
  plateGlove: item('Plate Glove', 'combat', 'tool', [1, 1], { potency: 2 }, ['grip'], 'When the weapon to its right hits, that weapon gains +2 damage for the rest of the fight. Once per cycle.'),
  // Growth: healing that grows, and thorns.
  antlerCharm: item('Antler Charm', 'growth', 'relic', [1, 1], { potency: 1 }, ['antlerGrowth'], 'Touching items have +potency. Its potency grows by 1 every cycle.', { auras: [{ target: touching, stat: 'potency', amount: { stat: 'potency' } }] }),
  honeycomb: item('Honeycomb', 'growth', 'herb', [1, 1], { heal: 8 }, ['storeHoney', 'eatHoney'], 'Store 2 Honey at each cycle end. Below half health, eat 6 Honey to heal 8.'),
  feather: item('Phoenix Feather', 'growth', 'relic', [1, 1], { heal: 12 }, ['rebirth'], 'Once per fight, when a cycle starts with you below 30% health, heal 12.'),
  breadLoaf: item('Bread Loaf', 'growth', 'herb', [1, 1], { potency: 3 }, ['breakBread'], 'When the fight starts, gain 3 Regeneration.'),
  waterSkin: item('Water Skin', 'growth', 'herb', [1, 1], { potency: 3 }, ['quench'], 'Each turn, wash out up to 3 Poison and heal as much as it washed out.'),
  bedroll: item('Bedroll', 'growth', 'herb', [2, 1], { heal: 5 }, ['nap'], 'Every 2nd cycle, rest and heal 5.'),
  cheeseWedge: item('Aged Cheese', 'growth', 'herb', [1, 1], { heal: 1 }, ['mend', 'ripen'], 'Heal 1 each turn. Its healing grows by 1 every cycle.'),
  travelCloak: item('Briar Cloak', 'growth', 'armour', [1, 2], { potency: 2 }, ['briar'], 'Each time you are hit, thorns deal 2 damage to the foe.'),
  // Scholarship: time, study, and turning up effects.
  hourglass: item('Hourglass', 'scholarship', 'relic', [1, 1], {}, ['turnTheGlass'], 'Every 3rd cycle, every touching weapon acts again.'),
  scrollRoll: item('Scroll of Study', 'scholarship', 'relic', [1, 1], {}, ['study', 'recite'], 'Gain 1 Insight each turn. At 4 Insight, spend it all: 5 damage per Insight, through guard.'),
  waxCandle: item('Wax Candle', 'scholarship', 'relic', [1, 1], { potency: 2 }, ['kindle'], 'Whenever the foe gains Shock, add 2 more. Once per cycle.'),
  moonAmulet: item('Moon Amulet', 'scholarship', 'relic', [1, 1], { potency: 2 }, ['moonCharge'], 'At each cycle start, charge the foe with 2 Shock.'),
  oilLantern: item('Oil Lantern', 'scholarship', 'tool', [1, 1], { potency: 1 }, ['ignite'], 'Each turn, add 1 Burn to the foe. Burn hits every cycle end, never fades, and is stopped by guard.'),
  ironKey: item('Iron Key', 'scholarship', 'tool', [1, 1], {}, ['unlock'], 'When the fight starts, the item below it acts once.'),
  signetRing: item('Signet Ring', 'scholarship', 'relic', [1, 1], { potency: 2 }, ['distil'], 'Whenever the foe gains Poison, add 2 more. Once per cycle.'),
  huntingBow: item('Static Bow', 'scholarship', 'weapon', [1, 2], { damage: 2, potency: 2 }, ['staticShot'], 'Shoot for 2 and add 2 Shock.'),
  // Hunger: pain, blood and curses.
  meatJoint: item('Raw Meat', 'hunger', 'relic', [1, 1], { potency: 1 }, ['ravenous'], 'Gain 1 Hunger at each cycle end.'),
  warPick: item('War Pick', 'hunger', 'weapon', [1, 2], { damage: 2, potency: 1 }, ['pierce'], 'Strike and add 1 Bleed. Bleed hits every cycle end, through guard, and never fades.'),
  woodenClub: item('Bone Club', 'hunger', 'weapon', [1, 2], { damage: 5 }, ['bloodPrice'], 'Strike hard, and hurt yourself for 1. The wound sets off everything that wakes when you are hit.'),
  sling: item('Spite Sling', 'hunger', 'weapon', [1, 1], { damage: 3 }, ['spite'], 'Each time you are hit, sling 3 damage back. Twice per cycle.'),
  leatherCap: item('Blood-Rage Cap', 'hunger', 'armour', [1, 1], { potency: 1 }, ['rage'], 'Each time you are hit, touching weapons gain 1 Rage: +1 damage for the rest of the fight.'),
  chainShirt: item('Penitent Chains', 'hunger', 'armour', [1, 2], { guard: 2 }, ['protect', 'penance'], 'Gain 2 guard each turn. Each time you are hit, curse the foe with 1 Curse.'),
  ropeCoil: item('Hangman’s Rope', 'hunger', 'relic', [1, 1], { potency: 2 }, ['noose'], 'Whenever the foe gains Curse, add 2 more. Once per cycle.'),
  ironBoots: item('Bloodied Boots', 'hunger', 'armour', [1, 1], { potency: 5 }, ['desperation'], 'While you are below half health, touching weapons have +5 damage each cycle.'),
  // Scavenging: luck, loot and Salvage.
  coinPurse: item('Lucky Purse', 'scavenging', 'relic', [1, 1], { potency: 1 }, ['luckyRoll'], 'At each cycle start, every touching item rolls a die: +1 to +6 damage (times the Purse’s potency) and +1 to +6 potency for the cycle.'),
  woodenChest: item('Gambler’s Chest', 'scavenging', 'tool', [1, 1], {}, ['gamblersChest'], 'At each cycle start, roll a die and gain that much Salvage.'),
  lockpicks: item('Lockpicks', 'scavenging', 'tool', [1, 1], { potency: 2 }, ['pickLock'], 'Each turn, spend 1 Salvage to pick away a die roll of the foe’s guard, times its potency (2 to 12).'),
  pickaxe: item('Pickaxe', 'scavenging', 'weapon', [1, 2], { damage: 3 }, ['prospect'], 'Strike and dig up 1 Salvage.'),
  handShovel: item('Grave Shovel', 'scavenging', 'weapon', [1, 1], { potency: 3 }, ['digDeep'], 'Spend 3 Salvage to dig up a fortune: a die roll times its potency (3 to 18 damage).'),
  travelSatchel: item('Travel Satchel', 'scavenging', 'storage', [1, 1], { potency: 2 }, [], 'Attach at the right edge: a 1-column bag. Items inside have +2 potency.', { storage: { columns: 1 }, auras: [{ target: { kind: 'containerItems', ownerOnly: true }, stat: 'potency', amount: { stat: 'potency' } }] }),
  sewingKit: item('Sewing Kit', 'scavenging', 'tool', [1, 1], { potency: 1 }, ['tailor'], 'At each cycle end, spend 4 Salvage: touching weapons gain +1 damage for the rest of the fight.'),
  quiver: item('Lucky Quiver', 'scavenging', 'relic', [1, 1], { potency: 1 }, ['looseArrow'], 'When a touching weapon hits, loose an arrow for a d4 times its potency. Once per cycle.')
}
