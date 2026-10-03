/** Authoring budgets are provisional costs, not a claim about measured combat strength. */
export const costs = { dagger: 2, sword: 5, venom: 3, stone: 2, tooth: 2, buckler: 3, salve: 3, hungryTooth: 2, bloodCup: 3, salt: 2, banner: 3, echo: 3, sprig: 2, pouch: 2, pack: 3, rootTotem: 3, hammer: 4, stormTotem: 3, curseIdol: 2, reapingSeal: 3, salvagePack: 3, patchKit: 2 }
export const actors = {
  scavenger: { name: 'Poison Scavenger', maxHealth: 12, tags: ['scavenger'], abilities: [], inventory: { columns: 3, rows: 3 } },
  sentinel: { name: 'Broken Sentinel', maxHealth: 12, tags: ['warrior'], abilities: [], inventory: { columns: 3, rows: 3 } },
  hungry: { name: 'Starving Pilgrim', maxHealth: 12, tags: ['hunger'], resources: { hunger: 0 }, resourceCaps: { hunger: 9 }, abilities: ['endureHunger'], inventory: { columns: 3, rows: 3 } }
}
export const recipes = {
  poison: { actor: 'scavenger', required: [{ key: 'blade', type: 'dagger', position: [1, 0] }, { key: 'coating', type: 'venom', position: [0, 0] }],
    links: [{ from: 'coating', to: 'blade', ability: 'coat', before: true }],
    optional: [{ key: 'reaction', pool: ['tooth'], positions: [[2, 0]] }, { key: 'support', pool: ['salve', 'sprig'], positions: [[0, 1], [2, 1]] }] },
  defender: { actor: 'sentinel', required: [{ key: 'shield', type: 'buckler', position: [0, 0] }, { key: 'blade', type: 'sword', position: [2, 0] }], links: [],
    optional: [{ key: 'support', pool: ['salt', 'salve', 'sprig'], positions: [[0, 2], [1, 2]] }] },
  hunger: { actor: 'hungry', required: [{ key: 'blade', type: 'dagger', position: [1, 0] }, { key: 'tooth', type: 'hungryTooth', position: [0, 0] }, { key: 'cup', type: 'bloodCup', position: [2, 0] }],
    links: [{ from: 'tooth', to: 'blade', ability: 'feed' }],
    optional: [{ key: 'support', pool: ['salve', 'sprig', 'stone'], positions: [[0, 1], [2, 1], [0, 2]] }] }
}
