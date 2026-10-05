/** Stats are derived from base values, temporary modifiers, statuses and placed auras. */
import { preparedStates } from './prepared.js'
import { entityOf, targets, reference, sameReference } from './targets.js'
import { adjacent, placedItems } from './grid.js'

/**
 * A die roll from 1 to `sides`. The battle keeps `rolls: { seed, count }`; each roll hashes the seed with
 * the count and advances the count, so a fight replays exactly and the compiled path rolls the same numbers.
 */
export function rollDie(state, sides) {
  state.rolls ??= { seed: 1, count: 0 }
  let value = (state.rolls.seed + Math.imul(++state.rolls.count, 0x9e3779b9)) | 0
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return 1 + ((value ^ (value >>> 16)) >>> 0) % sides
}

/**
 * Expressions deliberately have no arbitrary scripts or recursive stat references. `target` is the effect's target:
 * `{ targetStat, scale }` reads it. A `scale` on a stat, resource or target stat rounds down, so health stays whole.
 */
export function amountOf(frame, expression, subject = frame.source, target = null) {
  if (typeof expression === 'number') return expression
  if (expression.previous) return (frame.previousAmount ?? 0) * (expression.scale ?? 1)
  if (expression.eventAmount) return (frame.event?.amount ?? 0) * (expression.scale ?? 1)
  if (expression.stacks) return frame.status?.stacks ?? 0
  if (expression.roll) return rollDie(frame.state, expression.roll) * (expression.scale ?? 1)
  if (expression.targetStat) return target ? Math.floor(statOf(frame.state, frame.catalog, target, expression.targetStat) * (expression.scale ?? 1)) : 0
  if (expression.stat && expression.scale !== undefined) return Math.floor(statOf(frame.state, frame.catalog, subject, expression.stat) * expression.scale)
  if (expression.stat) return statOf(frame.state, frame.catalog, subject, expression.stat)
  // A granted ability reads the item that grants it, so a totem's level grows what it gives.
  if (expression.grantorStat) return frame.grantor ? statOf(frame.state, frame.catalog, frame.grantor, expression.grantorStat) : 0
  if (expression.resource) return Math.floor((entityOf(frame.state, subject).resources[expression.resource] ?? 0) * (expression.scale ?? 1))
  return 0
}

/** Adjacency durations suspend their contribution whenever either item leaves the edge. */
export function activeStatus(state, catalog, subject, status) {
  if (status.duration !== 'whileAdjacent') return true
  const source = status.source?.kind === 'item' ? state.items[status.source.id] : null
  const target = subject.kind === 'item' ? state.items[subject.id] : null
  return !!source && !!target && state.actors[source.owner].health > 0 && adjacent(state, catalog, source, target)
}

/** An aura's amount: a constant, or a stat of its source item read without auras or modifiers, so two adjacent aura sources cannot recurse. */
export const auraAmount = (aura, sourceItem) => typeof aura.amount === 'number' ? aura.amount : sourceItem.stats[aura.amount.stat] ?? 0

/** Auras are summed from base values, so two adjacent aura sources cannot recurse. */
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
  for (const id in entity.statuses) {
    const status = entity.statuses[id]
    if (!activeStatus(state, catalog, subject, status)) continue
    for (const modifier of catalog.statuses[id].modifiers ?? []) {
      if (modifier.stat === stat) value += typeof modifier.amount === 'number' ? modifier.amount : status.stacks * (modifier.amount.scale ?? 1)
    }
  }
  const prepared = preparedStates.get(state)
  if (prepared) {
    for (const aura of prepared.auras.get(`${subject.kind}:${subject.id}:${stat}`) ?? []) if (state.actors[aura.owner].health > 0) value += aura.amount
    for (const entry of prepared.dynamicAuras) {
      if (entry.aura.stat !== stat || state.actors[entry.owner].health <= 0) continue
      if (targets({ state, catalog, source: entry.source }, entry.aura.target).some(target => sameReference(target, subject))) value += auraAmount(entry.aura, state.items[entry.source.id])
    }
    return value
  }
  for (const source of placedItems(state)) {
    for (const aura of catalog.items[source.type].auras ?? []) {
      if (aura.stat !== stat || state.actors[source.owner].health <= 0) continue
      const frame = { state, catalog, source: reference('item', source.id) }
      if (targets(frame, aura.target).some(target => sameReference(target, subject))) value += auraAmount(aura, source)
    }
  }
  return value
}

/** Consumption and expiry use the same duration vocabulary for statuses and stat modifiers. */
export function expire(entity, duration, state) {
  const removed = []
  if (entity.modifiers.length) entity.modifiers = entity.modifiers.filter(modifier => {
    const expires = modifier.duration === duration || modifier.expires === duration
    if (expires) removed.push({ kind: 'modifier', stat: modifier.stat })
    return !expires
  })
  for (const id in entity.statuses) {
    const status = entity.statuses[id]
    if (status.duration === duration || status.expires === duration) { delete entity.statuses[id]; removed.push({ kind: 'status', id }); const prepared = preparedStates.get(state); if (prepared) prepared.statusListeners = null }
  }
  return removed
}
