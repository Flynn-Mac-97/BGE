/**
 * Spatial Hash — who is near whom, over things that move every step.
 *
 * Physics 3D has a grid already, but it is private and it is built over the
 * solids that never move. This is its opposite: a uniform grid over a named set
 * of entities, rebuilt at most once per fixed step, allocating nothing after
 * the first. It is what a weapon asks "what is in range", what a crowd asks
 * "who am I standing on", and what anything else with more than a hundred
 * moving things eventually needs.
 *
 *     const group = context.spatial.group('enemies', { cellSize: 1.5 })
 *     group.add(entity)
 *     group.near(x, z, 4)          // every member within four metres
 *     group.nearest(x, z, 20)
 *
 * Membership is explicit. A group could have filtered the world instead, but
 * then every query walks every entity to find its own members, which is the
 * cost the grid exists to avoid.
 */

import { groupRegistry } from './spatial-hash/registry.js'

/** Cells about twice a member's width: selective, and a neighbour walk is nine cells. */
const DEFAULT_CELL_SIZE = 1.5

/** A grid wider than this is re-cut with bigger cells, so one stray member cannot allocate a million. */
const MAX_COLUMNS = 192

const DEFAULT_RADIUS = 0.5

/**
 * One group: the members, and the flat index over them.
 *
 * Everything is a typed array indexed by slot. Keeping a list of neighbour
 * objects per member instead allocates a few thousand of them a second, which
 * at three hundred members is the whole cost of the feature.
 */
