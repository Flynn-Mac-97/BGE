/** Lab-only design mocks: playable in Family Lab, never offered as dungeon or campaign loot. */
export const labAbilities = {
  // Only an enemy's hit counts: your own Bone Club also hurts you, and an item must not be poisoned or Sapped.
  sapAttacker: { trigger: { event: 'damageTaken', target: { kind: 'owner' }, source: { kind: 'enemy' } }, target: { kind: 'eventSource' }, effects: [{ type: 'applyStatus', status: 'sapped', amount: { stat: 'potency' } }] },
  // Only an enemy's hit counts: your own Bone Club also hurts you, and an item must not be poisoned or Sapped.
  thornLash: { trigger: { event: 'damageTaken', target: { kind: 'owner' }, source: { kind: 'enemy' } }, target: { kind: 'eventSource' }, effects: [{ type: 'applyStatus', status: 'poison', amount: { stat: 'potency' } }] },
  blight: { trigger: { event: 'cycleStart' }, target: { kind: 'enemy' }, effects: [{ type: 'applyStatus', status: 'poison', amount: { stat: 'potency' } }] },
  coatTotem: { trigger: { event: 'ownTurn' }, target: { kind: 'directionalNeighbour', direction: 'right', tags: ['totem'], ownerOnly: true },
    effects: [{ type: 'applyStatus', status: 'thornsap', amount: { stat: 'potency' } }], limit: { perCycle: 1 } }
}
export const labItems = {
  sapwoodStaff: { name: 'Sapwood Staff', mark: '|', footprint: [1, 3], tags: ['growth', 'staff'], stats: { potency: 2 }, abilities: ['sapAttacker'], description: 'When your recruit is hit, the attacker is Sapped: it deals less damage, equal to potency (2), for the rest of the fight. Does not stack.' },
  thornTotem: { name: 'Thorn Totem', mark: 'Y', footprint: [1, 2], tags: ['growth', 'totem'], stats: { potency: 3 }, abilities: ['thornLash'], description: 'When your recruit is hit, give the attacker Poison equal to its potency (3).' },
  blightMortar: { name: 'Blight Mortar', mark: 'O', footprint: [1, 1], tags: ['alchemy', 'growth', 'tool'], stats: { potency: 2 }, abilities: ['blight'], description: 'At cycle start, give the enemy Poison equal to its potency (2).' },
  sporeIdol: { name: 'Spore Idol', mark: '*', footprint: [1, 1], tags: ['growth', 'relic'], abilities: [], stats: { potency: 1 }, auras: [{ target: { kind: 'adjacentItems', ownerOnly: true }, stat: 'potency', amount: { stat: 'potency' } }], description: 'Every edge-touching item has +1 potency. Only items that use potency benefit.' },
  thornsapVial: { name: 'Thornsap Vial', mark: 'v', footprint: [1, 1], tags: ['alchemy', 'growth'], stats: { potency: 2 }, abilities: ['coatTotem'], description: 'Totem touching the right edge: +2 potency until cycle end. Once per cycle.' }
}
/** Placeholder art for lab items, chosen from the existing ink library. */
export const labArt = { sapwoodStaff: 'boneWand', thornTotem: 'thornVine', blightMortar: 'mortarPestle', sporeIdol: 'mushroom', thornsapVial: 'doubleFlask' }
