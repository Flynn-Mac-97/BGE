/** Selectors operate on references; family names and item IDs never select behaviour. */
import { adjacent, placedItems, neighbourCells, occupant, inside } from './grid.js'

export const reference = (kind, id) => ({ kind, id })
export const keyOf = subject => `${subject.kind}:${subject.id}`
export const sameReference = (first, second) => !!first && !!second && first.kind === second.kind && first.id === second.id
export const entityOf = (state, subject) => subject?.kind === 'item' ? state.items[subject.id] : state.actors[subject?.id]
export const ownerOf = (state, subject) => subject.kind === 'actor' ? subject : reference('actor', state.items[subject.id].owner)
export const definitionOf = (state, catalog, subject) => subject.kind === 'item' ? catalog.items[state.items[subject.id].type] : state.actors[subject.id]
export const isAlive = (state, subject) => entityOf(state, ownerOf(state, subject)).health > 0

const selectors = {
  self: frame => [frame.source],
  selfItem: frame => frame.source.kind === 'item' ? [frame.source] : [],
  owner: frame => [ownerOf(frame.state, frame.source)],
  enemy: frame => Object.values(frame.state.actors).filter(actor => actor.team !== entityOf(frame.state, ownerOf(frame.state, frame.source)).team && actor.health > 0).sort((first, second) => first.id.localeCompare(second.id)).slice(0, 1).map(actor => reference('actor', actor.id)),
  eventSource: frame => frame.event?.source ? [frame.event.source] : [],
  eventTarget: frame => frame.event?.target ? [frame.event.target] : [],
  adjacentItems: frame => frame.source.kind === 'item' ? placedItems(frame.state).filter(item => item.id !== frame.source.id && adjacent(frame.state, frame.catalog, frame.state.items[frame.source.id], item)).map(item => reference('item', item.id)) : [],
  directionalNeighbour: (frame, selector) => {
    if (frame.source.kind !== 'item') return []
    const ids = neighbourCells(frame.catalog, frame.state.items[frame.source.id], selector.direction).map(cell => occupant(frame.state, frame.catalog, cell)).filter(Boolean)
    return [...new Set(ids)].map(id => reference('item', id))
  },
  allItems: frame => placedItems(frame.state).map(item => reference('item', item.id))
}

/** Selectors return ordered unique targets; tags filter definitions rather than instances. */
export function targets(frame, selector) {
  return selectors[selector.kind](frame, selector).filter(subject => {
    const definition = definitionOf(frame.state, frame.catalog, subject)
    return (!selector.tags || selector.tags.every(tag => definition.tags?.includes(tag))) && (!selector.ownerOnly || sameReference(ownerOf(frame.state, subject), ownerOf(frame.state, frame.source)))
  })
}

const conditions = {
  hasTag: (frame, condition, subject) => definitionOf(frame.state, frame.catalog, subject).tags?.includes(condition.tag) ?? false,
  hasStatus: (frame, condition, subject) => (entityOf(frame.state, subject).statuses[condition.status]?.stacks ?? 0) >= (condition.amount ?? 1),
  resourceAtLeast: (frame, condition, subject) => (entityOf(frame.state, subject).resources[condition.resource] ?? 0) >= condition.amount,
  healthBelow: (frame, condition, subject) => {
    const entity = entityOf(frame.state, subject)
    return Number.isFinite(entity.health) && entity.health < (condition.ratio === undefined ? condition.amount : entity.maxHealth * condition.ratio)
  },
  cellEmpty: (frame, condition) => {
    if (frame.source.kind !== 'item') return false
    const cells = neighbourCells(frame.catalog, frame.state.items[frame.source.id], condition.direction)
    return inside(frame.state.grid, cells) && cells.every(cell => !occupant(frame.state, frame.catalog, cell))
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
