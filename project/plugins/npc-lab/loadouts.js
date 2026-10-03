/** Seeded recipes build legal interactions before optional equipment. No renderer or ambient random. */
import { rules } from '../bell/rules.js'
import { actors, recipes, costs } from './definitions.js'
import { placedItems } from '../grid-game/grid.js'

/** Return an isolated actor definition; team and instance identity belong to the encounter. */
export function actorFor(type, team) {
  if (!actors[type]) throw new TypeError('Unknown actor ' + type)
  return { ...structuredClone(actors[type]), team }
}

/** Inspect a kit with the same catalog, geometry and selectors used in combat. */
export function validateLoadout(loadout) {
  const errors = [], warnings = []
  let state, cost = 0
  try {
    const actor = actorFor(loadout.actor, 'subject')
    if (!Array.isArray(loadout.items) || loadout.items.length > 36) throw new TypeError('Loadout requires at most 36 items')
    for (const item of loadout.items) {
      if (!Number.isFinite(costs[item.type])) throw new TypeError('Missing authoring cost for ' + item.type)
      cost += costs[item.type]
    }
    state = rules.createState({ actors: { subject: actor, opponent: { name: 'Probe', team: 'opponent', maxHealth: 12, inventory: { columns: 3, rows: 3 } } },
      items: loadout.items.map(item => ({ id: item.key, type: item.type, position: item.position, owner: 'subject' })) })
    const order = placedItems(state).map(item => item.id)
    for (const link of loadout.links ?? []) {
      const item = state.items[link.from]
      const ability = item && rules.catalog.items[item.type].abilities.find(ability => ability.id === link.ability)
      const selector = ability?.trigger.source ?? ability?.target
      if (!selector || !rules.targets(state, { kind: 'item', id: link.from }, selector).some(target => target.kind === 'item' && target.id === link.to)) errors.push(`Broken link: ${link.from} → ${link.to}`)
      if (link.before && order.indexOf(link.from) >= order.indexOf(link.to)) errors.push(`Late preparation: ${link.from} → ${link.to}`)
    }
    for (const item of placedItems(state)) {
      for (const ability of rules.catalog.items[item.type].abilities) {
        const targets = rules.targets(state, { kind: 'item', id: item.id }, ability.target)
        if (!targets.length) warnings.push(`${item.id}: ${ability.id} has no target`)
        const preparation = ability.effects.some(effect => {
          const status = rules.catalog.statuses[effect.status]
          return (effect.duration ?? status?.duration) === 'nextAction' && (effect.expires ?? status?.expires) === 'cycle'
        })
        if (preparation && ability.trigger.event === 'ownTurn' && targets.some(target => target.kind === 'item' && order.indexOf(target.id) < order.indexOf(item.id))) warnings.push(`${item.id}: preparation follows its target's normal turn`)
      }
    }
  } catch (error) { errors.push(error.message) }
  return { valid: !errors.length, cost, errors, warnings }
}

/** Identical seed and authoring data give identical choices; failed constraints never return a kit. */
export function generateLoadout({ recipe, budget, seed = 1 }) {
  const definition = recipes[recipe]
  if (!definition) throw new TypeError('Unknown recipe ' + recipe)
  if (!Number.isInteger(budget) || budget < 0 || budget > 100 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Budget must be 0–100 and seed an unsigned 32-bit integer')
  let randomState = seed
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296 }
  const loadout = { recipe, actor: definition.actor, seed, budget, items: structuredClone(definition.required), links: structuredClone(definition.links), notes: [] }
  const base = validateLoadout(loadout)
  if (!base.valid) throw new TypeError(base.errors.join('; '))
  if (base.cost > budget) throw new RangeError(`Recipe ${recipe} requires at least ${base.cost} budget`)
  for (const slot of definition.optional) {
    const pool = [...slot.pool]
    let placed = false
    while (pool.length && !placed) {
      const type = pool.splice(Math.floor(random() * pool.length), 1)[0]
      for (const position of slot.positions) {
        const candidate = { ...loadout, items: [...loadout.items, { key: slot.key, type, position: [...position] }] }
        const reading = validateLoadout(candidate)
        if (!reading.valid || reading.cost > budget || reading.warnings.length) continue
        loadout.items = candidate.items
        loadout.notes.push(`${slot.key}: ${type} at ${position.join(',')}`)
        placed = true
        break
      }
    }
    if (!placed) loadout.notes.push(`${slot.key}: skipped; budget or placement constraint`)
  }
  return { ...loadout, cost: validateLoadout(loadout).cost }
}
