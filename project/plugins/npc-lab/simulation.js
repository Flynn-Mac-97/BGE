/** Cheap measurements use the production resolver with event-only traces and hard work limits. */
import { rules } from '../bell/rules.js'
import { actorFor, validateLoadout } from './loadouts.js'

function prepareLoadout(kit, owner) {
  const reading = validateLoadout(kit)
  if (!reading.valid) throw new TypeError(reading.errors.join('; '))
  return rules.createState({ actors: { [owner]: actorFor(kit.actor, owner) }, items: kit.items.map(item => ({ id: `${owner}-${item.key}`, type: item.type, owner, position: item.position })) })
}
function preparedDuel(first, second) {
  return { ...first, actors: { ...first.actors, ...second.actors }, items: { ...first.items, ...second.items } }
}

/** Two actors keep independent inventories even when their item coordinates are identical. */
export function createDuel(first, second) {
  return preparedDuel(prepareLoadout(first, 'first'), prepareLoadout(second, 'second'))
}
const measurements = () => ({ damage: 0, blocked: 0, healing: 0, guard: 0, statuses: 0, activations: 0, missed: 0, loopBlocks: 0 })
function accumulate(state, metrics, kind, event = {}) {
  if (!event.source) return
  const source = event.origin ?? event.source
  const owner = source.kind === 'item' ? state.items[source.id].owner : source.id
  const metric = metrics[owner]
  if (kind === 'miss') metric.missed++
  if (kind === 'blocked') metric.loopBlocks++
  if (kind !== 'ability') return
  metric.activations++
  for (const effect of event.effects) {
    if (effect.type === 'damage') { metric.damage += effect.amount; metric.blocked += effect.blocked }
    if (effect.type === 'heal') metric.healing += effect.amount
    if (effect.type === 'guard') metric.guard += effect.amount
    if (effect.type === 'applyStatus') metric.statuses += effect.amount
  }
}
function simulateState(input, { firstActor = 'first', maxCycles = 30, replay = false, reference = false } = {}, preparedRun) {
  if (!['first', 'second'].includes(firstActor) || !Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) throw new RangeError('Invalid simulation bounds')
  let state = input, cycles = 0, work = 0
  const metrics = { first: measurements(), second: measurements() }, trace = []
  const ownerOrder = firstActor === 'first' ? ['first', 'second'] : ['second', 'first']
  if (!replay && !reference) {
    const resolve = preparedRun ?? (options => rules.resolveFight(state, options))
    const result = resolve({ ownerOrder, maxCycles, record: (kind, event) => accumulate(input, metrics, kind, event) })
    state = result.state; cycles = result.cycles; work = result.work
  } else while (!rules.winner(state) && cycles < maxCycles) {
    const result = rules.resolveCycle(state, { ownerOrder, trace: replay ? 'full' : 'events' })
    state = result.state; work += result.work; cycles++
    for (const event of result.trace) accumulate(state, metrics, event.kind, event)
    if (replay) trace.push(...result.trace)
  }
  return { winner: rules.winner(state) ?? 'stalemate', cycles, work, firstActor, health: { first: state.actors.first.health, second: state.actors.second.health }, metrics, state, ...(replay ? { trace } : {}) }
}

/** The fast private-state path and reference/replay path return identical combat results. */
export function simulateDuel(first, second, options = {}) {
  return simulateState(createDuel(first, second), options)
}

/** Capture validated reference templates once for a batch; later caller edits cannot change them. */
export function createEvaluator(references, options = {}) {
  if (!Array.isArray(references) || !references.length || references.length > 16) throw new RangeError('Use 1–16 reference kits')
  const prepared = references.map(kit => prepareLoadout(kit, 'second'))
  const settings = { ...options }
  return candidate => {
    const first = prepareLoadout(candidate, 'first')
    const matches = prepared.flatMap((second, index) => {
      const initial = preparedDuel(first, second)
      const run = settings.reference ? null : rules.createFightRunner(initial)
      return ['first', 'second'].map(firstActor => {
        const result = simulateState(initial, { ...settings, firstActor, replay: false }, run)
        const { state, ...report } = result
        return { reference: index, ...report }
      })
    })
    const wins = matches.filter(match => match.winner === 'first').length
    const draws = matches.filter(match => match.winner === 'draw').length
    const stalemates = matches.filter(match => match.winner === 'stalemate').length
    return { matches, wins, losses: matches.length - wins - draws - stalemates, draws, stalemates, winRate: wins / matches.length,
      averageCycles: matches.reduce((sum, match) => sum + match.cycles, 0) / matches.length, work: matches.reduce((sum, match) => sum + match.work, 0) }
  }
}

/** Compare both initiatives against each reference; win rate is relative to that explicit roster. */
export function evaluateLoadout(candidate, references, options = {}) {
  return createEvaluator(references, options)(candidate)
}
