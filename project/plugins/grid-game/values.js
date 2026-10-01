/** Stats are derived from base values, temporary modifiers, statuses and placed auras. */
import { entityOf, targets, reference, sameReference } from './targets.js'
import { adjacent, placedItems } from './grid.js'

/** Expressions deliberately have no arbitrary scripts or recursive stat references. */
export function amountOf(frame, expression, subject = frame.source) {
  if (typeof expression === 'number') return expression
  if (expression.stacks) return frame.status?.stacks ?? 0
  if (expression.stat) return statOf(frame.state, frame.catalog, subject, expression.stat)
  if (expression.resource) return entityOf(frame.state, subject).resources[expression.resource] ?? 0
  return 0
}

/** Adjacency durations suspend their contribution whenever either item leaves the edge. */
export function activeStatus(state, catalog, subject, status) {
  if (status.duration !== 'whileAdjacent') return true
  const source = status.source?.kind === 'item' ? state.items[status.source.id] : null
  const target = subject.kind === 'item' ? state.items[subject.id] : null
  return !!source && !!target && state.actors[source.owner].health > 0 && adjacent(state, catalog, source, target)
}

/** Auras are summed from base constants, so two adjacent aura sources cannot recurse. */
export function statOf(state, catalog, subject, stat) {
  const entity = entityOf(state, subject)
  let value = entity.stats[stat] ?? 0
  for (const modifier of entity.modifiers) {
    if (modifier.stat !== stat) continue
    if (modifier.duration === 'whileAdjacent') {
      const source = state.items[modifier.source.id]
      if (subject.kind !== 'item' || !source || !adjacent(state, catalog, source, entity)) continue
    }
    value += modifier.amount
  }
  for (const [id, status] of Object.entries(entity.statuses)) {
    if (!activeStatus(state, catalog, subject, status)) continue
    for (const modifier of catalog.statuses[id].modifiers ?? []) {
      if (modifier.stat === stat) value += typeof modifier.amount === 'number' ? modifier.amount : status.stacks
    }
  }
  for (const source of placedItems(state)) {
    for (const aura of catalog.items[source.type].auras ?? []) {
      if (aura.stat !== stat || state.actors[source.owner].health <= 0) continue
      const frame = { state, catalog, source: reference('item', source.id) }
      if (targets(frame, aura.target).some(target => sameReference(target, subject))) value += aura.amount
    }
  }
  return value
}

/** Consumption and expiry use the same duration vocabulary for statuses and stat modifiers. */
export function expire(entity, duration) {
  const removed = []
  entity.modifiers = entity.modifiers.filter(modifier => {
    const expires = modifier.duration === duration || modifier.expires === duration
    if (expires) removed.push({ kind: 'modifier', stat: modifier.stat })
    return !expires
  })
  for (const [id, status] of Object.entries(entity.statuses)) {
    if (status.duration === duration || status.expires === duration) { delete entity.statuses[id]; removed.push({ kind: 'status', id }) }
  }
  return removed
}
