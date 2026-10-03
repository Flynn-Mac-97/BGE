/** A bounded work queue resolves rule data synchronously without recursive extra actions. */
import { grantedEntries, activeGrant } from './relationships.js'
import { prepareFight, compiledListeners } from './compiled.js'
import { preparedStates } from './prepared.js'
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
  if (runtime.prepared) return compiledListeners(runtime, event, path, matches)
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
  for (const entry of grantedEntries(state, catalog)) if (isAlive(state, entry.source) && activeGrant(state, entry.grantor)) entries.push({ ...entry, path })
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
  if (!frame.ability.costs?.length) return []
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
  const frame = { source: task.source, ability: task.ability, statusId: task.statusId, status: task.status, path: task.path, event: task.event, state: runtime.state, catalog: runtime.catalog, previousAmount: 0, events: [], extra: [] }
  if (!isAlive(frame.state, frame.source) || (task.grantor && !activeGrant(frame.state, task.grantor))) return
  if (task.statusId) {
    frame.status = entityOf(frame.state, frame.source).statuses[task.statusId]
    if (!frame.status || !activeStatus(frame.state, frame.catalog, frame.source, frame.status)) return
  }
  const candidates = targets(frame, task.ability.target)
  const selected = task.ability.conditions?.length ? candidates.filter(target => permits(frame, task.ability.conditions, target)) : candidates
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
  if (task.event.kind === 'ownTurn') expire(entityOf(frame.state, frame.source), 'nextAction', frame.state)
  runtime.record('ability', { source: task.source, target: selected[0], ability: task.ability, statusId: task.statusId, ...(task.grantor ? { grantor: task.grantor } : {}), ...(frame.status?.source ? { origin: frame.status.source } : {}), effects })
  for (let index = frame.extra.length - 1; index >= 0; index--) runtime.queue.push(frame.extra[index])
  for (let index = frame.events.length - 1; index >= 0; index--) runtime.queue.push({ kind: 'event', event: frame.events[index], path: task.path })
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
  runtime.queue.push(
    { kind: 'event', event: { kind: 'itemActivated', source: task.subject, target: task.subject }, path },
    { kind: 'event', event: { kind: 'ownTurn', source: task.subject, target: task.subject }, path }
  )
}

function dispatch(runtime, task) {
  if (task.event.kind === 'cycleEnd' && winner(runtime.state)) return
  if (task.event.kind === 'cycleStart') runtime.record('cycleStart')
  const abilities = listeners(runtime, task.event, task.path)
  if (!abilities.length && task.event.kind === 'ownTurn') runtime.record('idle', { source: task.event.source })
  for (let index = abilities.length - 1; index >= 0; index--) runtime.queue.push(abilities[index])
}

