/** Integer coordinates keep placements stable when columns are added on the right. */
import { preparedStates } from './prepared.js'
export const directions = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }

/** Return a rectangular footprint, including off-grid cells for validation. */
export function footprint(definition, position) {
  if (!position || definition.storage) return []
  const [width, height] = definition.footprint
  return Array.from({ length: width * height }, (_, index) => [position[0] + index % width, position[1] + Math.floor(index / width)])
}

/** All cells must fit; fractional and negative coordinates are rejected. */
export function inside(grid, cells) {
  return cells.length > 0 && cells.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.columns && y < grid.rows)
}

/** Actor-local inventories isolate geometry; older single-grid battles retain their layout. */
export function inventoryState(state, owner) {
  const inventory = state.actors[owner]?.inventory
  if (!inventory) return state
  return { ...state, grid: { columns: inventory.columns, rows: inventory.rows }, baseColumns: inventory.baseColumns,
    items: Object.fromEntries(Object.entries(state.items).filter(([, item]) => item.owner === owner)) }
}

/** Occupancy belongs to instances, so multiple copies of one definition are supported. */
export function occupant(state, catalog, cell, excluding = null) {
  return Object.values(state.items).find(item => item.id !== excluding && footprint(catalog.items[item.type], item.position).some(([x, y]) => x === cell[0] && y === cell[1]))?.id ?? null
}

/** Attached packs form contiguous full-height regions beginning at the base grid's right edge. */
function fittedGrid(state, catalog, items, baseColumns = state.baseColumns ?? state.grid.columns, rows = state.grid.rows) {
  let columns = baseColumns
  const packs = Object.values(items).filter(item => item.position && catalog.items[item.type].storage).sort((first, second) => first.position[0] - second.position[0])
  for (const item of packs) {
    if (item.position[0] !== columns || item.position[1] !== 0) return null
    columns += catalog.items[item.type].storage.columns
    if (columns > 12) return null
  }
  const grid = { columns, rows }
  if (Object.values(items).some(item => item.position && !catalog.items[item.type].storage && !inside(grid, footprint(catalog.items[item.type], item.position)))) return null
  return grid
}

/** Placement and storage resizing commit together; rejected removals preserve every item. */
export function placeItem(state, catalog, id, position) {
  const item = state.items[id]
  if (!item || state.phase !== 'planning') return false
  if (position !== null && (!Array.isArray(position) || position.length !== 2)) return false
  const local = inventoryState(state, item.owner)
  const cells = footprint(catalog.items[item.type], position)
  if (cells.some(cell => occupant(local, catalog, cell, id))) return false
  const placed = { ...item, position: position?.slice() ?? null }
  const grid = fittedGrid(local, catalog, { ...local.items, [id]: placed })
  if (!grid) return false
  item.position = placed.position
  if (state.actors[item.owner].inventory) Object.assign(state.actors[item.owner].inventory, grid)
  else state.grid = grid
  return true
}

/** Resize the base grid; equipped storage adds full-height columns to its right. */
export function resizeGrid(state, catalog, columns, rows = state.grid.rows) {
  if (state.phase !== 'planning' || !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > 12 || rows > 12) return false
  const grid = fittedGrid(state, catalog, state.items, columns, rows)
  if (!grid) return false
  state.baseColumns = columns
  state.grid = grid
  return true
}

/** Stable row-major order, then instance ID, makes resolution replayable. */
export function placedItems(state) {
  if (preparedStates.has(state)) return preparedStates.get(state).items
  return Object.values(state.items).filter(item => item.position).sort((first, second) => first.position[1] - second.position[1] || first.position[0] - second.position[0] || first.id.localeCompare(second.id))
}

/** Edge adjacency uses the complete footprints, excludes diagonals and deduplicates targets. */
export function adjacent(state, catalog, first, second) {
  if (first.owner !== second.owner && (state.actors[first.owner].inventory || state.actors[second.owner].inventory)) return false
  return footprint(catalog.items[first.type], first.position).some(([x, y]) => footprint(catalog.items[second.type], second.position).some(([otherX, otherY]) => Math.abs(x - otherX) + Math.abs(y - otherY) === 1))
}

/** Directional targets lie just outside the corresponding footprint boundary. */
export function neighbourCells(catalog, item, direction) {
  if (!item.position) return []
  const [width, height] = catalog.items[item.type].footprint
  const [x, y] = item.position
  const boundaries = {
    right: () => Array.from({ length: height }, (_, index) => [x + width, y + index]),
    left: () => Array.from({ length: height }, (_, index) => [x - 1, y + index]),
    down: () => Array.from({ length: width }, (_, index) => [x + index, y + height]),
    up: () => Array.from({ length: width }, (_, index) => [x + index, y - 1])
  }
  return boundaries[direction]()
}
