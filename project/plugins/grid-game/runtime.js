/** A bounded work queue resolves rule data synchronously without recursive extra actions. */
import { placedItems } from './grid.js'
import { entityOf, definitionOf, reference, keyOf, sameReference, targets, permits, isAlive } from './targets.js'
import { expire, activeStatus } from './values.js'
import { applyEffect } from './effects.js'
import { assertState, winner } from './state.js'

function matches(frame, trigger) {
  if (trigger.event !== frame.event.kind) return false
  if (trigger.status && trigger.status !== frame.event.status) return false
  if (trigger.source) return targets(frame, trigger.source).some(subject => sameReference(subject, frame.event.source))
  const defaults = { ownTurn: 'source', itemActivated: 'source', damageDealt: 'source', damageTaken: 'target', statusApplied: 'source' }
  const field = defaults[trigger.event]
  return !field || sameReference(frame.source, frame.event[field])
}

function listeners(runtime, event, path) {
  const { state, catalog } = runtime
  const subjects = [...placedItems(state).map(item => reference('item', item.id)), ...Object.keys(state.actors).sort().map(id => reference('actor', id))]
  const entries = []
  for (const source of subjects) {
    if (!isAlive(state, source)) continue
    for (const [id, status] of Object.entries(entityOf(state, source).statuses)) {
      if (!activeStatus(state, catalog, source, status)) continue
      for (const ability of catalog.statuses[id].abilities) entries.push({ source, ability, statusId: id, status, path })
    }
  }
  for (const source of subjects) {
    if (!isAlive(state, source)) continue
    for (const ability of definitionOf(state, catalog, source).abilities) entries.push({ source, ability, statusId: null, status: null, path })
  }
  return entries.filter(entry => matches({ state, catalog, ...entry, event }, entry.ability.trigger)).map(entry => ({ kind: 'ability', ...entry, event }))
}

function usage(frame) {
  const identity = (frame.statusId ?? 'item') + ':' + frame.ability.id
  const limit = frame.ability.limit ?? {}
  const previous = entityOf(frame.state, frame.source).uses[identity]
  const use = previous ? { ...previous } : { cycle: frame.state.cycle, cycleCount: 0, combatCount: 0, charges: limit.charges ?? null }
  if (use.cycle !== frame.state.cycle) {
    use.cycle = frame.state.cycle
    use.cycleCount = 0
    if (limit.refill === 'cycle') use.charges = limit.charges
  }
  const allowed = use.cycleCount < (limit.perCycle ?? Infinity) && use.combatCount < (limit.perCombat ?? Infinity) && (use.charges === null || use.charges > 0)
  return { identity, use, allowed }
}

function costsFor(frame) {
  const totals = new Map()
  for (const cost of frame.ability.costs ?? []) {
    const selected = targets(frame, cost.target)
    if (selected.length !== 1) return null
    const identity = keyOf(selected[0]) + ':' + cost.resource
    const previous = totals.get(identity)
    totals.set(identity, { subject: selected[0], resource: cost.resource, amount: cost.amount + (previous?.amount ?? 0) })
  }
  const costs = [...totals.values()]
  return costs.every(cost => (entityOf(frame.state, cost.subject).resources[cost.resource] ?? 0) >= cost.amount) ? costs : null
}

function runAbility(runtime, task) {
  const frame = { ...task, state: runtime.state, catalog: runtime.catalog, events: [], extra: [] }
  if (!isAlive(frame.state, frame.source)) return
  if (task.statusId) {
    frame.status = entityOf(frame.state, frame.source).statuses[task.statusId]
    if (!frame.status || !activeStatus(frame.state, frame.catalog, frame.source, frame.status)) return
  }
  const selected = targets(frame, task.ability.target).filter(target => permits(frame, task.ability.conditions, target))
  const used = usage(frame)
  const costs = costsFor(frame)
  if (!selected.length || !used.allowed || !costs) {
    if (task.event.kind === 'ownTurn') runtime.record('miss', { source: task.source, ability: task.ability, reason: !selected.length ? 'no eligible target' : !used.allowed ? 'limit reached' : 'resource cost' })
    return
  }
  for (const cost of costs) entityOf(frame.state, cost.subject).resources[cost.resource] -= cost.amount
  used.use.cycleCount++
  used.use.combatCount++
  if (used.use.charges !== null) used.use.charges--
  entityOf(frame.state, frame.source).uses[used.identity] = used.use
  const effects = []
  for (const effect of task.ability.effects) {
    const affected = effect.target ? targets(frame, effect.target) : selected
    for (const target of affected) effects.push(applyEffect(frame, effect, target))
  }
  if (task.event.kind === 'ownTurn') expire(entityOf(frame.state, frame.source), 'nextAction')
  runtime.record('ability', { source: task.source, target: selected[0], ability: task.ability, statusId: task.statusId, effects })
  runtime.queue.unshift(...frame.events.map(event => ({ kind: 'event', event, path: task.path })), ...frame.extra)
}

