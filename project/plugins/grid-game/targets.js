/** Selectors operate on references; family names and item IDs never select behaviour. */
import { spatialTargets } from './spatial.js'
import { preparedStates } from './prepared.js'
import { adjacent, placedItems, neighbourCells, occupant, inside, inventoryState } from './grid.js'

export const reference = (kind, id) => ({ kind, id })
export const keyOf = subject => `${subject.kind}:${subject.id}`
export const sameReference = (first, second) => !!first && !!second && first.kind === second.kind && first.id === second.id
export const entityOf = (state, subject) => subject?.kind === 'item' ? state.items[subject.id] : state.actors[subject?.id]
export const ownerOf = (state, subject) => subject.kind === 'actor' ? subject : reference('actor', state.items[subject.id].owner)
export const definitionOf = (state, catalog, subject) => subject.kind === 'item' ? catalog.items[state.items[subject.id].type] : state.actors[subject.id]
export const isAlive = (state, subject) => state.actors[subject.kind === 'actor' ? subject.id : state.items[subject.id].owner].health > 0

const selectors = {
  area: (frame, selector) => spatialTargets(frame.state, frame.catalog, frame.source, selector),
  containerItems: (frame, selector) => spatialTargets(frame.state, frame.catalog, frame.source, selector),
  self: frame => [frame.source],
  selfItem: frame => frame.source.kind === 'item' ? [frame.source] : [],
  owner: frame => [ownerOf(frame.state, frame.source)],
  enemy: frame => {
    const owner = frame.source.kind === 'actor' ? frame.source.id : frame.state.items[frame.source.id].owner
    const prepared = preparedStates.get(frame.state)
    if (prepared) {
      for (const entry of prepared.enemies[owner]) if (entry.actor.health > 0) return entry.selection
      return []
    }
    return Object.values(frame.state.actors).filter(actor => actor.team !== frame.state.actors[owner].team && actor.health > 0).sort((first, second) => first.id.localeCompare(second.id)).slice(0, 1).map(actor => reference('actor', actor.id))
  },
  eventSource: frame => frame.event?.source ? [frame.event.source] : [],
  eventTarget: frame => frame.event?.target ? [frame.event.target] : [],
  adjacentItems: frame => frame.source.kind === 'item' ? placedItems(frame.state).filter(item => item.id !== frame.source.id && adjacent(frame.state, frame.catalog, frame.state.items[frame.source.id], item)).map(item => reference('item', item.id)) : [],
  directionalNeighbour: (frame, selector) => {
    if (frame.source.kind !== 'item') return []
    const ids = neighbourCells(frame.catalog, frame.state.items[frame.source.id], selector.direction).map(cell => occupant(inventoryState(frame.state, frame.state.items[frame.source.id].owner), frame.catalog, cell)).filter(Boolean)
    return [...new Set(ids)].map(id => reference('item', id))
  },
  allItems: frame => placedItems(frame.state).map(item => reference('item', item.id))
}

/** Selectors return ordered unique targets; tags filter definitions rather than instances. */
export function targets(frame, selector) {
  const prepared = preparedStates.get(frame.state)
  const fixed = prepared && !['enemy', 'eventSource', 'eventTarget'].includes(selector.kind)
  let selections
  const identity = fixed ? keyOf(frame.source) : null
  if (fixed) {
    selections = prepared.selections.get(selector)
    if (!selections) { selections = new Map(); prepared.selections.set(selector, selections) }
    if (selections.has(identity)) return selections.get(identity)
  }
  const result = selectors[selector.kind](frame, selector).filter(subject => {
    const definition = definitionOf(frame.state, frame.catalog, subject)
    return (!selector.tags || selector.tags.every(tag => definition.tags?.includes(tag))) && (!selector.ownerOnly || sameReference(ownerOf(frame.state, subject), ownerOf(frame.state, frame.source)))
  })
  if (selections) selections.set(identity, result)
  return result
}

const conditions = {
  cycleAtLeast: (frame, condition) => frame.state.cycle >= condition.amount,
  cycleEvery: (frame, condition) => frame.state.cycle % condition.amount === 0,
  eventAmountAtLeast: (frame, condition) => (frame.event?.amount ?? 0) >= condition.amount,
  hasTag: (frame, condition, subject) => definitionOf(frame.state, frame.catalog, subject).tags?.includes(condition.tag) ?? false,
  // How many placed items the subject's owner has with a tag: a family count for set powers.
  tagCountAtLeast: (frame, condition, subject) => placedItems(frame.state).filter(item => item.owner === ownerOf(frame.state, subject).id && frame.catalog.items[item.type].tags?.includes(condition.tag)).length >= condition.amount,
  hasStatus: (frame, condition, subject) => (entityOf(frame.state, subject).statuses[condition.status]?.stacks ?? 0) >= (condition.amount ?? 1),
  resourceAtLeast: (frame, condition, subject) => (entityOf(frame.state, subject).resources[condition.resource] ?? 0) >= condition.amount,
  healthBelow: (frame, condition, subject) => {
    const entity = entityOf(frame.state, subject)
    return Number.isFinite(entity.health) && entity.health < (condition.ratio === undefined ? condition.amount : entity.maxHealth * condition.ratio)
  },
  cellEmpty: (frame, condition) => {
    if (frame.source.kind !== 'item') return false
    const cells = neighbourCells(frame.catalog, frame.state.items[frame.source.id], condition.direction)
    return inside(inventoryState(frame.state, frame.state.items[frame.source.id].owner).grid, cells) && cells.every(cell => !occupant(inventoryState(frame.state, frame.state.items[frame.source.id].owner), frame.catalog, cell))
  }
}

/** Conditions are ANDed; an absent target never satisfies a condition accidentally. */
export function permits(frame, requirements = [], selected = frame.source) {
  return requirements.every(condition => {
    const subjects = condition.subject ? targets(frame, { kind: condition.subject }) : [selected]
    return subjects.length > 0 && subjects.every(subject => conditions[condition.kind](frame, condition, subject))
  })
}

export const selectorNames = Object.keys(selectors)
export const conditionNames = Object.keys(conditions)
