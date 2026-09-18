/**
 * Kernel: the cell grid both physics solvers bucket bodies into.
 *
 * A cell is four units across, about a body wide at the engine's scale. A body
 * that would cover more than `MAX_CELLS` of them — a floor spanning the map — is
 * listed aside and always tested instead: binning it costs more than it saves.
 */
export const CELL = 4

/** More cells than this and the body is kept aside rather than binned. */
export const MAX_CELLS = 64

/** The key one cell is known by. */
export const cellKey = (ix, iy) => `${ix},${iy}`

/**
 * Add `at` to every cell a rectangle covers, or to `everywhere` when it covers
 * more than `MAX_CELLS` of them.
 */
export function fillCells(cells, everywhere, at, { x0, x1, y0, y1 }) {
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) { everywhere.push(at); return }
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      const list = cells.get(cellKey(ix, iy))
      if (list) list.push(at)
      else cells.set(cellKey(ix, iy), [at])
    }
  }
}
