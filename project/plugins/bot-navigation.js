/**
 * Bot Navigation — where a bot may walk, worked out from the map itself.
 *
 * There are no hand-placed waypoints here on purpose. A waypoint graph is
 * correct exactly once, on the day somebody placed it, and the failure mode
 * afterwards is a bot walking into a wall that was moved two metres. So the
 * walkable set is sampled off the solid geometry every time the level loads: if
 * a wall moves, the navigation moves with it and nobody has to remember.
 *
 * The method is the oldest one there is, and it fits this map. de_dust2 here is
 * a few hundred axis-aligned solid boxes on one mostly-flat surface with a
 * handful of steps, so the ground plane is sampled on a half-metre grid, each
 * column is asked "could a standing player be here", neighbours a player could
 * step between are connected, and A star runs over that.
 *
 * `recast-navigation` would be the upgrade — a real navmesh, with proper
 * polygons instead of a grid, and it would give smoother paths off arbitrary
 * geometry. It is not in package.json and this run installs nothing, so the
 * grid is what is here. The seam is `buildNavigation` below: swap what it
 * returns for a navmesh and neither the plugin nor the bots notice.
 *
 * Contributed onto context, so the brain never reaches into this file:
 *
 *     context.navigation.path(from, to)     a list of points, or null
 *     context.navigation.walkable(point)    could a player stand there
 *     context.navigation.nearest(point)     the closest place one could
 *     context.navigation.stats              cells, regions, what it cost
 *
 * And from a terminal, which is how you find out a map has an island in it:
 *
 *     node bin/engine.mjs --headless run navigation.stats --level de_dust2
 *     node bin/engine.mjs --headless run navigation.path '[[42,1,-14],[1,1.3,-25]]'
 */

/** Half a metre. Fine enough to find a doorway, coarse enough to stay cheap. */
const CELL_SIZE = 0.5

// The player, in metres, converted once from Counter-Strike and matching the
// numbers Physics 3D already moves a body with.
const PLAYER_HEIGHT = 1.83
const STEP_HEIGHT = 0.46

/**
 * Half the width the clearance test uses. The real player box is 0.81 m across
 * and this is a shade under half of it, so a gap built to exactly a player's
 * width is passable rather than a hair too narrow — a corridor that measures
 * right on paper and cannot be walked is the worst kind of map bug.
 */
const PLAYER_HALF_WIDTH = 0.38

/**
 * How far out from a cell's centre the ground is probed before the cell counts
 * as floor rather than as a ledge to fall off.
 *
 * Without this, the top of every wall in the map is "walkable" — the centre of
 * the column has solid under it and clear air above it, which is all the naive
 * test asks. Probing the four corners of the footprint throws those away, and
 * it also keeps bots half a metre back from a drop, which is where a player
 * who does not want to fall walks anyway.
 */
const SUPPORT_REACH = 0.3

/** Overlaps smaller than this are two boxes touching, not two boxes in each other. */
const SKIN = 0.02

/** How far `nearest` will look for somewhere to stand before giving up. In cells. */
const SEARCH_RADIUS = 24

/** The eight ways out of a cell: four square, four diagonal. */
const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
]

/**
 * Every solid in a world, as the only shape this file cares about: an
 * axis-aligned box in metres. `body: 'solid'` is the same flag Physics 3D
 * claims an entity by, so a thing a bullet stops on is a thing a bot walks
 * round, and there is no second opinion about what the map is.
 */
function solidBoxes(entities) {
  const boxes = []
  for (const entity of entities || []) {
    const box = entity?.collider?.box
    if (!Array.isArray(box) || box.length !== 3) continue
    if (entity.properties?.body !== 'solid') continue
    const scale = entity.scale ?? 1
    const [width, height, depth] = box
    boxes.push({
      minX: entity.x - (width * scale) / 2, maxX: entity.x + (width * scale) / 2,
      minY: entity.y - (height * scale) / 2, maxY: entity.y + (height * scale) / 2,
      minZ: entity.z - (depth * scale) / 2, maxZ: entity.z + (depth * scale) / 2
    })
  }
  return boxes
}

/**
 * Sample the ground and connect what a player could step between.
 *
 * Pure, and exported, because a test is handed `test` and never the context —
 * `project/tests/bots.js` builds one of these from the world's own entities and
 * asks it the same questions the bots ask. A navigation that only existed
 * inside a plugin could only be checked by watching a bot, which is the slowest
 * way to find out anything.
 */
