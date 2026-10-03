/** The demo catalog composes plain records; the resolver has no item-specific branches. */
import { familyItems, familyAbilities } from './catalog/families.js'
import { abilities } from './catalog/abilities.js'
import { items } from './catalog/items.js'
export const catalog = {
  items: { ...items, ...familyItems }, abilities: { ...abilities, ...familyAbilities },
  statuses: {
    shock: { name: 'Shock', stacking: 'add', maxStacks: 8, duration: 'combat', abilities: ['shockTick'] },
    curse: { name: 'Curse', stacking: 'add', duration: 'combat', abilities: [] },
    poison: { name: 'Poison', stacking: 'add', duration: 'combat', abilities: ['poisonTick'] },
    coating: { name: 'Venom ready', stacking: 'replace', duration: 'nextAction', expires: 'cycle', modifiers: [{ stat: 'poisonOnHit', amount: { stacks: true } }] },
    regeneration: { name: 'Regeneration', stacking: 'max', duration: 'combat', abilities: ['regenerationTick'] }
  }
}
