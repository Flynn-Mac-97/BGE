/** Evolution recipes and the evolved items. An item at `level`, touching `partner` on the grid, becomes `into` at the next chest. */
export const evolutionRecipes = [
  { from: 'dagger', partner: 'venom', into: 'widowFang' },
  { from: 'sword', partner: 'stone', into: 'graveEdge' },
  { from: 'hammer', partner: 'buckler', into: 'bellHammer' },
  { from: 'salve', partner: 'sprig', into: 'heartleaf' },
  { from: 'bloodCup', partner: 'hungryTooth', into: 'vampireChalice' },
  { from: 'thornTotem', partner: 'sporeIdol', into: 'brambleThrone' },
  { from: 'blightMortar', partner: 'thornsapVial', into: 'rotCauldron' },
  { from: 'sapwoodStaff', partner: 'thornTotem', into: 'rootwardenStaff' },
  { from: 'banner', partner: 'stone', into: 'warStandard' }
]

export const evolvedAbilities = {
  bloom: { trigger: { event: 'ownTurn' }, target: { kind: 'owner' }, effects: [{ type: 'applyStatus', status: 'regeneration', amount: { stat: 'potency' } }], limit: { perCycle: 1 } },
  chaliceDrain: { trigger: { event: 'damageDealt', source: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true } }, target: { kind: 'owner' }, effects: [{ type: 'heal', amount: { stat: 'potency' } }], limit: { perCycle: 2 } },
  thornGuard: { trigger: { event: 'damageTaken', target: { kind: 'owner' } }, target: { kind: 'owner' }, effects: [{ type: 'guard', amount: { stat: 'potency' } }] },
  blightEnd: { trigger: { event: 'cycleEnd' }, target: { kind: 'enemy' }, effects: [{ type: 'applyStatus', status: 'poison', amount: { stat: 'potency' } }] },
  rootHeal: { trigger: { event: 'damageTaken', target: { kind: 'owner' } }, target: { kind: 'owner' }, effects: [{ type: 'heal', amount: { stat: 'potency' } }] }
}

const evolved = ['weapon', 'evolved']
export const evolvedItems = {
  widowFang: { name: "Widow's Fang", mark: 'Ŵ', footprint: [1, 2], tags: [...evolved, 'blade', 'combat'], stats: { damage: 4, poisonOnHit: 3 }, abilities: ['strike'], description: 'Strike for its damage and leave Poison in the wound. Evolved from the Rusty Dagger.' },
  graveEdge: { name: 'Grave Edge', mark: 'Ĝ', footprint: [1, 3], tags: [...evolved, 'blade', 'combat'], stats: { damage: 9, guard: 3 }, abilities: ['strike', 'protect'], description: 'Strike hard and raise guard every turn. Evolved from the Iron Sword.' },
  bellHammer: { name: 'Bell Hammer', mark: 'Ḃ', footprint: [1, 2], tags: [...evolved, 'combat'], stats: { damage: 6, guard: 4 }, abilities: ['breakArmour', 'protect'], description: 'Strip guard, strike, and ring out a guard of your own. Evolved from the Notched Hammer.' },
  heartleaf: { name: 'Heartleaf Poultice', mark: 'Ĥ', footprint: [1, 1], tags: ['evolved', 'herb', 'growth'], stats: { heal: 4, potency: 3 }, abilities: ['mend', 'bloom'], description: 'Heal every turn and keep Regeneration growing. Evolved from the Herbal Salve.' },
  vampireChalice: { name: 'Vampire Chalice', mark: 'Ṽ', footprint: [1, 1], tags: ['evolved', 'relic', 'hunger'], stats: { heal: 8, potency: 2 }, abilities: ['drink', 'chaliceDrain'], description: 'Touching weapons heal you as they hit, twice a cycle; Hunger still buys a deep drink. Evolved from the Blood Cup.' },
  brambleThrone: { name: 'Bramble Throne', mark: 'Ŧ', footprint: [1, 2], tags: ['evolved', 'growth', 'totem'], stats: { potency: 5 }, abilities: ['thornLash', 'thornGuard'], description: 'Every hit you take poisons the attacker and raises your guard. Evolved from the Thorn Totem.' },
  rotCauldron: { name: 'Rot Cauldron', mark: 'Ŏ', footprint: [1, 1], tags: ['evolved', 'alchemy', 'tool'], stats: { potency: 3 }, abilities: ['blight', 'blightEnd'], description: 'Poison the enemy at the start and the end of every cycle. Evolved from the Blight Mortar.' },
  rootwardenStaff: { name: 'Rootwarden Staff', mark: 'Ř', footprint: [1, 3], tags: ['evolved', 'growth', 'staff'], stats: { potency: 3 }, abilities: ['sapAttacker', 'rootHeal'], description: 'Attackers are Sapped by its potency, and every hit you take heals you. Evolved from the Sapwood Staff.' },
  warStandard: { name: 'War Standard', mark: 'Ŝ', footprint: [1, 2], tags: ['evolved', 'relic', 'combat'], stats: { potency: 3 }, abilities: [], auras: [{ target: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true }, stat: 'damage', amount: { stat: 'potency' } }], description: 'Every touching weapon has more damage, equal to its potency. Evolved from the Torn Banner.' }
}

/** Placeholder art for evolved items, from the existing ink library. */
export const evolvedArt = { widowFang: 'curvedSword', graveEdge: 'greatSword', bellHammer: 'spikedMace', heartleaf: 'oakLeaf', vampireChalice: 'ritualSkull', brambleThrone: 'rootBundle', rotCauldron: 'powderBomb', rootwardenStaff: 'spear', warStandard: 'runeTablet' }