export function buildNavigation(entities, options = {}) {
  const cellSize = options.cellSize ?? CELL_SIZE
  const playerHeight = options.playerHeight ?? PLAYER_HEIGHT
  const stepHeight = options.stepHeight ?? STEP_HEIGHT
  const solids = solidBoxes(entities)

  // A level with no 3D solids in it — the 2D demo, or an empty world — has no
  // ground to sample. Saying so beats returning a grid of nothing that every
  // later call has to guess the meaning of.
  if (!solids.length) return emptyNavigation(cellSize, 'no solid geometry in this level')

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const solid of solids) {
    if (solid.minX < minX) minX = solid.minX
    if (solid.maxX > maxX) maxX = solid.maxX
    if (solid.minZ < minZ) minZ = solid.minZ
    if (solid.maxZ > maxZ) maxZ = solid.maxZ
  }
  minX -= cellSize; minZ -= cellSize; maxX += cellSize; maxZ += cellSize

  const columns = Math.max(1, Math.ceil((maxX - minX) / cellSize))
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize))
  const count = columns * rows

  const floor = new Float64Array(count)
  const open = new Uint8Array(count)
  const region = new Int32Array(count).fill(-1)
  const work = { probes: 0, overlaps: 0 }

  // Which solids could touch a player standing anywhere in each column. Grown
  // by the footprint so the corner probes below never have to look next door,
  // which is what keeps the per-cell work to one short list.
  const near = new Array(count)
  for (const solid of solids) {
    const fromColumn = clamp(Math.floor((solid.minX - PLAYER_HALF_WIDTH - minX) / cellSize), 0, columns - 1)
    const toColumn = clamp(Math.floor((solid.maxX + PLAYER_HALF_WIDTH - minX) / cellSize), 0, columns - 1)
    const fromRow = clamp(Math.floor((solid.minZ - PLAYER_HALF_WIDTH - minZ) / cellSize), 0, rows - 1)
    const toRow = clamp(Math.floor((solid.maxZ + PLAYER_HALF_WIDTH - minZ) / cellSize), 0, rows - 1)
    for (let column = fromColumn; column <= toColumn; column++) {
      for (let row = fromRow; row <= toRow; row++) {
        const index = row * columns + column
        if (near[index]) near[index].push(solid)
        else near[index] = [solid]
      }
    }
  }

  const centreX = index => minX + ((index % columns) + 0.5) * cellSize
  const centreZ = index => minZ + (Math.floor(index / columns) + 0.5) * cellSize

  for (let index = 0; index < count; index++) {
    const here = near[index]
    if (!here) continue
    const x = centreX(index), z = centreZ(index)

    /**
     * Every surface directly under this cell's centre, *lowest* first.
     *
     * Lowest is the surprising half of this file and it is the half that makes
     * the map come out in one piece. One height per column is all a grid can
     * hold, and taking the highest one puts the walkable surface on top of
     * every awning, lintel and door sill in de_dust2 — the floor of the
     * doorway underneath disappears and the map falls into forty islands
     * joined by nothing. Taking the lowest keeps the ground, and it still
     * climbs a crate, because the floor *inside* a crate has no headroom and
     * fails the test below before the crate's own top is reached.
     */
    const surfaces = []
    for (const solid of here) {
      work.probes++
      if (x < solid.minX || x > solid.maxX || z < solid.minZ || z > solid.maxZ) continue
      if (!surfaces.includes(solid.maxY)) surfaces.push(solid.maxY)
    }
    surfaces.sort((a, b) => a - b)

    for (const surface of surfaces) {
      if (!clearAbove(here, x, z, surface, playerHeight, stepHeight, work)) continue
      if (!supported(here, x, z, surface, stepHeight, work)) continue
      floor[index] = surface
      open[index] = 1
      break
    }
  }

  // Islands. A patch of walkable cells with no way to the rest of the map is
  // either a wall top nobody can climb or a room somebody forgot to put a door
  // in, and the navigation is the only thing in this project that can see the
  // difference between those and a map that is fine.
  const regions = []
  const stack = []
  for (let seed = 0; seed < count; seed++) {
    if (!open[seed] || region[seed] >= 0) continue
    const id = regions.length
    let cells = 0
    region[seed] = id
    stack.push(seed)
    while (stack.length) {
      const index = stack.pop()
      cells++
      for (const step of stepsFrom(index)) {
        if (region[step.index] >= 0) continue
        region[step.index] = id
        stack.push(step.index)
      }
    }
    regions.push({ id, cells, at: point(seed) })
  }
  regions.sort((a, b) => b.cells - a.cells)

  /** Where a cell puts a player's feet. */
  function point(index) {
    return { x: centreX(index), y: floor[index], z: centreZ(index) }
  }

  function indexAt(x, z) {
    const column = Math.floor((x - minX) / cellSize)
    const row = Math.floor((z - minZ) / cellSize)
    if (column < 0 || row < 0 || column >= columns || row >= rows) return -1
    return row * columns + column
  }

  /**
   * Every cell a player could move into from this one in one step.
   *
   * A diagonal is refused unless both squares beside it are open too, because
   * the alternative is bots cutting the corner of a doorway and grinding along
   * the frame — the walk-into-a-wall failure in its most common disguise.
   */
  function stepsFrom(index) {
    const column = index % columns, row = (index - column) / columns
    const out = []
    for (const [dx, dz] of NEIGHBOURS) {
      const nextColumn = column + dx, nextRow = row + dz
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue
      const next = nextRow * columns + nextColumn
      if (!open[next]) continue
      const rise = Math.abs(floor[next] - floor[index])
      if (rise > stepHeight) continue
      if (dx && dz) {
        const sideA = row * columns + nextColumn
        const sideB = nextRow * columns + column
        if (!open[sideA] || !open[sideB]) continue
        if (Math.abs(floor[sideA] - floor[index]) > stepHeight) continue
        if (Math.abs(floor[sideB] - floor[index]) > stepHeight) continue
      }
      // Climbing costs, so a flat way round beats a staircase of the same length.
      out.push({ index: next, cost: cellSize * (dx && dz ? Math.SQRT2 : 1) + rise })
    }
    return out
  }

  /**
   * The closest cell a player could stand in, spiralling outwards from a point.
   *
   * Ranked on the ground plane, with height used only to say whether a cell is
   * on the caller's floor at all. Mixing the two into one distance reads badly
   * on a map with anything stacked on it: asked for the middle of bomb site A,
   * a metre above the crates that sit there, a bot would be sent to the top of
   * a crate it cannot climb rather than to the floor beside it.
   */
  function nearestIndex(where) {
    const at = asPoint(where)
    if (!at) return -1
    const start = indexAt(at.x, at.z)
    if (start >= 0 && open[start] && withinReach(start, at)) return start

    const column = Math.floor((at.x - minX) / cellSize)
    const row = Math.floor((at.z - minZ) / cellSize)
    let best = -1, bestDistance = Infinity, foundAt = 0
    // Somewhere to stand that is not on the caller's floor, kept in case there
    // is nothing on it. A point in mid-air is still better answered than not.
    let other = -1, otherDistance = Infinity

    for (let ring = 1; ring <= SEARCH_RADIUS; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
          const nextColumn = column + dx, nextRow = row + dz
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue
          const index = nextRow * columns + nextColumn
          if (!open[index]) continue
          const here = point(index)
          const distance = (here.x - at.x) ** 2 + (here.z - at.z) ** 2
          if (withinReach(index, at)) {
            if (distance < bestDistance) { bestDistance = distance; best = index; foundAt = ring }
          } else if (distance + (here.y - at.y) ** 2 < otherDistance) {
            otherDistance = distance + (here.y - at.y) ** 2
            other = index
          }
        }
      }
      // One ring past the first hit, because a cell on the diagonal of the next
      // ring out can still be nearer than one on the side of this one.
      if (best >= 0 && ring > foundAt) break
    }
    return best >= 0 ? best : other
  }

  /** A point is on this cell's floor if it is between its feet and its head. */
  function withinReach(index, at) {
    if (!Number.isFinite(at.y)) return true
    return at.y >= floor[index] - stepHeight && at.y <= floor[index] + playerHeight
  }

  return {
    cellSize,
    bounds: { minX, minZ, maxX, maxZ, columns, rows },
    regions,

    walkable(where) {
      const at = asPoint(where)
      if (!at) return false
      const index = indexAt(at.x, at.z)
      return index >= 0 && !!open[index] && withinReach(index, at)
    },

    nearest(where) {
      const index = nearestIndex(where)
      return index < 0 ? null : point(index)
    },

    /**
     * Which island a point belongs to, or -1 for nowhere. Two points sharing a
     * region have a path between them, which is a far cheaper question than
     * finding the path — a bot deciding whether an objective is worth walking
     * to asks this, not `path`.
     */
    regionAt(where) {
      const index = nearestIndex(where)
      return index < 0 ? -1 : region[index]
    },

    /**
     * A star from one point to another, as a list of places to stand.
     *
     * Every point handed back is the centre of a walkable cell, so a caller can
     * steer at one without checking it first. Two points in different regions
     * get `null` rather than a path that ends in a wall.
     */
    path(from, to) {
      const start = nearestIndex(from)
      const goal = nearestIndex(to)
      if (start < 0 || goal < 0) return null
      if (region[start] !== region[goal]) return null
      if (start === goal) return [point(start)]

      const cameFrom = new Int32Array(count).fill(-1)
      const cost = new Float64Array(count).fill(Infinity)
      const done = new Uint8Array(count)
      const queue = makeQueue()

      cost[start] = 0
      queue.push(start, heuristic(start, goal))

      while (queue.size) {
        const index = queue.pop()
        if (done[index]) continue
        if (index === goal) return smooth(trace(cameFrom, start, goal))
        done[index] = 1
        for (const step of stepsFrom(index)) {
          const next = cost[index] + step.cost
          if (next >= cost[step.index]) continue
          cost[step.index] = next
          cameFrom[step.index] = index
          queue.push(step.index, next + heuristic(step.index, goal))
        }
      }
      return null
    },

    get stats() {
      const walkable = regions.reduce((total, r) => total + r.cells, 0)
      return {
        cellSize,
        cells: count,
        columns,
        rows,
        walkable,
        solids: solids.length,
        bounds: [round(minX), round(minZ), round(maxX), round(maxZ)],
        regions: regions.length,
        // The largest region is the map; everything after it is an island, and
        // an island with more than a handful of cells in it is worth a look.
        unreachable: regions.slice(1).map(r => ({
          cells: r.cells,
          at: [round(r.at.x), round(r.at.y), round(r.at.z)]
        })).slice(0, 12),
        // No wall clock is reachable from here and none is wanted: two runs of
        // the same map must report the same cost or this number is noise. So
        // the cost is the work done, which is the same on every replay.
        cost: { groundProbes: work.probes, boxTests: work.overlaps }
      }
    }
  }

  /** Distance in cells, octile, which never over-estimates an eight-way grid. */
  function heuristic(index, goal) {
    const dx = Math.abs((index % columns) - (goal % columns))
    const dz = Math.abs(Math.floor(index / columns) - Math.floor(goal / columns))
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * cellSize
  }

  function trace(cameFrom, start, goal) {
    const out = [goal]
    let index = goal
    while (index !== start) {
      index = cameFrom[index]
      if (index < 0) break
      out.push(index)
    }
    return out.reverse()
  }

  /**
   * Pull the string tight.
   *
   * A grid path is a staircase of half-metre steps and a bot following one
   * visibly zig-zags down a corridor it could have walked straight. Dropping
   * every corner that can be cut leaves the corners that are really there.
   */
  function smooth(indices) {
    const kept = [indices[0]]
    let anchor = 0
    for (let i = 2; i < indices.length; i++) {
      if (straight(indices[anchor], indices[i])) continue
      kept.push(indices[i - 1])
      anchor = i - 1
    }
    kept.push(indices[indices.length - 1])
    return kept.map(point)
  }

  /** Could a player walk this segment without leaving the walkable set. */
  function straight(fromIndex, toIndex) {
    const from = point(fromIndex), to = point(toIndex)
    const span = Math.hypot(to.x - from.x, to.z - from.z)
    const samples = Math.ceil(span / (cellSize / 2))
    let last = fromIndex
    for (let i = 1; i <= samples; i++) {
      const t = i / samples
      const index = indexAt(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)
      if (index < 0 || !open[index]) return false
      if (Math.abs(floor[index] - floor[last]) > stepHeight) return false
      last = index
    }
    return true
  }
}

