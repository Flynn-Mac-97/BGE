/** The demo catalog composes plain records; the resolver has no item-specific branches. */
import { familyItems, familyAbilities } from './catalog/families.js'
import { abilities } from './catalog/abilities.js'
import { items } from './catalog/items.js'
import { labItems, labAbilities } from './catalog/lab.js'
export const catalog = {
  items: { ...items, ...familyItems, ...labItems }, abilities: { ...abilities, ...familyAbilities, ...labAbilities },
  statuses: {
    shock: { name: 'Shock', stacking: 'add', maxStacks: 8, duration: 'combat', abilities: ['shockTick'] },
    curse: { name: 'Curse', stacking: 'add', duration: 'combat', abilities: [] },
    poison: { name: 'Poison', stacking: 'add', duration: 'combat', abilities: ['poisonTick'] },
    coating: { name: 'Venom ready', stacking: 'replace', duration: 'nextAction', expires: 'cycle', modifiers: [{ stat: 'poisonOnHit', amount: { stacks: true } }] },
    sapped: { name: 'Sapped', stacking: 'add', maxStacks: 1, duration: 'combat', modifiers: [{ stat: 'damage', amount: -1 }] },
    thornsap: { name: 'Thornsap', stacking: 'replace', duration: 'cycle', modifiers: [{ stat: 'potency', amount: { stacks: true } }] },
    regeneration: { name: 'Regeneration', stacking: 'max', duration: 'combat', abilities: ['regenerationTick'] }
  }
}
