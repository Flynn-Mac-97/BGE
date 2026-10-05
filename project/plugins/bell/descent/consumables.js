/**
 * Consumables: grid items the player taps during a fight. A tap spends a charge and readies the item;
 * its ability fires at the start of the next cycle by spending the item's `readied` resource.
 * Charges refill when a chest opens. Levels raise the item's stats, not its charges.
 */
const once = effects => ({ trigger: { event: 'cycleStart' }, costs: [{ target: { kind: 'self' }, resource: 'readied', amount: 1 }], ...effects })

export const consumableAbilities = {
  quaff: once({ target: { kind: 'owner' }, effects: [{ type: 'heal', amount: { stat: 'heal' } }] }),
  bramble: once({ target: { kind: 'owner' }, effects: [{ type: 'guard', amount: { stat: 'guard' } }] }),
  rotBurst: once({ target: { kind: 'enemy' }, effects: [{ type: 'consumeStatus', status: 'poison', amount: 99 }, { type: 'damage', amount: { previous: true }, bypassGuard: true }, { type: 'damage', amount: { stat: 'damage' } }] }),
  oil: once({ target: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true }, effects: [{ type: 'modifyStat', stat: 'damage', amount: { stat: 'potency' }, duration: 'combat' }] }),
  smoke: once({ target: { kind: 'enemy' }, effects: [{ type: 'applyStatus', status: 'sapped', amount: { stat: 'potency' } }] })
}

const flask = { footprint: [1, 1], resources: { readied: 0 }, resourceCaps: { readied: 1 } }
export const consumableItems = {
  mendingDraught: { ...flask, name: 'Mending Draught', mark: '♥', art: 'tallPotion', tags: ['consumable', 'herb'], stats: { heal: 10 }, abilities: ['quaff'], description: 'Tap in a fight: heal 10 at the start of the next cycle. 1 charge.' },
  brambleWard: { ...flask, name: 'Bramble Ward', mark: '♣', art: 'thornVine', tags: ['consumable', 'growth'], stats: { guard: 12 }, abilities: ['bramble'], description: 'Tap in a fight: 12 guard for the next cycle. Brace for a big hit. 2 charges.' },
  rotBloom: { ...flask, name: 'Rot Bloom', mark: '✺', art: 'mushroom', tags: ['consumable', 'alchemy'], stats: { damage: 3 }, abilities: ['rotBurst'], description: 'Tap in a fight: all Poison on the foe bursts as damage at once, plus 3. 1 charge.' },
  whetOil: { ...flask, name: 'Whet Oil', mark: '⌇', art: 'doubleFlask', tags: ['consumable', 'tool'], stats: { potency: 3 }, abilities: ['oil'], description: 'Tap in a fight: touching weapons deal +3 damage for the rest of the floor. 1 charge.' },
  smokeFlask: { ...flask, name: 'Smoke Flask', mark: '☁', art: 'powderBomb', tags: ['consumable', 'alchemy'], stats: { potency: 3 }, abilities: ['smoke'], description: 'Tap in a fight: the foe deals 3 less damage for the rest of the floor. 1 charge.' }
}

/** Charges each consumable holds when full. */
export const consumableCharges = { mendingDraught: 1, brambleWard: 2, rotBloom: 1, whetOil: 1, smokeFlask: 1 }

/** The grid's short line for each consumable, from the item's current stats. */
export const consumableGlance = {
  mendingDraught: stats => `+${stats.heal} HP`,
  brambleWard: stats => `+${stats.guard} GD`,
  rotBloom: stats => `PSN→DMG +${stats.damage}`,
  whetOil: stats => `touching +${stats.potency} DMG`,
  smokeFlask: stats => `foe −${stats.potency} DMG`
}