/**
 * Is there room for a standing player on top of this surface?
 *
 * Anything whose top is within a step of the surface is skipped rather than
 * counted as an obstruction, because that is what a step height *is*: a body
 * walks up onto it instead of stopping against it, and Physics 3D will do
 * exactly that. Without this the staircases in de_dust2 are unwalkable — a
 * half-metre tread is narrower than a player, so from any tread the next one up
 * overlaps the footprint and every flight of stairs reads as a wall.
 */
function clearAbove(solids, x, z, surface, playerHeight, stepHeight, work) {
  const head = surface + playerHeight
  for (const solid of solids) {
    work.overlaps++
    if (solid.maxY <= surface + stepHeight + SKIN) continue
    if (solid.minY >= head - SKIN) continue
    if (x + PLAYER_HALF_WIDTH <= solid.minX + SKIN || x - PLAYER_HALF_WIDTH >= solid.maxX - SKIN) continue
    if (z + PLAYER_HALF_WIDTH <= solid.minZ + SKIN || z - PLAYER_HALF_WIDTH >= solid.maxZ - SKIN) continue
    return false
  }
  return true
}

/** Is there floor under all four corners of the footprint, and not a drop? */
function supported(solids, x, z, surface, stepHeight, work) {
  for (const dx of [-SUPPORT_REACH, SUPPORT_REACH]) {
    for (const dz of [-SUPPORT_REACH, SUPPORT_REACH]) {
      let found = false
      for (const solid of solids) {
        work.probes++
        const cornerX = x + dx, cornerZ = z + dz
        if (cornerX < solid.minX || cornerX > solid.maxX) continue
        if (cornerZ < solid.minZ || cornerZ > solid.maxZ) continue
        if (Math.abs(solid.maxY - surface) > stepHeight) continue
        found = true
        break
      }
      if (!found) return false
    }
  }
  return true
}

