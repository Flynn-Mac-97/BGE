/** Integer coordinates keep placements stable when columns are added on the right. */
export const directions = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }

/** Return a rectangular footprint, including off-grid cells for validation. */
export function footprint(definition, position) {
  if (!position) return []
  const [width, height] = definition.footprint
  return Array.from({ length: width * height }, (_, index) => [position[0] + index % width, position[1] + Math.floor(index / width)])
}

/** All cells must fit; fractional and negative coordinates are rejected. */
export function inside(grid, cells) {
  return cells.length > 0 && cells.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.columns && y < grid.rows)
}

/** Occupancy belongs to instances, so multiple copies of one definition are supported. */
export function occupant(state, catalog, cell, excluding = null) {
  return Object.values(state.items).find(item => item.id !== excluding && footprint(catalog.items[item.type], item.position).some(([x, y]) => x === cell[0] && y === cell[1]))?.id ?? null
}

/** Moving an item is atomic; a rejected move preserves the full arrangement. */
export function placeItem(state, catalog, id, position) {
  const item = state.items[id]
  if (!item || state.phase !== 'planning') return false
  if (position === null) { item.position = null; return true }
  if (!Array.isArray(position) || position.length !== 2) return false
  const cells = footprint(catalog.items[item.type], position)
  if (!inside(state.grid, cells) || cells.some(cell => occupant(state, catalog, cell, id))) return false
  item.position = position.slice()
  return true
}

/** Resize without reindexing items; shrinking through an occupied footprint is refused. */
export function resizeGrid(state, catalog, columns, rows = state.grid.rows) {
  if (state.phase !== 'planning' || !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > 12 || rows > 12) return false
  const grid = { columns, rows }
  if (Object.values(state.items).some(item => item.position && !inside(grid, footprint(catalog.items[item.type], item.position)))) return false
  state.grid = grid
  return true
}

/** Stable row-major order, then instance ID, makes resolution replayable. */
export function placedItems(state) {
  return Object.values(state.items).filter(item => item.position).sort((first, second) => first.position[1] - second.position[1] || first.position[0] - second.position[0] || first.id.localeCompare(second.id))
}

/** Edge adjacency uses the complete footprints, excludes diagonals and deduplicates targets. */
export function adjacent(state, catalog, first, second) {
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
