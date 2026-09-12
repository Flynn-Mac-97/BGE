/**
 * Physics 3D — the sibling of Physics 2D, for entities that live in three
 * dimensions.
 *
 * It claims exactly the entities whose collider box has three numbers, and
 * Physics 2D skips exactly those. Two plugins, disjoint sets of entities and
 * nothing to configure: a thing is in the 3D world because of the shape of its
 * collider, not because of a flag somebody remembered to set.
 *
 * The numbers are a metre-scale conversion, done once, here: one unit is
 * 0.0254 m, so 800 units of gravity is 20.32 m/s/s and an 18 unit step is
 * 0.46 m. Everything else in the game can then talk in metres.
 *
 * Runs on the fixed step, like every other simulation system, so `onCollide`
 * fires deterministically and a ray fired from an update hook sees the same
 * world on every replay.
 */
const GRAVITY = -20.32
const STEP_HEIGHT = 0.46

/**
 * Touching is not overlapping. A body resting exactly on a floor, or stepped up
 * so its feet sit exactly on a crate, must come out of the overlap test clean —
 * otherwise resolving one contact immediately creates the next one and a
 * standing body jitters forever.
 */
const TOUCHING = 1e-6

/** A body moving further than this many of its own half-widths cannot be trusted. */
const MAX_SUBSTEPS = 64

const AXES = ['x', 'y', 'z']
const HALF = { x: 'halfWidth', y: 'halfHeight', z: 'halfDepth' }
const VELOCITY = { x: 'velocityX', y: 'velocityY', z: 'velocityZ' }

/** Three numbers in the collider box is the single flag that says "3D". */
export const is3D = entity =>
  Array.isArray(entity?.collider?.box) && entity.collider.box.length === 3

const isSolid = entity => is3D(entity) && entity.properties?.body === 'solid'
const isBody = entity => is3D(entity) && entity.properties?.body === 'dynamic'

/**
 * An entity as the only shape any of this needs: a centre and three half
 * extents, already scaled. Hypothetical positions — where a body would arrive
 * if it stepped up, how tall it wants to stand — are the same shape, so one
 * overlap test serves both.
 */
export function boxFor(entity) {
  const [width, height, depth] = entity.collider.box
  const scale = entity.scale ?? 1
  return {
    x: entity.x, y: entity.y, z: entity.z,
    halfWidth: (width * scale) / 2,
    halfHeight: (height * scale) / 2,
    halfDepth: (depth * scale) / 2
  }
}

const overlap = (a, b) =>
  Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth - TOUCHING &&
  Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight - TOUCHING &&
  Math.abs(a.z - b.z) < a.halfDepth + b.halfDepth - TOUCHING

/**
 * Say it once per entity, not sixty times a second.
 *
 * Silence is the enemy, but a body with a broken collider would otherwise fill
 * the log with the same line until nothing else in it can be read.
 */