/** What a world with nothing to walk on answers, rather than throwing. */
function emptyNavigation(cellSize, why) {
  return {
    cellSize,
    bounds: null,
    regions: [],
    walkable: () => false,
    nearest: () => null,
    path: () => null,
    get stats() {
      return { cellSize, cells: 0, walkable: 0, solids: 0, regions: 0, unreachable: [], why }
    }
  }
}

/**
 * A binary heap, because A star over twenty thousand cells with a sorted array
 * spends all of its time in splice. Scores travel beside the items rather than
 * in objects, so a search allocates two arrays and nothing else.
 */
function makeQueue() {
  const items = [], scores = []
  return {
    get size() { return items.length },
    push(item, score) {
      let child = items.length
      items.push(item); scores.push(score)
      while (child > 0) {
        const parent = (child - 1) >> 1
        if (scores[parent] <= scores[child]) break
        swap(parent, child)
        child = parent
      }
    },
    pop() {
      const top = items[0]
      const lastItem = items.pop(), lastScore = scores.pop()
      if (items.length) {
        items[0] = lastItem; scores[0] = lastScore
        let parent = 0
        for (;;) {
          const left = parent * 2 + 1, right = left + 1
          let smallest = parent
          if (left < items.length && scores[left] < scores[smallest]) smallest = left
          if (right < items.length && scores[right] < scores[smallest]) smallest = right
          if (smallest === parent) break
          swap(parent, smallest)
          parent = smallest
        }
      }
      return top
    }
  }

  function swap(a, b) {
    const item = items[a]; items[a] = items[b]; items[b] = item
    const score = scores[a]; scores[a] = scores[b]; scores[b] = score
  }
}

