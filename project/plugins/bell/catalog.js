/** The demo catalog composes plain records; the resolver has no item-specific branches. */
import { abilities } from './catalog/abilities.js'
import { items } from './catalog/items.js'
export const catalog = {
  items, abilities,
  statuses: {
    poison: { name: 'Poison', stacking: 'add', duration: 'combat', abilities: ['poisonTick'] },
    coating: { name: 'Venom ready', stacking: 'replace', duration: 'nextAction', expires: 'cycle', modifiers: [{ stat: 'poisonOnHit', amount: { stacks: true } }] },
    regeneration: { name: 'Regeneration', stacking: 'max', duration: 'combat', abilities: ['regenerationTick'] }
  }
}
