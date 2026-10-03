/** Fixed geometry uses owner-local occupancy and full footprints; no combat values enter this index. */
import { footprint, placedItems, directions } from './grid.js'
import { preparedStates } from './prepared.js'

/** Build plain occupancy records, including cells in attached storage regions. */
export function spatialIndex(state, catalog) {
  const items = placedItems(state), cells = {}, occupancy = {}
  for (const item of items) {
    cells[item.id] = footprint(catalog.items[item.type], item.position)
    const inventory = state.actors[item.owner].inventory ? item.owner : 'shared'
    const occupied = occupancy[inventory] ??= {}
    for (const [x, y] of cells[item.id]) occupied[x + ',' + y] = item.id
  }
  return { items, cells, occupancy }
}

/** Return unique recipients in normal activation order; a ray stops at its first occupant if requested. */
export function spatialTargets(state, catalog, source, selector) {
  if (source.kind !== 'item') return []
  const item = state.items[source.id]
  if (!item.position) return []
  const prepared = preparedStates.get(state)
  const index = prepared?.spatial ?? spatialIndex(state, catalog)
  if (prepared) prepared.spatial = index
  const cells = index.cells[item.id], selected = new Set()
  const local = state.actors[item.owner].inventory ? item.owner : 'shared'
  const occupancy = index.occupancy[local] ?? {}
  if (selector.kind === 'containerItems') {
    const width = catalog.items[item.type].storage?.columns
    if (!width) return []
    for (const other of index.items) if (other.owner === item.owner && index.cells[other.id].length && index.cells[other.id].every(([x]) => x >= item.position[0] && x < item.position[0] + width)) selected.add(other.id)
  } else if (selector.shape === 'rays') {
    for (const [x, y] of cells) for (const direction of selector.directions ?? ['up', 'down', 'left', 'right']) {
      const [horizontal, vertical] = directions[direction]
      for (let distance = 1; distance <= (selector.range ?? 1); distance++) {
        const id = occupancy[(x + horizontal * distance) + ',' + (y + vertical * distance)]
        if (!id || id === item.id) continue
        selected.add(id)
        if (selector.first) break
      }
    }
  } else for (const other of index.items) {
    if (other.id === item.id || (state.actors[item.owner].inventory && other.owner !== item.owner)) continue
    if (cells.some(([x, y]) => index.cells[other.id].some(([otherX, otherY]) => {
      if (selector.shape === 'row') return y === otherY
      if (selector.shape === 'column') return x === otherX
      return Math.abs(x - otherX) + Math.abs(y - otherY) <= (selector.range ?? 1)
    }))) selected.add(other.id)
  }
  return index.items.filter(other => selected.has(other.id)).map(other => ({ kind: 'item', id: other.id }))
}
