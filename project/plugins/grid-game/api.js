/** A compiled catalog and pure rules are the only authoring/runtime boundary. */
import { compileCatalog, effectNames, triggerNames, durationNames } from './catalog.js'
import { createState, addItem, winner } from './state.js'
import { placeItem, resizeGrid, footprint, adjacent } from './grid.js'
import { targets, selectorNames, conditionNames } from './targets.js'
import { statOf } from './values.js'
import { resolveCycle, execute } from './runtime.js'

export const vocabulary = { effects: effectNames, triggers: triggerNames, durations: durationNames, targets: selectorNames, conditions: conditionNames }

/** The catalog is immutable; state records can be saved as JSON or copied for previews. */
export function createRules(definitions) {
  const catalog = compileCatalog(definitions)
  return {
    catalog,
    createState: setup => createState(catalog, setup),
    addItem: (state, id, type, owner) => addItem(state, catalog, id, type, owner),
    place: (state, id, position) => placeItem(state, catalog, id, position),
    resize: (state, columns, rows) => resizeGrid(state, catalog, columns, rows),
    cells: (state, id) => footprint(catalog.items[state.items[id].type], state.items[id].position),
    adjacent: (state, first, second) => adjacent(state, catalog, state.items[first], state.items[second]),
    targets: (state, source, selector, event) => targets({ state, catalog, source, event }, selector),
    stat: (state, subject, stat) => statOf(state, catalog, subject, stat),
    resolveCycle: (state, options) => resolveCycle(catalog, state, options),
    resolveEvent: (state, event, options) => execute(catalog, state, [{ kind: 'event', event, path: [] }], options),
    winner
  }
}
