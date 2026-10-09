/** The demo catalog composes plain records; the resolver has no item-specific branches. */
import { familyItems, familyAbilities } from './catalog/families.js'
import { abilities } from './catalog/abilities.js'
import { items } from './catalog/items.js'
import { labItems, labAbilities } from './catalog/lab.js'
import { evolvedItems, evolvedAbilities } from './descent/evolutions.js'
import { consumableItems, consumableAbilities } from './descent/consumables.js'
import { familyBaseItems, familyBaseAbilities, familyBaseStatuses } from './catalog/family-bases.js'
export const catalog = {
  items: { ...items, ...familyItems, ...labItems, ...evolvedItems, ...consumableItems, ...familyBaseItems }, abilities: { ...abilities, ...familyAbilities, ...labAbilities, ...evolvedAbilities, ...consumableAbilities, ...familyBaseAbilities },
  statuses: {
    ...familyBaseStatuses,
    shock: { short: 'SHOCK', name: 'Shock', stacking: 'add', maxStacks: 99, duration: 'combat', abilities: ['shockTick'] },
    curse: { short: 'CURSE', name: 'Curse', stacking: 'add', duration: 'combat', abilities: [] },
    poison: { short: 'PSN', name: 'Poison', stacking: 'add', duration: 'combat', abilities: ['poisonTick'] },
    coating: { name: 'Venom ready', stacking: 'replace', duration: 'nextAction', expires: 'cycle', modifiers: [{ stat: 'poisonOnHit', amount: { stacks: true } }] },
    sapped: { name: 'Sapped', stacking: 'max', duration: 'combat', modifiers: [{ stat: 'damage', amount: { stacks: true, scale: -1 } }] },
    thornsap: { name: 'Thornsap', stacking: 'replace', duration: 'cycle', modifiers: [{ stat: 'potency', amount: { stacks: true } }] },
    regeneration: { short: 'REGEN', name: 'Regeneration', stacking: 'max', duration: 'combat', abilities: ['regenerationTick'] }
  }
}
/** Lab mocks, evolved items and the Descent's family bases never drop as tavern campaign loot. */
export const notLoot = new Set([...Object.keys(labItems), ...Object.keys(evolvedItems), ...Object.keys(consumableItems), ...Object.keys(familyBaseItems)])
