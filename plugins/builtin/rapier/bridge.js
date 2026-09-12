/**
 * The engine side of Rapier, written once for both dimensions.
 *
 * Rapier owns the transform of everything it simulates; the entity is still
 * the authority on everything else, so each step pulls what the game wrote
 * (a velocity from a behaviour, a position from an editor drag), steps, and
 * writes the result back onto the entity. Nothing else in the engine has to
 * know which solver is running.
 *
 * The contract it fills is the hand-written plugins': claim by collider shape,
 * read `properties.body`, write `velocity*` and `grounded`, and report a
 * contact once on the step it begins through `world.hook`.
 */

/** Metres per second per second. The hand-written 3D plugin's number. */
export const GRAVITY_3D = -20.32
export const GRAVITY_2D = -22

/** A body is grounded when a contact normal is this vertical. */
const UPRIGHT = 0.5

const RADIANS = 180 / Math.PI

/**
 * A quaternion as the engine's rotation: degrees, in the YXZ order the
 * renderer reads them in.
 */
export function degreesOf({ x, y, z, w }) {
  const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + y * w)
  const m21 = 2 * (x * y + z * w), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w)
  const m31 = 2 * (x * z - y * w), m33 = 1 - 2 * (x * x + y * y)
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m23)))
  const clear = Math.abs(m23) < 0.9999999
  return [
    pitch * RADIANS,
    (clear ? Math.atan2(m13, m33) : Math.atan2(-m31, m11)) * RADIANS,
    (clear ? Math.atan2(m21, m22) : 0) * RADIANS
  ]
}

/** The engine's rotation as a quaternion. A bare number is yaw. */
export function quaternionOf(rotation) {
  const [x, y, z] = Array.isArray(rotation)
    ? rotation.map(angle => (Number(angle) || 0) / RADIANS)
    : [0, (Number(rotation) || 0) / RADIANS, 0]
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2)
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2)
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2)
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  }
}

/** Say it once per subject, not sixty times a second. */
function makeReporter(tag) {
  const said = new Set()
  return (key, message) => {
    if (said.has(key)) return
    said.add(key)
    console.error(`[${tag}] ${message}`)
  }
}

/**
 * One live Rapier world, kept in step with the entity list.
 *
 * `claims` decides which entities are ours, so the two dimensions stay
 * disjoint sets with nothing to configure. `flat` is true for the 2D build,
 * whose vectors have no z and whose rotation is one angle.
 */
