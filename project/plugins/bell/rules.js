/** The game and its tests use the same compiled rule catalog. */
import { createRules } from '../grid-game/api.js'
import { catalog } from './catalog.js'
export const rules = createRules(catalog)
export const itemDefinition = (state, id) => rules.catalog.items[state.items[id]?.type]
export const itemReference = id => ({ kind: 'item', id })