function activate(runtime, task) {
  const { state } = runtime
  if (!isAlive(state, task.subject) || winner(state)) return
  if (task.subject.kind === 'item' && !state.items[task.subject.id].position) return
  const identity = keyOf(task.subject)
  const count = runtime.activations[identity] ?? 0
  if (task.path.includes(identity) || (task.extra && count >= runtime.maxActivations)) {
    runtime.record('blocked', { source: task.subject, reason: task.path.includes(identity) ? 'circular activation' : 'activation limit' })
    return
  }
  runtime.activations[identity] = count + 1
  if (task.subject.kind === 'item' && !state.acted.includes(task.subject.id)) state.acted.push(task.subject.id)
  const path = [...task.path, identity]
  runtime.queue.unshift(
    { kind: 'event', event: { kind: 'ownTurn', source: task.subject, target: task.subject }, path },
    { kind: 'event', event: { kind: 'itemActivated', source: task.subject, target: task.subject }, path }
  )
}

function dispatch(runtime, task) {
  if (task.event.kind === 'cycleEnd' && winner(runtime.state)) return
  if (task.event.kind === 'cycleStart') runtime.record('cycleStart')
  const abilities = listeners(runtime, task.event, task.path)
  if (!abilities.length && task.event.kind === 'ownTurn') runtime.record('idle', { source: task.event.source })
  runtime.queue.unshift(...abilities)
}

function finishCycle(runtime) {
  const { state } = runtime
  const expired = []
  for (const [kind, entities] of [['actor', state.actors], ['item', state.items]]) {
    for (const entity of Object.values(entities)) {
      const removed = expire(entity, 'cycle')
      if (removed.length) expired.push({ subject: reference(kind, entity.id), removed })
    }
  }
  if (expired.length) runtime.record('expired', { expired })
  const result = winner(state)
  for (const actor of Object.values(state.actors)) actor.guard = 0
  state.phase = result ? 'complete' : 'planning'
  if (result) {
    for (const entity of [...Object.values(state.actors), ...Object.values(state.items)]) expire(entity, 'combat')
    runtime.record('combatEnd', { winner: result })
    return
  }
  state.cycle++
  state.acted = []
  runtime.record('planning')
}

const tasks = { ability: runAbility, activation: activate, event: dispatch, finishCycle }

/** Input and prior snapshots are untouched, including when a malformed loop exceeds its budget. */
export function execute(catalog, input, queue, options = {}) {
  assertState(input, catalog)
  const budget = options.budget ?? 1024
  const maxActivations = options.maxActivations ?? 8
  if (!Number.isInteger(budget) || budget < 1 || budget > 4096 || !Number.isInteger(maxActivations) || maxActivations < 1 || maxActivations > 16) throw new RangeError('Invalid rule work limits')
  const state = structuredClone(input)
  const trace = []
  const runtime = { state, catalog, queue, maxActivations, activations: {}, record(kind, detail = {}) { trace.push({ kind, ...structuredClone(detail), state: structuredClone(state) }) } }
  let work = 0
  while (queue.length) {
    if (++work > budget) throw new RangeError(`Rule work budget exceeded (${budget}); add a limit or condition to the reaction chain`)
    const task = queue.shift()
    tasks[task.kind](runtime, task)
  }
  return { state, trace, work }
}

/** One cycle: start events, placed items, ongoing statuses, optional actor turns, then expiry. */
export function resolveCycle(catalog, input, options = {}) {
  if (input.phase === 'complete') return { state: structuredClone(input), trace: [], work: 0 }
  if (input.phase !== 'planning') throw new Error('Only a planning state can start a cycle')
  const state = structuredClone(input)
  const queue = []
  if (!state.started) queue.push({ kind: 'event', event: { kind: 'combatStart' }, path: [] })
  state.started = true
  state.phase = 'resolving'
  state.acted = []
  queue.push({ kind: 'event', event: { kind: 'cycleStart' }, path: [] })
  queue.push(...placedItems(state).map(item => ({ kind: 'activation', subject: reference('item', item.id), path: [], extra: false })))
  queue.push({ kind: 'event', event: { kind: 'cycleEnd' }, path: [] })
  for (const id of options.afterCycle ?? []) {
    if (!state.actors[id]) throw new TypeError('Unknown actor turn ' + id)
    queue.push({ kind: 'activation', subject: reference('actor', id), path: [], extra: false })
  }
  queue.push({ kind: 'finishCycle' })
  return execute(catalog, state, queue, options)
}