function finishCycle(runtime) {
  const { state } = runtime
  const expired = []
  for (const [kind, entities] of [['actor', state.actors], ['item', state.items]]) {
    for (const entity of Object.values(entities)) {
      const removed = expire(entity, 'cycle', state)
      if (removed.length) expired.push({ subject: reference(kind, entity.id), removed })
    }
  }
  if (expired.length) runtime.record('expired', { expired })
  const result = winner(state)
  for (const actor of Object.values(state.actors)) actor.guard = 0
  state.phase = result ? 'complete' : 'planning'
  if (result) {
    for (const entity of [...Object.values(state.actors), ...Object.values(state.items)]) expire(entity, 'combat', state)
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
  if (options.trace !== undefined && !['full', 'events', 'none'].includes(options.trace)) throw new TypeError('Unknown trace mode')
  const budget = options.budget ?? 1024
  const maxActivations = options.maxActivations ?? 8
  if (!Number.isInteger(budget) || budget < 1 || budget > 4096 || !Number.isInteger(maxActivations) || maxActivations < 1 || maxActivations > 16) throw new RangeError('Invalid rule work limits')
  const state = structuredClone(input)
  const trace = []
  const runtime = { state, catalog, queue: queue.reverse(), maxActivations, activations: {}, record(kind, detail = {}) {
    if (options.trace === 'none') return
    trace.push({ kind, ...structuredClone(detail), ...(options.trace === 'events' ? {} : { state: structuredClone(state) }) })
  } }
  const work = runQueue(runtime, budget)
  return { state, trace, work }
}

function runQueue(runtime, budget) {
  const queue = runtime.queue
  let work = 0
  while (queue.length) {
    if (++work > budget) throw new RangeError(`Rule work budget exceeded (${budget}); add a limit or condition to the reaction chain`)
    const task = queue.pop()
    tasks[task.kind](runtime, task)
  }
  return work
}

/** One cycle: start events, placed items, ongoing statuses, optional actor turns, then expiry. */
export function resolveCycle(catalog, input, options = {}) {
  if (input.phase === 'complete') return { state: structuredClone(input), trace: [], work: 0 }
  if (input.phase !== 'planning') throw new Error('Only a planning state can start a cycle')
  const state = structuredClone(input)
  const queue = cycleQueue(state, options)
  return execute(catalog, state, queue, options)
}

function cycleQueue(state, options) {
  const queue = []
  if (!state.started) queue.push({ kind: 'event', event: { kind: 'combatStart' }, path: [] })
  state.started = true
  state.phase = 'resolving'
  state.acted = []
  queue.push({ kind: 'event', event: { kind: 'cycleStart' }, path: [] })
  const order = options.ownerOrder
  if (order) {
    const owners = Object.keys(state.actors)
    if (options.afterCycle?.length || !Array.isArray(order) || order.length !== owners.length || new Set(order).size !== owners.length || order.some(id => !state.actors[id])) throw new TypeError('ownerOrder must contain every actor exactly once, without afterCycle')
    for (const owner of order) {
      queue.push(...placedItems(state).filter(item => item.owner === owner).map(item => ({ kind: 'activation', subject: reference('item', item.id), path: [], extra: false })))
      queue.push({ kind: 'activation', subject: reference('actor', owner), path: [], extra: false })
    }
  } else queue.push(...placedItems(state).map(item => ({ kind: 'activation', subject: reference('item', item.id), path: [], extra: false })))
  queue.push({ kind: 'event', event: { kind: 'cycleEnd' }, path: [] })
  for (const id of options.afterCycle ?? []) {
    if (!state.actors[id]) throw new TypeError('Unknown actor turn ' + id)
    queue.push({ kind: 'activation', subject: reference('actor', id), path: [], extra: false })
  }
  queue.push({ kind: 'finishCycle' })
  return queue
}


/** Validate and capture once; each call starts an independent fight from that snapshot. */
export function createFightRunner(catalog, input) {
  assertState(input, catalog)
  const snapshot = structuredClone(input)
  return options => runFight(catalog, snapshot, options)
}

/** Own one private copy; record details are borrowed and must not be mutated. */
export function resolveFight(catalog, input, options) {
  assertState(input, catalog)
  return runFight(catalog, input, options)
}

function runFight(catalog, input, { ownerOrder, afterCycle, maxCycles = 30, record = () => {} } = {}) {
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) throw new RangeError('Invalid cycle limit')
  if (!['planning', 'complete'].includes(input.phase)) throw new TypeError('Fight must start from planning or complete state')
  const state = structuredClone(input)
  let work = 0, cycles = 0
  try {
    const prepared = prepareFight(state, catalog)
    const runtime = { state, catalog, prepared, queue: [], maxActivations: 8, activations: {}, record }
    let firstPlan, cyclePlan
    while (!winner(state) && cycles < maxCycles) {
      if (!firstPlan) {
        firstPlan = cycleQueue(state, { ownerOrder, afterCycle }).reverse()
        cyclePlan = firstPlan.filter(task => task.kind !== 'event' || task.event.kind !== 'combatStart')
      }
      state.phase = 'resolving'; state.acted = []
      runtime.queue = (cycles ? cyclePlan : firstPlan).slice()
      runtime.activations = {}
      work += runQueue(runtime, 1024)
      cycles++
    }
    return { state, work, cycles }
  } finally { preparedStates.delete(state) }
}