const alreadySaid = new Set()
function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[physics-3d] ${message}`)
}

// ------------------------------------------------------------------- the grid
/**
 * A coarse grid over the static solids, because a map is several
 * hundred of them and a dozen moving bodies. Testing every body against every
 * solid every step is the loop that quietly turns into a frame budget problem
 * once a real map is loaded.
 *
 * Binned by X and Z only: a map is wide and flat, so the Y axis buys almost no
 * selectivity for twice the bookkeeping, and the box test that follows checks Y
 * anyway.
 */
const CELL = 4

/** A solid spanning more cells than this is kept aside and always tested. Binning a floor that covers the whole map into 300 cells costs more than it saves. */
const MAX_CELLS = 64

/** Which cell a world coordinate is in, and the key the two indices make. */
const index = value => Math.floor(value / CELL)
const cellKey = (ix, iz) => `${ix},${iz}`

function makeGrid() {
  let cells = new Map()
  let oversize = []
  let built = []


  /**
   * A door that opens is a solid that moved, and a grid that has not noticed is
   * a player walking through a closed door. Comparing what it was built from is
   * a few hundred number compares — nothing beside the box tests it saves.
   */
  const stale = solids => {
    if (solids.length !== built.length) return true
    for (let i = 0; i < solids.length; i++) {
      const was = built[i], now = solids[i]
      if (was.entity !== now) return true
      if (was.x !== now.x || was.y !== now.y || was.z !== now.z) return true
      if (was.collider !== now.collider || was.scale !== now.scale) return true
    }
    return false
  }

  return {
    ensure(world) {
      const solids = world.entities.filter(isSolid)
      if (!stale(solids)) return
      cells = new Map()
      oversize = []
      built = solids.map(solid => ({
        entity: solid, x: solid.x, y: solid.y, z: solid.z,
        collider: solid.collider, scale: solid.scale
      }))

      for (const solid of solids) {
        const box = boxFor(solid)
        const x0 = index(box.x - box.halfWidth), x1 = index(box.x + box.halfWidth)
        const z0 = index(box.z - box.halfDepth), z1 = index(box.z + box.halfDepth)
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) { oversize.push(solid); continue }
        for (let ix = x0; ix <= x1; ix++) {
          for (let iz = z0; iz <= z1; iz++) {
            const list = cells.get(cellKey(ix, iz))
            if (list) list.push(solid)
            else cells.set(cellKey(ix, iz), [solid])
          }
        }
      }
    },

    /** Every solid that could touch this piece of the ground plane. */
    near(minX, maxX, minZ, maxZ) {
      const found = new Set(oversize)
      for (let ix = index(minX); ix <= index(maxX); ix++) {
        for (let iz = index(minZ); iz <= index(maxZ); iz++) {
          for (const solid of cells.get(cellKey(ix, iz)) || []) found.add(solid)
        }
      }
      return found
    },

    get stats() {
      return { cellSize: CELL, cells: cells.size, solids: built.length, oversize: oversize.length }
    }
  }
}

const grid = makeGrid()

// ---------------------------------------------------------------- the raycast
/**
 * Slab test against every entity carrying a three-number collider box, nearest
 * hit wins.
 *
 * This is the function every shot fired in the game is one call to, so it takes
 * the entity list rather than reading a world: the same maths then serves a
 * bullet, a bot's sightline check and a test, with no hidden state between them.
 *
 * `options.ignore` is one entity, one id, or a list of either, to skip — the
 * shooter skips itself. `options.hit` is a predicate; without one, everything
 * with a 3D collider is a candidate.
 */
export function castRay(entities, origin, direction, maxDistance = Infinity, options = {}) {
  const from = asVector(origin)
  const along = normalise(asVector(direction))
  if (!from) {
    report('ray-origin', `raycast needs an origin of three real numbers, as { x, y, z } or [x, y, z] — got ${JSON.stringify(origin)}. Refused rather than moved to the world origin, which would have returned a confident hit on the wrong thing.`)
    return null
  }
  if (!along) {
    report('ray-direction', `raycast needs a direction of three real numbers with a length — got ${JSON.stringify(direction)}`)
    return null
  }

  const reach = maxDistance ?? Infinity
  const skip = new Set(
    asList(options.ignore).map(item => (typeof item === 'string' ? item : item?.id)).filter(Boolean)
  )

  let best = null
  for (const entity of entities) {
    if (!is3D(entity)) continue
    if (skip.has(entity.id)) continue
    if (options.hit && !options.hit(entity)) continue

    const hit = rayBox(from, along, boxFor(entity), reach)
    if (hit && (!best || hit.distance < best.distance)) best = { entity, ...hit }
  }
  return best
}

/**
 * Where a ray enters one box, and which face it entered through.
 *
 * The face is the whole point of returning a normal: a bullet decal has to lie
 * on the wall it hit rather than face the shooter, and the axis that produced
 * the nearest entry is the face the ray came in through.
 */
function rayBox(from, along, box, maxDistance) {
  let nearest = -Infinity, farthest = Infinity, face = 'x'

  for (const axis of AXES) {
    const half = box[HALF[axis]]
    const low = box[axis] - half, high = box[axis] + half

    // Parallel to this pair of faces: the ray is either inside the slab for its
    // whole length or it never enters the box at all. Dividing by zero here is
    // what puts a NaN in the answer instead of a miss.
    if (Math.abs(along[axis]) < 1e-9) {
      if (from[axis] < low || from[axis] > high) return null
      continue
    }

    let enter = (low - from[axis]) / along[axis]
    let exit = (high - from[axis]) / along[axis]
    if (enter > exit) { const swap = enter; enter = exit; exit = swap }
    if (enter > nearest) { nearest = enter; face = axis }
    if (exit < farthest) farthest = exit
    if (nearest > farthest) return null
  }

  // A ray that starts inside a box has already passed its near face. Reporting
  // that face would put the bullet hole behind the shooter, so it is a miss.
  if (nearest < 0 || nearest > maxDistance) return null

  const normal = { x: 0, y: 0, z: 0 }
  normal[face] = along[face] > 0 ? -1 : 1
  return {
    distance: nearest,
    point: {
      x: from.x + along.x * nearest,
      y: from.y + along.y * nearest,
      z: from.z + along.z * nearest
    },
    normal
  }
}

// ---------------------------------------------------------------- the movement
/**
 * One body, one fixed step.
 *
 * Resolved one axis at a time — X, then Z, then Y — moving and pushing out
 * before the next axis is touched. That order is what makes a body slide along
 * a wall instead of sticking to it: only the blocked axis loses its velocity.
 */
function simulateBody(body, seconds, others) {
  const box = boxFor(body)
  const smallest = Math.min(box.halfWidth, box.halfHeight, box.halfDepth)
  if (!(smallest > 0)) {
    report(body.id, `${body.id} has a collider box with a side of zero, so it cannot be simulated`)
    return
  }

  // Gravity is a property, so it is whatever the level file or a command last
  // wrote there — including a string, which turns velocityY into NaN on the
  // first step and takes the body out of the simulation for good.
  let gravity = body.properties.gravity ?? GRAVITY
  if (!Number.isFinite(gravity)) {
    report(`${body.id}-gravity`, `${body.id} has a gravity of ${JSON.stringify(body.properties.gravity)}, which is not a number — using ${GRAVITY} instead, or this body would stop being simulated`)
    gravity = GRAVITY
  }

  body.velocityX = body.velocityX ?? 0
  body.velocityZ = body.velocityZ ?? 0
  body.velocityY = (body.velocityY ?? 0) + gravity * seconds

  /**
   * A non-finite velocity freezes a body forever, and silently.
   *
   * The sub-step count below is `Math.max(1, Math.ceil(travel / smallest))`, and
   * `Math.max(1, NaN)` is NaN rather than 1 — so the guard that was meant to
   * floor it does not, the loop runs zero times, and the body simply stops
   * moving with nothing in the log. One `0 / 0` in a movement behaviour is all
   * it takes, and the symptom looks exactly like a bug in the behaviour.
   */
  for (const axis of AXES) {
    const key = VELOCITY[axis]
    if (Number.isFinite(body[key])) continue
    report(`${body.id}-${key}`, `${body.id} has a ${key} of ${body[key]} — zeroed so it keeps being simulated, but something upstream is dividing by zero or reading a missing number`)
    body[key] = 0
  }

  // Whether it may step up is asked of where it stood when the step began.
  // Stepping in mid-air is how a player climbs a sheer wall by walking at it.
  const stoodAtStart = body.grounded === true
  body.grounded = false

  const travel = Math.hypot(body.velocityX, body.velocityY, body.velocityZ) * seconds
  // Split the step when the body would move further than its own smallest half
  // extent, so something fast still cannot pass through a thin wall between one
  // step and the next.
  // `|| 1` and not `Math.max(1, …)` alone: the velocities above are finite by
  // now, but `seconds` arrives from the loop and a NaN anywhere in this sum
  // would slip straight through Math.max and stop the loop below dead.
  let parts = Math.max(1, Math.ceil(travel / smallest) || 1)
  if (parts > MAX_SUBSTEPS) {
    report(`${body.id}-fast`, `${body.id} moved ${round(travel)}m in one step, far more than its own size — it may pass through thin walls`)
    parts = MAX_SUBSTEPS
  }

  const blockers = blockersAround(body, box, travel, others)
  const stepHeight = body.properties.stepHeight ?? STEP_HEIGHT
  const slice = seconds / parts

  for (let part = 0; part < parts; part++) {
    const mayStep = (stoodAtStart || body.grounded) ? stepHeight : 0
    moveAlong(body, 'x', body.velocityX * slice, blockers, mayStep)
    moveAlong(body, 'z', body.velocityZ * slice, blockers, mayStep)
    moveAlong(body, 'y', body.velocityY * slice, blockers, 0)
  }
}

/**
 * How far a body could move this step.
 *
 * The gravity term is included because `simulateBody` adds gravity to the
 * velocity after this is read, so the speed here is one step out of date.
 */
const reachOf = (body, seconds) =>
  Math.hypot(body.velocityX || 0, body.velocityY || 0, body.velocityZ || 0) * seconds +
  Math.abs(body.properties?.gravity ?? GRAVITY) * seconds * seconds

/**
 * Bin the dynamic bodies on the ground plane, by the footprint each could
 * reach this step.
 *
 * Rebuilt every step, because they move, and padded on both sides: a body is
 * binned by where it could get to and asks for where it could get to, so two
 * bodies that end the step touching always shared a cell at the start of it.
 *
 * Without this, every body tests against every other one and the step is
 * quadratic in the body count — 0.4 ms at fifty bodies and 87 ms at eight
 * hundred.
 */
function binBodies(bodies, seconds) {
  const cells = new Map()
  const everywhere = []

  bodies.forEach((body, at) => {
    const box = boxFor(body)
    const reach = reachOf(body, seconds)
    const x0 = index(box.x - box.halfWidth - reach), x1 = index(box.x + box.halfWidth + reach)
    const z0 = index(box.z - box.halfDepth - reach), z1 = index(box.z + box.halfDepth + reach)
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) { everywhere.push(at); return }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = cells.get(cellKey(ix, iz))
        if (list) list.push(at)
        else cells.set(cellKey(ix, iz), [at])
      }
    }
  })

  return {
    /**
     * The bodies that could touch this piece of the ground plane, in world
     * order. Indices are binned rather than bodies so the order is the order
     * the entity list is in, whatever order the cells are visited: a body
     * overlapping two others is resolved against them in the same sequence a
     * full scan would have used.
     */
    near(minX, maxX, minZ, maxZ) {
      const found = new Set(everywhere)
      for (let ix = index(minX); ix <= index(maxX); ix++) {
        for (let iz = index(minZ); iz <= index(maxZ); iz++) {
          for (const at of cells.get(cellKey(ix, iz)) || []) found.add(at)
        }
      }
      return [...found].sort((first, second) => first - second).map(at => bodies[at])
    }
  }
}

/**
 * What this body could reach this step: the solids near the whole swept path,
 * plus the bodies near it.
 *
 * Two dynamic bodies block each other but never push each other — deciding who
 * yields needs a mass model this does not have, and standing on another player
 * is a deliberate move rather than a bug.
 */
function blockersAround(body, box, travel, others) {
  const minX = box.x - box.halfWidth - travel, maxX = box.x + box.halfWidth + travel
  const minZ = box.z - box.halfDepth - travel, maxZ = box.z + box.halfDepth + travel
  const found = [...grid.near(minX, maxX, minZ, maxZ)]
  for (const other of others.near(minX, maxX, minZ, maxZ)) if (other !== body) found.push(other)
  return found
}

/**
 * Move along one axis, then push the body out of everything that move put it
 * inside.
 *
 * Moving on all three axes and then pushing out along the shallowest overlap —
 * which is what the 2D plugin does, and can afford to — picks the wrong axis
 * constantly in three dimensions, and the symptom is players launched through
 * floors.
 */
function moveAlong(body, axis, distance, blockers, stepHeight) {
  body[axis] += distance
  let box = boxFor(body)

  for (const blocker of blockers) {
    const other = boxFor(blocker)
    if (!overlap(box, other)) continue

    if (stepHeight > 0 && stepUp(body, box, other, blockers, stepHeight)) {
      box = boxFor(body)
      continue
    }

    // Perfectly concentric is a tie. Break it against the direction of travel,
    // because that is the side the body came in from.
    const side = Math.sign(box[axis] - other[axis]) || -Math.sign(distance) || 1
    const push = box[HALF[axis]] + other[HALF[axis]] - Math.abs(box[axis] - other[axis])
    body[axis] += push * side
    box = boxFor(body)
    body[VELOCITY[axis]] = 0

    // Having been pushed up out of something is what standing on it means.
    if (axis === 'y' && side > 0) body.grounded = true
  }
}

/**
 * Walk up onto something instead of stopping against it.
 *
 * Without this every doorway lip and crate edge in a map is a
 * wall. The lift is refused unless the body fits where it would arrive, so a
 * body can never step up into something it would not then fit under.
 */
function stepUp(body, box, other, blockers, stepHeight) {
  const rise = other.y + other.halfHeight - (box.y - box.halfHeight)
  if (rise <= 0 || rise > stepHeight) return false

  const lifted = { ...box, y: box.y + rise }
  for (const blocker of blockers) if (overlap(lifted, boxFor(blocker))) return false

  body.y = lifted.y
  return true
}

/**
 * Could this entity be this tall, where it stands?
 *
 * Grown about its feet rather than its centre, because that is how a player
 * stands up. It is the reason standing up from a crouch under a vent correctly
 * refuses.
 */
function canStand(world, entity, height) {
  if (!is3D(entity)) {
    report(`stand-${entity?.id}`, `canStand(${entity?.id}) — that entity has no three-number collider box`)
    return true
  }
  /**
   * Refused, not waved through.
   *
   * `halfHeight: height / 2` is NaN when the height is undefined or a string,
   * every comparison against NaN is false, so `overlap` finds nothing and this
   * function cheerfully reports room that was never measured. The player then
   * stands up inside a ceiling. A question this function cannot answer has to
   * answer "no": refusing to stand is a movement that looks stuck, and standing
   * inside geometry is a movement that looks impossible.
   */
  if (!Number.isFinite(height) || height <= 0) {
    report(`stand-height-${entity?.id}`, `canStand(${entity?.id}, ${JSON.stringify(height)}) — a height must be a positive number of metres. Refusing, because the alternative is reporting room that was never measured and standing a player up inside a ceiling.`)
    return false
  }
  const box = boxFor(entity)
  const grown = { ...box, y: box.y - box.halfHeight + height / 2, halfHeight: height / 2 }

  grid.ensure(world)
  for (const solid of grid.near(
    grown.x - grown.halfWidth, grown.x + grown.halfWidth,
    grown.z - grown.halfDepth, grown.z + grown.halfDepth
  )) {
    if (overlap(grown, boxFor(solid))) return false
  }
  return true
}

// ---------------------------------------------------------------- the contacts
/** Pairs touching as of the last step, so a contact is reported once rather than every step. */
let contacts = new Set()

const pairKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`)

