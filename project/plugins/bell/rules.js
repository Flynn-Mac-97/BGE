/** The game and its tests use the same compiled rule catalog. */
import { createRules } from '../grid-game/api.js'
import { catalog } from './catalog.js'
/** The compiled rules. Reassigned only by `addRuntimeItems`; importers read the live binding. */
export let rules = createRules(catalog)
export const itemDefinition = (state, id) => rules.catalog.items[state.items[id]?.type]
export const itemReference = id => ({ kind: 'item', id })

/** Recompile with items made at run time (forged items). Each call replaces the previous runtime items. */
export function addRuntimeItems(items, abilities) {
  rules = createRules({ ...catalog, items: { ...catalog.items, ...items }, abilities: { ...catalog.abilities, ...abilities } })
}
