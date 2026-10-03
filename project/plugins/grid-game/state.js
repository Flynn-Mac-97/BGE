/** Serializable run records separate owned item instances from immutable item definitions. */
import { preparedStates } from './prepared.js'
import { placeItem } from './grid.js'
import { abilitiesOf } from './catalog.js'

const validId = id => typeof id === 'string' && /^[a-z][a-z0-9_-]*$/i.test(id)
const numericMap = values => Object.values(values).every(value => Number.isFinite(value))
const unit = (id, properties) => ({ id, stats: {}, resources: {}, resourceCaps: {}, statuses: {}, modifiers: [], uses: {}, ...structuredClone(properties) })

/** Add a distinct reserve instance; placement is a separate atomic operation. */
export function addItem(state, catalog, id, type, owner) {
  if (!validId(id) || state.items[id] || !catalog.items[type] || !state.actors[owner] || state.phase !== 'planning') return false
  const definition = catalog.items[type]
  state.items[id] = unit(id, { type, owner, position: null, stats: definition.stats, resources: definition.resources, resourceCaps: definition.resourceCaps })
  return true
}

/** Battle setup is explicit: actors own health/resources, instances own footprints and charges. */
export function createState(catalog, setup) {
  const columns = setup.columns ?? 3
  const rows = setup.rows ?? 3
  if (![columns, rows].every(value => Number.isInteger(value) && value >= 1 && value <= 12)) throw new RangeError('Grid dimensions must be integers from 1 to 12')
  const state = { version: 1, baseColumns: columns, grid: { columns, rows }, actors: {}, items: {}, cycle: 1, started: false, phase: 'planning', acted: [] }
  for (const [id, actor] of Object.entries(setup.actors ?? {})) {
    if (!validId(id) || !Number.isFinite(actor.maxHealth) || actor.maxHealth <= 0 || typeof actor.team !== 'string') throw new TypeError('Invalid actor ' + id)
    const record = unit(id, { tags: [], stats: {}, resources: {}, resourceCaps: {}, abilities: [], ...actor, health: actor.health ?? actor.maxHealth, guard: 0 })
    if (!Number.isFinite(record.health) || record.health < 0 || record.health > record.maxHealth || !numericMap(record.stats) || !numericMap(record.resources)) throw new TypeError('Invalid actor values ' + id)
    record.abilities = abilitiesOf(record.abilities, catalog, 'actor.' + id)
    if (record.inventory) {
      const baseColumns = record.inventory.baseColumns ?? record.inventory.columns
      if (![baseColumns, record.inventory.rows].every(value => Number.isInteger(value) && value >= 1 && value <= 12)) throw new RangeError('Invalid actor inventory')
      record.inventory = { columns: baseColumns, rows: record.inventory.rows, baseColumns }
    }
    state.actors[id] = record
  }
  if (!Object.keys(state.actors).length) throw new TypeError('At least one actor is required')
  for (const item of setup.items ?? []) {
    if (!addItem(state, catalog, item.id, item.type, item.owner)) throw new TypeError('Invalid item instance ' + item.id)
  }
  const pending = (setup.items ?? []).filter(item => item.position)
  while (pending.length) {
    const index = pending.findIndex(item => placeItem(state, catalog, item.id, item.position))
    if (index < 0) throw new RangeError('Invalid or unsupported item placement')
    pending.splice(index, 1)
  }
  if (Object.values(state.actors).some(actor => actor.inventory) && Object.values(state.actors).some(actor => !actor.inventory)) throw new TypeError('Actor inventories must be supplied for every actor')
  return state
}

/** A fight ends when only one of the participating teams has a living actor. */
export function winner(state) {
  const prepared = preparedStates.get(state)
  if (prepared) {
    if (prepared.teams < 2) return null
    let living = null
    for (const actor of prepared.actors) {
      if (actor.health <= 0) continue
      if (living !== null && living !== actor.team) return null
      living = actor.team
    }
    return living ?? 'draw'
  }
  const teams = new Set(Object.values(state.actors).map(actor => actor.team))
  if (teams.size < 2) return null
  const living = [...new Set(Object.values(state.actors).filter(actor => actor.health > 0).map(actor => actor.team))]
  return living.length < 2 ? living[0] ?? 'draw' : null
}

/** Core operations reject malformed loaded state before a queue can start. */
export function assertState(state, catalog) {
  if (!['planning', 'resolving', 'complete'].includes(state.phase)) throw new TypeError('Invalid battle phase')
  for (const actor of Object.values(state.actors)) if (!Number.isFinite(actor.guard) || actor.guard < 0) throw new TypeError('Invalid actor guard')
  if (state.version !== 1 || !Number.isInteger(state.cycle) || state.cycle < 1) throw new TypeError('Invalid grid state version or cycle')
  if (![state.grid.columns, state.grid.rows].every(value => Number.isInteger(value) && value >= 1 && value <= 12)) throw new RangeError('Invalid saved grid dimensions')
  const check = createState(catalog, { ...state.grid, columns: state.baseColumns ?? state.grid.columns, actors: state.actors, items: Object.values(state.items).map(item => ({ id: item.id, type: item.type, owner: item.owner, position: item.position })) })
  for (const entity of [...Object.values(state.actors), ...Object.values(state.items)]) {
    if (!numericMap(entity.stats) || !numericMap(entity.resources) || !numericMap(entity.resourceCaps) || Object.values(entity.resources).some(value => value < 0)) throw new TypeError('Invalid unit numbers ' + entity.id)
    for (const [resource, amount] of Object.entries(entity.resources)) if (amount > (entity.resourceCaps[resource] ?? Infinity)) throw new TypeError('Resource exceeds cap')
    for (const [id, status] of Object.entries(entity.statuses)) if (!catalog.statuses[id] || !Number.isFinite(status.stacks) || status.stacks <= 0) throw new TypeError('Invalid status ' + id)
    for (const modifier of entity.modifiers) if (!Number.isFinite(modifier.amount)) throw new TypeError('Invalid modifier amount')
  }
  for (const actor of Object.values(state.actors)) if (actor.inventory && actor.inventory.columns !== check.actors[actor.id].inventory.columns) throw new RangeError('Actor storage does not match saved grid')
  if (check.grid.columns !== state.grid.columns) throw new RangeError('Storage does not match saved grid')
  return check.grid
}