export function makeGroup(name, context, options = {}) {
  const requestedCellSize = options.cellSize ?? DEFAULT_CELL_SIZE
  const defaultRadius = options.radius ?? DEFAULT_RADIUS

  let members = []

  // Positions copied out of the entities once per index. A steering pass reads
  // each about a dozen times, and a lookup through a flat entity is the slowest
  // part of that.
  let positionX = new Float64Array(0)
  let positionZ = new Float64Array(0)
  let radius = new Float64Array(0)
  let cellOf = new Int32Array(0)
  let order = new Int32Array(0)
  let cellStart = new Int32Array(0)

  let columns = 1
  let rows = 1
  let cellSize = requestedCellSize
  let originX = 0
  let originZ = 0
  let widest = defaultRadius
  let count = 0
  let indexedAt = -1

  function ensure(wanted) {
    if (positionX.length >= wanted) return
    // Powers of two: a crowd gains members a few at a time, and reallocating on
    // every one would undo the point of typed arrays.
    const size = Math.max(64, 1 << (32 - Math.clz32(Math.max(1, wanted - 1))))
    positionX = new Float64Array(size)
    positionZ = new Float64Array(size)
    radius = new Float64Array(size)
    cellOf = new Int32Array(size)
    order = new Int32Array(size)
  }

  /**
   * Drop members the world no longer holds.
   *
   * Invalidating on a drop is not optional. The index holds slot numbers into
   * this array, so compacting it without saying so leaves every one of them
   * pointing one place too far along — and the symptom is `near` handing back
   * `undefined` in place of an entity, from a query made after something died.
   */
  function compact() {
    let kept = 0
    for (let i = 0; i < members.length; i++) {
      if (members[i]._spatialOut) continue
      members[kept++] = members[i]
    }
    if (kept !== members.length) indexedAt = -1
    members.length = kept
  }

  /**
   * Rebuild the grid from where everything is now.
   *
   * A counting sort rather than a map of buckets: two passes over the members
   * and one over the cells, no objects, and a flat list every neighbour walk
   * reads straight out of.
   */
  function index() {
    compact()
    count = members.length
    indexedAt = context.time
    if (!count) { columns = rows = 1; return }

    ensure(count)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    widest = defaultRadius

    for (let i = 0; i < count; i++) {
      const member = members[i]
      const x = member.x
      const z = member.z
      positionX[i] = x
      positionZ[i] = z
      const own = member.properties?.radius ?? defaultRadius
      radius[i] = own
      if (own > widest) widest = own
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }

    // One member a kilometre away must not buy a million cells, so the cell
    // grows to fit the span instead. Walks count cells by radius, so a coarser
    // grid stays correct — only less selective.
    const span = Math.max(maxX - minX, maxZ - minZ)
    cellSize = Math.max(requestedCellSize, span / MAX_COLUMNS)
    originX = minX
    originZ = minZ
    columns = Math.max(1, Math.floor((maxX - minX) / cellSize) + 1)
    rows = Math.max(1, Math.floor((maxZ - minZ) / cellSize) + 1)

    const cells = columns * rows
    if (cellStart.length < cells + 1) cellStart = new Int32Array(cells + 1)
    else cellStart.fill(0, 0, cells + 1)

    for (let i = 0; i < count; i++) {
      const column = Math.min(columns - 1, Math.floor((positionX[i] - originX) / cellSize))
      const row = Math.min(rows - 1, Math.floor((positionZ[i] - originZ) / cellSize))
      const cell = row * columns + column
      cellOf[i] = cell
      cellStart[cell + 1]++
    }
    for (let cell = 0; cell < cells; cell++) cellStart[cell + 1] += cellStart[cell]

    // cellStart is used as a cursor and then put back, so the scatter needs no
    // second array of the same size.
    for (let i = 0; i < count; i++) order[cellStart[cellOf[i]]++] = i
    for (let cell = cells; cell > 0; cell--) cellStart[cell] = cellStart[cell - 1]
    cellStart[0] = 0
  }

  /** Rebuild if anything has changed or the clock has moved on. */
  function fresh() {
    if (indexedAt !== context.time) index()
  }

  const columnOf = x => clamp(Math.floor((x - originX) / cellSize), 0, columns - 1)
  const rowOf = z => clamp(Math.floor((z - originZ) / cellSize), 0, rows - 1)

  /**
   * Walk every member in the cells within `reach` of a point, calling
   * `visit(index, dx, dz)`.
   *
   * `near` and `nearest` ask the same cells in the same order and differ only in
   * what they do with each member. The callback is built once per question, not
   * once per pair: a caller that wants to walk the pairs itself reads `flat`.
   */
  function forEachNear(x, z, reach, visit) {
    const fromColumn = columnOf(x - reach), toColumn = columnOf(x + reach)
    const fromRow = rowOf(z - reach), toRow = rowOf(z + reach)
    for (let row = fromRow; row <= toRow; row++) {
      const base = row * columns
      for (let column = fromColumn; column <= toColumn; column++) {
        const cell = base + column
        const end = cellStart[cell + 1]
        for (let k = cellStart[cell]; k < end; k++) {
          const i = order[k]
          visit(i, positionX[i] - x, positionZ[i] - z)
        }
      }
    }
  }

  return {
    name,
    get members() { return members },

    /**
     * How many are actually still here. Compacted first: a member destroyed
     * since the last index is still in the array, and a caller asking "how many
     * are alive" to decide whether it may add another would be told the group
     * is full of things that no longer exist, and add nothing, for ever.
     */
    get size() { compact(); return members.length },

    add(entity) {
      if (!entity) return null
      entity._spatialOut = false
      members.push(entity)
      indexedAt = -1
      return entity
    },

    remove(entity) {
      if (!entity) return false
      entity._spatialOut = true
      indexedAt = -1
      return true
    },

    clear() {
      for (const member of members) member._spatialOut = true
      members = []
      indexedAt = -1
    },

    /** Say the index is stale without rebuilding it — the rebuild happens on the next question. */
    invalidate() { indexedAt = -1 },

    index,
    fresh,

    /**
     * Every member within `radius` of a point. `into` is an array the caller
     * may hand back next time — a weapon looking for targets asks this many
     * times a step, and a fresh array each time is the allocation that matters.
     */
    near(x, z, reach, into = []) {
      fresh()
      into.length = 0
      if (!count) return into
      const squared = reach * reach
      forEachNear(x, z, reach, (i, dx, dz) => {
        if (dx * dx + dz * dz <= squared) into.push(members[i])
      })
      return into
    },

    nearest(x, z, reach) {
      fresh()
      let best = null
      let bestDistance = reach * reach
      forEachNear(x, z, reach, (i, dx, dz) => {
        const distance = dx * dx + dz * dz
        if (distance >= bestDistance) return
        bestDistance = distance
        best = members[i]
      })
      return best
    },

    /**
     * The index itself, for a caller that wants to walk neighbours in its own
     * loop rather than through `near`.
     *
     * Handed out because the alternative for a crowd of six hundred is six
     * hundred arrays a step, or a callback per pair. Read it after `index()`
     * and do not keep it: the arrays are reused and regrown.
     */
    get flat() {
      return {
        count, positionX, positionZ, radius, cellOf, order, cellStart,
        columns, rows, cellSize, widest, members
      }
    },

    get stats() {
      return {
        name,
        members: members.length,
        cellSize: round(cellSize),
        cells: columns * rows,
        columns,
        rows,
        widestMember: round(widest)
      }
    }
  }
}

export default {
  name: 'Spatial Hash',

  category: 'engine',
  onLoad(context) {
    if (context.spatial) {
      console.error('[spatial-hash] something else already put a spatial on context — replacing it')
    }

    const spatial = groupRegistry((name, options) => makeGroup(name, context, options))

    // A member destroyed by anybody — a weapon, a level reload, a command — has
    // to leave its group, and the group cannot poll for it. Every group is told
    // its index is stale, so the next question rebuilds rather than answering
    // with something that no longer exists.
    context.bus.on('entity:removed', entity => {
      if (!entity) return
      entity._spatialOut = true
      for (const group of spatial.groups) group.invalidate()
    })

    context.spatial = spatial
  },

  commands: [{
    id: 'spatial.stats',
    label: 'Spatial group counts',
    run(context) {
      if (!context.spatial) return { error: 'Spatial Hash did not load' }
      return { groups: context.spatial.groups.map(group => group.stats) }
    }
  }]
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const round = n => Math.round(n * 1000) / 1000
