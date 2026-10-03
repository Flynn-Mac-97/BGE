/** Index fixed abilities and geometry once; dynamic status listeners still follow live state order. */
import { relationshipGraph, grantedEntries, activeGrant } from './relationships.js'
import { placedItems } from './grid.js'
import { entityOf, definitionOf, reference, targets, keyOf, isAlive } from './targets.js'
import { activeStatus } from './values.js'
import { preparedStates } from './prepared.js'

export function prepareFight(state, catalog) {
  const items = placedItems(state)
  const subjects = [...items.map(item => reference('item', item.id)), ...Object.keys(state.actors).sort().map(id => reference('actor', id))]
  const entries = {}, statusEvents = {}, statusKinds = new Set(), selections = new WeakMap(), auras = new Map()
  for (const source of subjects) for (const ability of definitionOf(state, catalog, source).abilities) {
    const event = ability.trigger.event
    ;(entries[event] ??= []).push({ source, ability, statusId: null, status: null })
  }
  for (const [id, status] of Object.entries(catalog.statuses)) {
    const events = {}
    for (const ability of status.abilities) { (events[ability.trigger.event] ??= []).push(ability); statusKinds.add(ability.trigger.event) }
    statusEvents[id] = events
  }
  const prepared = { items, subjects, entries, statusEvents, statusKinds, selections, auras, dynamicAuras: [], actors: Object.values(state.actors), enemies: {}, statusListeners: null, listeners: {}, subjectIds: new Map(subjects.map((subject, index) => [keyOf(subject), index + 1])), teams: new Set(Object.values(state.actors).map(actor => actor.team)).size }
  const actors = Object.values(state.actors).sort((first, second) => first.id.localeCompare(second.id))
  for (const owner of actors) prepared.enemies[owner.id] = actors.filter(actor => actor.team !== owner.team).map(actor => ({ actor, selection: [reference('actor', actor.id)] }))
  preparedStates.set(state, prepared)
  if (items.some(item => catalog.items[item.type].grants.length)) {
    prepared.graph = relationshipGraph(state, catalog)
    for (const entry of grantedEntries(state, catalog, prepared.graph)) (entries[entry.ability.trigger.event] ??= []).push(entry)
  }
  for (const item of items) for (const aura of catalog.items[item.type].auras) {
    const source = reference('item', item.id)
    if (aura.target.kind === 'enemy') { prepared.dynamicAuras.push({ source, owner: item.owner, aura }); continue }
    for (const target of targets({ state, catalog, source }, aura.target)) {
      const key = keyOf(target) + ':' + aura.stat
      if (!auras.has(key)) auras.set(key, [])
      auras.get(key).push({ owner: item.owner, amount: aura.amount })
    }
  }
  return prepared
}

// The enemy selector picks the first living hostile, so its match cannot be cached.
const hasLiveSelector = trigger => trigger.source?.kind === 'enemy' || trigger.target?.kind === 'enemy'

/** Cache static trigger matches; live enemy selectors and owner survival remain dynamic. */
function candidates(runtime, event, matches) {
  const { state, catalog, prepared } = runtime
  const entries = prepared.entries[event.kind]
  if (!entries) return []
  const source = event.source ? prepared.subjectIds.get(keyOf(event.source)) : 0
  const target = event.target ? prepared.subjectIds.get(keyOf(event.target)) : 0
  const identity = (source * (prepared.subjects.length + 1) + target) + ':' + (event.status ?? '')
  const cache = prepared.listeners[event.kind] ??= new Map()
  let result = cache.get(identity)
  if (!result) {
    result = entries.filter(entry => hasLiveSelector(entry.ability.trigger) || matches({ state, catalog, source: entry.source, event }, entry.ability.trigger))
    cache.set(identity, result)
  }
  return result
}

/** Candidate order matches the reference: all status listeners, then ordinary listeners. */
export function compiledListeners(runtime, event, path, matches) {
  const { state, catalog, prepared } = runtime
  const result = []
  if (prepared.statusKinds.has(event.kind)) {
    if (!prepared.statusListeners) {
      prepared.statusListeners = {}
      for (const source of prepared.subjects) for (const id of Object.keys(entityOf(state, source).statuses)) {
        for (const [kind, abilities] of Object.entries(prepared.statusEvents[id])) {
          for (const ability of abilities) (prepared.statusListeners[kind] ??= []).push({ source, id, ability })
        }
      }
    }
    for (const { source, id, ability } of prepared.statusListeners[event.kind] ?? []) {
      const status = entityOf(state, source).statuses[id]
      if (!isAlive(state, source) || !activeStatus(state, catalog, source, status)) continue
      if (matches({ state, catalog, source, event }, ability.trigger)) result.push({ kind: 'ability', source, ability, statusId: id, status, path, event })
    }
  }
  for (const entry of candidates(runtime, event, matches)) {
    if (!isAlive(state, entry.source) || (entry.grantor && !activeGrant(state, entry.grantor))) continue
    if (hasLiveSelector(entry.ability.trigger) && !matches({ state, catalog, source: entry.source, event }, entry.ability.trigger)) continue
    result.push({ kind: 'ability', source: entry.source, ability: entry.ability, statusId: null, status: null, ...(entry.grantor ? { grantor: entry.grantor } : {}), path, event })
  }
  return result
}