/**
 * Report contacts once, on the step they begin — the same promise Physics 2D
 * makes, so a behaviour can answer a collision in either world.
 *
 * Only things that are not solid start a pair, which is both how solid against
 * solid is skipped and why this costs a few dozen tests rather than the square
 * of the map.  A trigger reports contacts and pushes nothing, which is how a
 * goal marker knows a player is standing in it.
 *
 * The movers are binned on the ground plane before they are compared, in the
 * same cells the solids already use. Testing every mover against every other
 * one is the square of the crowd, and a crowd is exactly what a game reaches
 * for once the engine can carry one: 200 bodies standing still cost 10 ms of a
 * 16 ms step, and 500 cost 57 ms — measured, on the meadow, with nothing else
 * running. Binning them makes it the number of bodies times the number near
 * each, which is flat as the crowd grows.
 *
 * The overlap test also comes before the pair key now. A key is a string, and
 * building one per candidate pair rather than per touching pair was most of
 * what was left.
 */
function reportContacts(world, context) {
  const movers = world.entities.filter(e => is3D(e) && e.properties?.body !== 'solid')
  const seen = new Set()
  const count = movers.length
  if (!count) { contacts = seen; return }

  const boxes = new Array(count)
  const bins = new Map()
  // A mover covering more cells than it is worth binning — a trigger volume
  // across a whole level — is compared with everything, exactly as an oversize
  // solid is.
  const everywhere = []

  for (let i = 0; i < count; i++) {
    const box = boxFor(movers[i])
    boxes[i] = box
    const x0 = Math.floor((box.x - box.halfWidth) / CELL)
    const x1 = Math.floor((box.x + box.halfWidth) / CELL)
    const z0 = Math.floor((box.z - box.halfDepth) / CELL)
    const z1 = Math.floor((box.z + box.halfDepth) / CELL)
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) { everywhere.push(i); continue }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = cellKey(ix, iz)
        const list = bins.get(key)
        if (list) list.push(i)
        else bins.set(key, [i])
      }
    }
  }

  /** One pair, at most once, however many cells the two of them share. */
  const touch = (i, j) => {
    if (i === j) return
    if (!overlap(boxes[i], boxes[j])) return
    const key = pairKey(movers[i], movers[j])
    if (seen.has(key)) return
    seen.add(key)
    if (contacts.has(key)) return
    // Through world.hook, so a behaviour can answer a collision too — a
    // trigger should not have to be written into every type that wants it.
    world.hook(movers[i], 'onCollide', movers[j], context)
    world.hook(movers[j], 'onCollide', movers[i], context)
  }

  for (const list of bins.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) touch(list[a], list[b])
    }
  }
  for (const i of everywhere) for (let j = 0; j < count; j++) touch(i, j)

  for (let i = 0; i < count; i++) {
    const box = boxes[i]
    for (const solid of grid.near(
      box.x - box.halfWidth, box.x + box.halfWidth,
      box.z - box.halfDepth, box.z + box.halfDepth
    )) {
      if (!overlap(box, boxFor(solid))) continue
      const key = pairKey(movers[i], solid)
      if (seen.has(key)) continue
      seen.add(key)
      if (contacts.has(key)) continue
      world.hook(movers[i], 'onCollide', solid, context)
      world.hook(solid, 'onCollide', movers[i], context)
    }
  }

  contacts = seen
}

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Physics 3D',

  category: 'engine',
  onLoad(context) {
    if (context.raycast) {
      console.error('[physics-3d] something else already put a raycast on context — replacing it')
    }

    context.raycast = (origin, direction, maxDistance, options) =>
      castRay(context.world.entities, origin, direction, maxDistance ?? Infinity, options || {})

    context.canStand = (entity, height) => canStand(context.world, entity, height)

    // A level reload builds new entities under the same ids, and a contact
    // remembered from the last one would swallow the first onCollide of the
    // new. A fault already reported is forgotten with it, so the next level
    // gets told about its own problems rather than inheriting a silence.
    context.bus.on('level:loaded', () => {
      contacts = new Set()
      alreadySaid.clear()
    })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      grid.ensure(world)
      const bodies = world.entities.filter(isBody)
      const moving = binBodies(bodies, seconds)
      for (const body of bodies) simulateBody(body, seconds, moving)
      reportContacts(world, context)
    }
  }],

  commands: [
    {
      id: 'physics3d.raycast',
      label: 'Cast a ray and say what it hit',
      /**
       * A sightline is one call from the terminal rather than a script:
       *
       *   run physics3d.raycast '[[0,1.6,0],[0,0,-1],40]'
       *   run physics3d.raycast '{"from":"player-0","to":"goal-a"}'
       *
       * `from` and `to` take an entity id as well as a point, and a ray fired
       * from an entity skips that entity — a shooter never hits itself.
       */
      run(context, args) {
        const spec = Array.isArray(args)
          ? { from: args[0], direction: args[1], maxDistance: args[2] }
          : (args || {})

        const from = pointOf(context, spec.from)
        if (!from) return { error: 'raycast needs "from": [x, y, z] or an entity id' }

        // Through asList for the same reason castRay does: `"ignore": "player-0"`
        // is the shape anybody types first, and spreading a string gives you
        // eight one-letter ids that match nothing.
        const ignore = [...asList(spec.ignore)]
        if (typeof spec.from === 'string') ignore.push(spec.from)

        let direction = spec.direction ? asVector(spec.direction) : null
        // JSON has no Infinity, and no map is a kilometre across.
        let maxDistance = spec.maxDistance ?? 1000

        if (spec.to !== undefined) {
          const to = pointOf(context, spec.to)
          if (!to) return { error: 'raycast "to" is not a point or an entity id' }
          direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
          if (spec.maxDistance === undefined) maxDistance = Math.hypot(direction.x, direction.y, direction.z)
        }

        const along = normalise(direction)
        if (!along) return { error: 'raycast needs a "direction" with a length, or a "to"' }

        const hit = context.raycast(from, along, maxDistance, { ignore })
        return {
          from: [round(from.x), round(from.y), round(from.z)],
          direction: [round(along.x), round(along.y), round(along.z)],
          maxDistance: round(maxDistance),
          hit: hit && {
            entity: hit.entity.id,
            type: hit.entity.type,
            distance: round(hit.distance),
            point: [round(hit.point.x), round(hit.point.y), round(hit.point.z)],
            normal: [hit.normal.x, hit.normal.y, hit.normal.z]
          }
        }
      }
    },

    {
      id: 'physics3d.bodies',
      label: 'What Physics 3D is simulating',
      run(context) {
        grid.ensure(context.world)
        const claimed = context.world.entities.filter(is3D)
        return {
          bodies: claimed.filter(isBody).map(body => ({
            id: body.id,
            at: [round(body.x), round(body.y), round(body.z)],
            velocity: [round(body.velocityX ?? 0), round(body.velocityY ?? 0), round(body.velocityZ ?? 0)],
            grounded: body.grounded === true,
            box: body.collider.box
          })),
          against: {
            solids: claimed.filter(isSolid).length,
            triggers: claimed.filter(e => e.properties?.body === 'trigger').length,
            other: claimed.filter(e => !isBody(e) && !isSolid(e) && e.properties?.body !== 'trigger').length
          },
          contacts: [...contacts],
          grid: grid.stats
        }
      }
    }
  ]
}