/** A point written as {x,y,z} or [x,y,z] — an argument typed at a terminal is an array. */
function asPoint(value) {
  if (Array.isArray(value)) return { x: +value[0], y: +value[1], z: +value[2] }
  if (value && typeof value === 'object' && Number.isFinite(value.x)) {
    return { x: value.x, y: value.y, z: value.z }
  }
  return null
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const round = n => Math.round(n * 1000) / 1000

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Bot Navigation',

  onLoad(context) {
    if (context.navigation) {
      console.error('[bot-navigation] something else already put a navigation on context — replacing it')
    }

    let built = null
    let builtAt = 0
    let dirty = true
    let builtFrom = []

    /**
     * Rebuilt lazily rather than on the event itself.
     *
     * `world:changed` fires for every spawn, every destroy and every property
     * an inspector touches. Sampling twenty thousand columns on each of those
     * would cost more than every bot on the map put together, and nothing has
     * asked for a path yet anyway — so the event only marks it stale.
     */
    const navigation = {
      path: (from, to) => current().path(from, to),
      walkable: where => current().walkable(where),
      nearest: where => current().nearest(where),
      get regions() { return current().regions },
      get cellSize() { return current().cellSize },
      get stats() { return { ...current().stats, builtAtTime: round(builtAt) } },
      /** Say it again from scratch. A test or a terminal may want to be sure. */
      rebuild() { built = null; dirty = false; return current().stats }
    }

    /**
     * Has anything a bot could walk into moved?
     *
     * `world:changed` fires for a bullet decal as readily as for a door, and
     * resampling the map because somebody spawned a tracer would cost more than
     * every bot on it. Comparing a few hundred numbers is nothing beside that,
     * and it is the same trick Physics 3D plays with its own broad-phase grid.
     */
    function stale(entities) {
      let index = 0
      for (const entity of entities) {
        if (entity.properties?.body !== 'solid') continue
        if (!Array.isArray(entity.collider?.box) || entity.collider.box.length !== 3) continue
        const was = builtFrom[index++]
        if (!was || was.entity !== entity) return true
        if (was.x !== entity.x || was.y !== entity.y || was.z !== entity.z) return true
        if (was.collider !== entity.collider || was.scale !== entity.scale) return true
      }
      return index !== builtFrom.length
    }

    function current() {
      if (built && dirty) {
        dirty = false
        if (stale(context.world.entities)) built = null
      }
      if (!built) {
        built = buildNavigation(context.world.entities)
        builtFrom = context.world.entities
          .filter(entity => entity.properties?.body === 'solid' &&
            Array.isArray(entity.collider?.box) && entity.collider.box.length === 3)
          .map(entity => ({
            entity, x: entity.x, y: entity.y, z: entity.z,
            collider: entity.collider, scale: entity.scale
          }))
        builtAt = context.time ?? 0
        dirty = false
        if (!built.regions.length) {
          console.error(`[bot-navigation] nothing in "${context.level()}" can be walked on — bots will stand still. ${built.stats.why || 'the solids may be out of a player\'s reach'}`)
        }
      }
      return built
    }

    context.navigation = navigation
    context.bus.on('level:loaded', () => { dirty = true })
    context.bus.on('world:changed', () => { dirty = true })
  },

  commands: [
    {
      id: 'navigation.stats',
      label: 'What the bots can walk on',
      run(context) {
        if (!context.navigation) return { error: 'Bot Navigation did not load' }
        return context.navigation.stats
      }
    },
    {
      id: 'navigation.bots',
      label: 'Every bot, and whether it is getting anywhere',
      /**
       * The verb for the failure this whole file exists to prevent.
       *
       * A bot grinding against a doorframe and a bot holding an angle look
       * identical in a snapshot — same position two seconds running, same
       * state. The difference is in `stuck`, which the brain raises every time
       * it wanted to move and did not, and reading it from here is one call
       * instead of a screenshot and a guess.
       */
      run(context) {
        return context.world.entities
          .filter(entity => entity['bot-brain'])
          .map(entity => {
            const brain = entity['bot-brain']
            return {
              id: entity.id,
              team: entity.properties?.team,
              alive: entity.damageable?.alive !== false,
              state: brain.state,
              at: [round(entity.x), round(entity.y), round(entity.z)],
              speed: round(Math.hypot(entity.velocityX ?? 0, entity.velocityZ ?? 0)),
              stuck: brain.stuck,
              waypoints: brain.path ? brain.path.length - brain.step : 0,
              target: brain.target?.id ?? null,
              triggerPulls: brain.triggerPulls
            }
          })
      }
    },

    {
      id: 'navigation.path',
      label: 'Find a path between two points',
      /**
       * A route is one call from a terminal rather than a script:
       *
       *   run navigation.path '[[42,1,-14],[1,1.3,-25]]'
       *   run navigation.path '{"from":"spawn-t-1","to":"bomb-site-a"}'
       */
      run(context, args) {
        if (!context.navigation) return { error: 'Bot Navigation did not load' }
        const spec = Array.isArray(args) ? { from: args[0], to: args[1] } : (args || {})
        const from = placeOf(context, spec.from)
        const to = placeOf(context, spec.to)
        if (!from || !to) return { error: 'navigation.path needs "from" and "to": [x, y, z] or an entity id' }

        const found = context.navigation.path(from, to)
        if (!found) {
          return {
            from: [round(from.x), round(from.y), round(from.z)],
            to: [round(to.x), round(to.y), round(to.z)],
            path: null,
            why: 'no route — the two ends are in different regions, or neither is near anywhere a player could stand'
          }
        }
        return {
          points: found.length,
          metres: round(found.reduce((total, at, i) =>
            i ? total + Math.hypot(at.x - found[i - 1].x, at.z - found[i - 1].z) : 0, 0)),
          path: found.map(at => [round(at.x), round(at.y), round(at.z)])
        }
      }
    }
  ]
}

/** A point, or an entity id — a route usually starts or ends at something in the map. */
function placeOf(context, value) {
  if (typeof value === 'string') {
    const entity = context.world.byId(value)
    if (!entity) { console.error(`[bot-navigation] no entity "${value}"`); return null }
    return { x: entity.x, y: entity.y, z: entity.z }
  }
  return asPoint(value)
}
