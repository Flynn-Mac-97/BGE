/** Search-space operations preserve legal geometry and make equivalent item permutations share an identity. */
import { rules } from '../bell/rules.js'
import { costs, actors } from './definitions.js'
import { validateLoadout } from './loadouts.js'

export function canonicalKit(kit) {
  const items = kit.items.map(item => ({ type: item.type, position: item.position ? [...item.position] : null }))
    .sort((first, second) => (first.position?.[1] ?? -1) - (second.position?.[1] ?? -1) || (first.position?.[0] ?? -1) - (second.position?.[0] ?? -1) || first.type.localeCompare(second.type))
    .map((item, index) => ({ key: 'slot-' + index, ...item }))
  return { actor: kit.actor, items, links: [] }
}
export const kitIdentity = kit => JSON.stringify(canonicalKit(kit))
export function seededRandom(seed) {
  let value = seed
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
}
export function acceptsKit(kit, settings) {
  if (kit.actor !== settings.actor || kit.items.length > settings.maxItems) return false
  const counts = {}
  for (const item of kit.items) {
    if (!settings.pool.includes(item.type) || !item.position) return false
    counts[item.type] = (counts[item.type] ?? 0) + 1
    if (counts[item.type] > settings.duplicateLimit) return false
  }
  const reading = validateLoadout(kit)
  return reading.valid && reading.cost <= settings.budget
}

/** Mutations explore broken as well as useful interactions; only geometry and budget are hard filters. */
export function mutateKit(input, settings, random, operation) {
  const kit = structuredClone(input)
  const pick = values => values[Math.floor(random() * values.length)]
  const columns = actors[kit.actor].inventory.columns + kit.items.reduce((total, item) => total + (rules.catalog.items[item.type].storage?.columns ?? 0), 0)
  const position = type => rules.catalog.items[type].storage ? [columns, 0] : [Math.floor(random() * columns), Math.floor(random() * actors[kit.actor].inventory.rows)]
  const mutations = {
    add() { const type = pick(settings.pool); kit.items.push({ key: 'new', type, position: position(type) }) },
    remove() { if (kit.items.length) kit.items.splice(Math.floor(random() * kit.items.length), 1) },
    replace() { if (kit.items.length) { const item = pick(kit.items); item.type = pick(settings.pool) } },
    move() { if (kit.items.length) { const item = pick(kit.items); item.position = position(item.type) } },
    swap() { if (kit.items.length > 1) { const first = pick(kit.items), second = pick(kit.items); [first.position, second.position] = [second.position, first.position] } }
  }
  const name = operation ?? pick(Object.keys(mutations))
  if (!mutations[name]) throw new TypeError('Unknown mutation ' + name)
  mutations[name]()
  return { kit: canonicalKit(kit), operation: name }
}

export function searchSettings(request) {
  const settings = { actor: 'scavenger', pool: Object.keys(costs), budget: 14, maxItems: 8, duplicateLimit: 2, seed: 41, evaluations: 64, maxCycles: 20, finalists: 3, objective: 'strength', ...request }
  for (const [key, minimum, maximum] of [['budget', 1, 100], ['maxItems', 1, 12], ['duplicateLimit', 1, 4], ['seed', 0, 0xffffffff], ['evaluations', 1, 128], ['maxCycles', 1, 60], ['finalists', 1, 3]]) {
    if (!Number.isInteger(settings[key]) || settings[key] < minimum || settings[key] > maximum) throw new RangeError(`Invalid ${key}: ${minimum}–${maximum}`)
  }
  if (!actors[settings.actor] || !Array.isArray(settings.pool) || !settings.pool.length || settings.pool.length > Object.keys(costs).length || new Set(settings.pool).size !== settings.pool.length || settings.pool.some(type => !rules.catalog.items[type] || !Number.isFinite(costs[type]))) throw new TypeError('Invalid actor or item pool')
  return settings
}