// ------------------------------------------------------------------ small print
/**
 * A point written as {x,y,z} or [x,y,z] — a hand-typed argument is an array.
 *
 * Every component has to be a real number, and a vector where one is not is
 * refused rather than repaired. `+value[0] || 0` used to rewrite a bad
 * coordinate to zero, which moved the ray to the world origin and then returned
 * a hit — a confident, precise, completely wrong answer about what a bullet
 * struck. There is no safe default for "where the shot came from".
 */
function asVector(value) {
  const written =
    Array.isArray(value) ? [value[0], value[1], value[2]]
    : (value && typeof value === 'object') ? [value.x, value.y, value.z]
    : null
  if (!written) return null
  const [x, y, z] = written.map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return { x, y, z }
}

/**
 * One entity, one id, or a list of either — whichever the caller had to hand.
 *
 * `(options.ignore || []).map(...)` threw outright on a bare id string, which is
 * the shape everybody reaches for first, and it threw from inside a bullet. A
 * shot that raises an exception halfway through a fixed step is worse than a
 * shot that hits the shooter.
 */
function asList(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string' || typeof value === 'object') return [value]
  report('ray-ignore', `raycast "ignore" must be an entity, an entity id, or a list of either — got ${typeof value} (${JSON.stringify(value)}). Nothing was ignored, so this shot can hit its own shooter.`)
  return []
}

/** The same, plus an entity id, because a sightline usually starts at somebody. */
function pointOf(context, value) {
  if (typeof value === 'string') {
    const entity = context.world.byId(value)
    if (!entity) { console.error(`[physics-3d] no entity "${value}"`); return null }
    return { x: entity.x, y: entity.y, z: entity.z }
  }
  return asVector(value)
}

/**
 * Callers are meant to hand in a unit vector, and one typed at a terminal never
 * is. Normalising here keeps `distance` in metres whichever way it arrived.
 */
function normalise(vector) {
  if (!vector) return null
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!(length > 0)) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

const round = n => Math.round(n * 1000) / 1000