export function makeBridge({ RAPIER, tag, claims, flat, gravity }) {
  const report = makeReporter(tag)
  const tracked = new Map()
  const byCollider = new Map()
  let world = null
  let events = null

  const vector = (x, y, z) => (flat ? { x, y } : { x, y, z })
  const of = entity => vector(entity.x || 0, entity.y || 0, entity.z || 0)

  /**
   * The collider description for an entity. `collider.circle` is a radius and
   * `collider.box` is full sides, so only the box is halved.
   */
  function shapeOf(entity) {
    const scale = entity.scale ?? 1
    const radius = Number(entity.collider?.circle)
    if (radius > 0) return RAPIER.ColliderDesc.ball(radius * scale)
    const box = entity.collider?.box
    if (!Array.isArray(box)) return null
    const half = box.map(side => (Number(side) * scale) / 2)
    if (half.some(side => !(side > 0))) return null
    return flat
      ? RAPIER.ColliderDesc.cuboid(half[0], half[1])
      : RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
  }

  const kindOf = entity => {
    const body = entity.properties?.body
    return body === 'dynamic' || body === 'solid' ? body : 'sensor'
  }

  /**
   * What the body was built from. Rapier cannot change a shape or a body kind
   * in place, so a change here means building it again.
   *
   * A solid's rotation is in here because it is baked into the body at build
   * time; a dynamic body's is not, because Rapier owns it from then on.
   */
  const signatureOf = entity => JSON.stringify([
    entity.collider, entity.scale ?? 1, kindOf(entity), entity.properties?.gravity,
    kindOf(entity) === 'dynamic' ? null : entity.rotation ?? null
  ])

  function build(entity) {
    const shape = shapeOf(entity)
    if (!shape) {
      report(entity.id, `${entity.id} has a collider Rapier cannot build — it is not simulated`)
      return null
    }
    const kind = kindOf(entity)
    const description = kind === 'dynamic' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed()
    description.setTranslation(...(flat ? [entity.x || 0, entity.y || 0] : [entity.x || 0, entity.y || 0, entity.z || 0]))
    // A rotated wall has to arrive rotated, or the level's angled geometry is
    // simulated as axis-aligned boxes.
    if (entity.rotation !== undefined && entity.rotation !== null) {
      description.setRotation(flat ? (Number(entity.rotation) || 0) / RADIANS : quaternionOf(entity.rotation))
    }
    const body = world.createRigidBody(description)

    // Per-body gravity is a scale here, because Rapier's gravity is the
    // world's. A body that declares the default scales by one.
    const own = Number(entity.properties?.gravity)
    if (Number.isFinite(own) && own !== gravity) body.setGravityScale(own / gravity, true)

    shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    if (kind === 'sensor') shape.setSensor(true)
    const collider = world.createCollider(shape, body)

    byCollider.set(collider.handle, entity)
    return { body, collider, signature: signatureOf(entity), wrote: null }
  }

  function drop(entity, entry) {
    byCollider.delete(entry.collider.handle)
    world.removeRigidBody(entry.body)
    tracked.delete(entity)
  }

  /** Build, rebuild and remove bodies so the Rapier world matches the entity list. */
  function reconcile(entities) {
    const mine = new Set()
    for (const entity of entities) {
      if (!claims(entity)) continue
      mine.add(entity)
      const entry = tracked.get(entity)
      if (entry && entry.signature === signatureOf(entity)) continue
      if (entry) drop(entity, entry)
      const made = build(entity)
      if (made) tracked.set(entity, made)
    }
    for (const [entity, entry] of tracked) if (!mine.has(entity)) drop(entity, entry)
  }

  /**
   * Push what the game wrote into the body.
   *
   * Only a value that differs from what this bridge last wrote is pushed, so
   * an editor drag or a behaviour setting a velocity wins, and a body Rapier
   * is simulating is not teleported back onto itself every step.
   */
  function pull(entity, entry) {
    const wrote = entry.wrote
    const at = of(entity)
    const moved = !wrote ||
      Math.abs(at.x - wrote.at.x) > 1e-6 || Math.abs(at.y - wrote.at.y) > 1e-6 ||
      (!flat && Math.abs(at.z - wrote.at.z) > 1e-6)
    if (moved) entry.body.setTranslation(at, true)

    if (kindOf(entity) !== 'dynamic') return
    const speed = vector(entity.velocityX ?? 0, entity.velocityY ?? 0, entity.velocityZ ?? 0)
    const set = !wrote ||
      Math.abs(speed.x - wrote.speed.x) > 1e-6 || Math.abs(speed.y - wrote.speed.y) > 1e-6 ||
      (!flat && Math.abs(speed.z - wrote.speed.z) > 1e-6)
    if (set) entry.body.setLinvel(speed, true)
  }

  /** Write the simulated transform, velocity and grounded flag onto the entity. */
  function push(entity, entry) {
    if (kindOf(entity) !== 'dynamic') { entry.wrote = { at: of(entity), speed: vector(0, 0, 0) }; return }
    const at = entry.body.translation()
    const speed = entry.body.linvel()
    entity.x = at.x
    entity.y = at.y
    if (!flat) entity.z = at.z
    entity.velocityX = speed.x
    entity.velocityY = speed.y
    if (!flat) entity.velocityZ = speed.z
    entity.rotation = flat
      ? entry.body.rotation() * RADIANS
      : degreesOf(entry.body.rotation())
    entity.grounded = grounded(entry)
    entry.wrote = { at: vector(at.x, at.y, flat ? 0 : at.z), speed: vector(speed.x, speed.y, flat ? 0 : speed.z) }
  }

  /**
   * Standing on something means a contact pushing this body upward.
   *
   * `manifold.normal()` points out of the pair's stored first collider, not
   * out of the one asked about, and `flipped` says which of the two this body
   * is. So the normal points at this body when flipped and away from it when
   * not, and the sign has to follow.
   */
  function grounded(entry) {
    let standing = false
    world.contactPairsWith(entry.collider, other => {
      if (standing) return
      world.contactPair(entry.collider, other, (manifold, flipped) => {
        const normal = manifold.normal()
        if ((flipped ? normal.y : -normal.y) > UPRIGHT) standing = true
      })
    })
    return standing
  }

  /** Both sides of every contact that began this step, through world.hook. */
  function tell(gameWorld, context) {
    events.drainCollisionEvents((first, second, started) => {
      if (!started) return
      const a = byCollider.get(first)
      const b = byCollider.get(second)
      if (!a || !b) return
      gameWorld.hook(a, 'onCollide', b, context)
      gameWorld.hook(b, 'onCollide', a, context)
    })
  }

  return {
    get ready() { return world !== null },
    get rapierWorld() { return world },
    get bodies() { return tracked },
    entityFor: handle => byCollider.get(handle),

    start() {
      world = new RAPIER.World(vector(0, gravity, 0))
      events = new RAPIER.EventQueue(true)
    },

    /** One fixed step. A held world passes zero seconds, and nothing moves. */
    step(gameWorld, seconds, context) {
      if (!world || !(seconds > 0)) return
      reconcile(gameWorld.entities)
      for (const [entity, entry] of tracked) pull(entity, entry)
      world.timestep = seconds
      world.step(events)
      for (const [entity, entry] of tracked) push(entity, entry)
      tell(gameWorld, context)
    },

    /** A level reload builds new entities, so every body belongs to the last one. */
    forget() {
      if (!world) return
      for (const [entity, entry] of [...tracked]) drop(entity, entry)
      byCollider.clear()
    },

    /** The same bytes on every machine, which is what makes a replay provable. */
    snapshot() { return world?.takeSnapshot() || null },

    stats() {
      let dynamic = 0, fixed = 0, sensor = 0, asleep = 0
      for (const [entity, entry] of tracked) {
        const kind = kindOf(entity)
        if (kind === 'dynamic') { dynamic++; if (entry.body.isSleeping()) asleep++ }
        else if (kind === 'solid') fixed++
        else sensor++
      }
      // A sleeping body costs nothing to simulate, so this is the number that
      // says whether a big scene has settled.
      return { dynamic, solid: fixed, sensors: sensor, asleep, gravity }
    }
  }
}
