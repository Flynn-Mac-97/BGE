/** Enumerate combinations of placed items exactly once; directional and scan-order differences are retained. */
import { rules } from '../bell/rules.js'
import { actors, costs } from './definitions.js'
import { canonicalKit } from './combo-space.js'

export function enumerationSettings(request = {}) {
  const settings = { actor: 'scavenger', pool: ['dagger', 'sword', 'venom', 'stone', 'tooth', 'echo'], budget: 9, maxItems: 3, duplicateLimit: 2, required: [], ...request }
  if (!actors[settings.actor]) throw new TypeError('Unknown actor')
  for (const [key, maximum] of [['budget', 100], ['maxItems', 12], ['duplicateLimit', 4]]) if (!Number.isInteger(settings[key]) || settings[key] < 1 || settings[key] > maximum) throw new RangeError('Invalid ' + key)
  if (!Array.isArray(settings.pool) || !settings.pool.length || settings.pool.length > Object.keys(costs).length || new Set(settings.pool).size !== settings.pool.length || settings.pool.some(type => !rules.catalog.items[type] || !Number.isFinite(costs[type]))) throw new TypeError('Invalid enumeration pool')
  if (!Array.isArray(settings.required) || settings.required.some(type => !settings.pool.includes(type)) || new Set(settings.required).size !== settings.required.length) throw new TypeError('Required types must belong to the pool')
  return { ...settings, pool: [...settings.pool].sort(), required: [...settings.required].sort() }
}

function placements(pool, columns, rows) {
  const result = []
  for (const type of pool) {
    const [width, height] = rules.catalog.items[type].footprint
    for (let y = 0; y <= rows - height; y++) for (let x = 0; x <= columns - width; x++) {
      let mask = 0n
      for (let offsetY = 0; offsetY < height; offsetY++) for (let offsetX = 0; offsetX < width; offsetX++) mask |= 1n << BigInt((y + offsetY) * columns + x + offsetX)
      result.push({ type, position: [x, y], mask })
    }
  }
  return result
}

/** Storage chains enumerate in attachment order; equipment then uses increasing placement indices. */
export function* enumerateLoadouts(request = {}) {
  const settings = enumerationSettings(request), inventory = actors[settings.actor].inventory
  const storage = settings.pool.filter(type => rules.catalog.items[type].storage)
  const equipment = settings.pool.filter(type => !rules.catalog.items[type].storage)
  const counts = {}, items = []
  function* fill(options, start, mask, cost) {
    if (settings.required.every(type => counts[type])) yield { kit: canonicalKit({ actor: settings.actor, items }), cost }
    if (items.length === settings.maxItems) return
    for (let index = start; index < options.length; index++) {
      const option = options[index]
      if ((option.mask & mask) || (counts[option.type] ?? 0) >= settings.duplicateLimit || cost + costs[option.type] > settings.budget) continue
      items.push({ type: option.type, position: option.position }); counts[option.type] = (counts[option.type] ?? 0) + 1
      yield* fill(options, index + 1, mask | option.mask, cost + costs[option.type])
      items.pop(); counts[option.type]--
    }
  }
  function* attach(columns, cost) {
    yield* fill(placements(equipment, columns, inventory.rows), 0, 0n, cost)
    if (items.length === settings.maxItems) return
    for (const type of storage) {
      const expanded = columns + rules.catalog.items[type].storage.columns
      if (expanded > 12 || (counts[type] ?? 0) >= settings.duplicateLimit || cost + costs[type] > settings.budget) continue
      items.push({ type, position: [columns, 0] }); counts[type] = (counts[type] ?? 0) + 1
      yield* attach(expanded, cost + costs[type])
      items.pop(); counts[type]--
    }
  }
  yield* attach(inventory.columns, 0)
}
