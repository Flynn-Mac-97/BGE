/**
 * Particles — dust, smoke, sparks, blood and the flash.
 *
 *   context.particles.burst({ at: hit.point, direction: hit.normal, count: 12,
 *                             speed: [1, 3], life: 0.5, size: 0.04,
 *                             colour: '#cdba90', gravity: -9, drag: 2 })
 *   context.particles.trail(grenade, { rate: 40, life: 1.2, colour: '#8a8a8a' })
 *   context.particles.blocked(eye, target)          // is there smoke in the way?
 *
 * Three things make this an engine feature rather than a bag of sprites.
 *
 * 1. **It is deterministic.** Every particle's direction, speed, size and life
 *    comes out of `context.random`, and every one of them steps on the fixed
 *    clock. The same seed gives the same smoke, in the same places, on the
 *    tenth replay as on the first. That is not pedantry: it is the only reason
 *    a test can assert that a grenade produced a cloud, and the only reason two
 *    agents running the same level see the same thing.
 *
 * 2. **It draws in one buffer, not one mesh per particle.** A smoke grenade is
 *    a thousand particles, and a thousand meshes is a thousand draw calls for
 *    something the eye reads as one grey shape. They are camera-facing quads in
 *    a shared buffer geometry, grouped by texture, so a screen full of smoke,
 *    sparks and blood is three draw calls.
 *
 * 3. **Every burst is recorded, whether or not anyone saw it.** A headless run
 *    answers `node bin/engine.mjs run particles.recent` exactly the way the
 *    audio plugin answers "did that make a noise". Nothing about drawing is
 *    required for a burst to have happened.
 *
 * The bottom of the file wires the game's own events to named effects. That
 * part is a table and a handful of listeners: replace the table and this is a
 * different game's particle system, not a different engine's.
 */

/**
 * How many particles are alive at once, across every burst.
 *
 * A smoke grenade is a thousand of them and two smokes overlapping is normal
 * play, so the ceiling has to be well clear of that; a browser tab walking a
 * flat array of ten thousand objects sixty times a second is not. When the
 * ceiling is reached the oldest particle goes, because the oldest is the one
 * closest to dying anyway and losing it is the least visible thing to lose.
 */
const MAX_PARTICLES = 3000

/** How many bursts are remembered for inspection. */
const RING = 40

/**
 * The shortest a particle may live.
 *
 * One fixed step, because a particle that expires before the next frame is
 * drawn is a particle nobody ever sees — and a `life: 0` typed by hand should
 * flash once rather than do nothing at all.
 */
const MINIMUM_LIFE = 1 / 60

// ------------------------------------------------------------------- the field
/**
 * Every particle in the world, the clouds that block sight, and the trails
 * still emitting.
 *
 * Built by a factory so a test can make one of its own with its own random
 * stream — which is how "the same seed gives the same smoke" is asserted
 * without a way to reseed the running world.
 */
export function makeParticleField() {
  const live = []
  const clouds = []
  const trails = []
  const bursts = []
  let random = null
  let clock = () => 0
  let dropped = 0
  let nextTrail = 1

  /**
   * A number, or a number picked between two.
   *
   * `speed: 3` and `speed: [1, 4]` are both things a person writes, and the
   * second is what stops a burst looking like a firework. One draw from the
   * stream either way it is written, so the option shape cannot change the
   * sequence for anything after it.
   */
  const span = value => (Array.isArray(value) ? random.range(Number(value[0]) || 0, Number(value[1]) || 0) : (Number(value) || 0))

  /**
   * A unit vector inside a cone about `direction`, or anywhere at all without
   * one.
   *
   * Both cases are the same two draws — a cosine and an angle around the axis —
   * because a full sphere is just a cone with a half-angle of pi. Sampling the
   * cosine rather than the angle is what keeps the density even; sampling the
   * angle bunches every burst towards its own axis.
   */
  function coneDirection(direction, spread) {
    const limit = Math.cos(Math.max(0, Math.min(Math.PI, spread)))
    const cosine = 1 - random() * (1 - limit)
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine))
    const around = random() * Math.PI * 2
    const local = { x: Math.cos(around) * sine, y: Math.sin(around) * sine, z: cosine }
    if (!direction) return local

    // Build a frame whose +Z is the direction asked for. The helper is swapped
    // near the poles, because a cross product with a parallel vector has no
    // length and every particle would come out at the origin.
    const helper = Math.abs(direction.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    const tangent = normalise(cross(helper, direction)) || { x: 1, y: 0, z: 0 }
    const bitangent = cross(direction, tangent)
    return {
      x: tangent.x * local.x + bitangent.x * local.y + direction.x * local.z,
      y: tangent.y * local.x + bitangent.y * local.y + direction.y * local.z,
      z: tangent.z * local.x + bitangent.z * local.y + direction.z * local.z
    }
  }

  /** Everything a burst decided once, so the per-particle loop only draws randoms. */
  function readOptions(options) {
    const direction = normalise(asVector(options.direction))
    return {
      direction,
      // A burst that named a direction meant a spray; one that did not meant a
      // puff. Both are what the word "spread" means in each case.
      spread: options.spread === undefined ? (direction ? 0.4 : Math.PI) : Number(options.spread) || 0,
      speed: options.speed ?? 0,
      life: options.life ?? 1,
      size: options.size ?? 0.08,
      grow: Number(options.grow) || 0,
      gravity: Number(options.gravity) || 0,
      drag: Math.max(0, Number(options.drag) || 0),
      fade: options.fade !== false,
      colour: options.colour ?? '#ffffff',
      texture: options.texture || '',
      blend: options.blend === 'add' ? 'add' : 'normal'
    }
  }

  /**
   * Make room for `wanted` more, by dropping the oldest.
   *
   * In one splice rather than one shift each: a smoke grenade arriving at a
   * full field would otherwise walk the whole array nine hundred times in a
   * single step, which is a visible hitch at exactly the moment nobody can
   * afford one.
   */
  function makeRoom(wanted) {
    const over = live.length + wanted - MAX_PARTICLES
    if (over <= 0) return
    const going = Math.min(over, live.length)
    live.splice(0, going)
    dropped += going
  }

  function emit(shape, x, y, z) {
    // The ceiling again, because a trail emits one at a time and never asked
    // for room in advance.
    makeRoom(1)

    const along = coneDirection(shape.direction, shape.spread)
    const speed = span(shape.speed)
    const life = Math.max(MINIMUM_LIFE, span(shape.life))
    const size = Math.max(0, span(shape.size))
    const colour = Array.isArray(shape.colour) ? random.pick(shape.colour) : shape.colour

    live.push({
      x, y, z,
      velocityX: along.x * speed,
      velocityY: along.y * speed,
      velocityZ: along.z * speed,
      age: 0, life, size,
      grow: shape.grow,
      gravity: shape.gravity,
      drag: shape.drag,
      fade: shape.fade,
      colour,
      texture: shape.texture,
      blend: shape.blend
    })
  }

  const field = {
    /**
     * The two things a particle needs that it may not reach for itself: a
     * replayable random stream and the engine clock. Handed in, so this file
     * has no way to touch `Math.random` or the wall clock even by accident.
     */
    bind(randomSource, timeSource) { random = randomSource; clock = timeSource },
    get bound() { return !!random },

    get count() { return live.length },
    /** Read, do not mutate — the renderer walks this every frame. */
    get all() { return live },
    get clouds() { return clouds },

    /**
     * One burst.
     *
     * @param at        where it starts, in world metres
     * @param to        optional: spread the particles evenly from `at` to here,
     *                  which is what makes a tracer rather than a puff
     * @param count     how many
     * @param direction optional axis for the spray; without one it goes everywhere
     * @param spread    half-angle in radians about that axis
     * @param speed     metres per second, or [slowest, fastest]
     * @param life      seconds, or [shortest, longest]
     * @param size      metres across, or [smallest, largest]
     * @param grow      metres per second the particle swells — how smoke billows
     * @param colour    a hex string, or a list of them to pick between
     * @param texture   a picture for each quad; without one they are soft dots
     * @param gravity   metres per second per second on Y, usually negative
     * @param fade      whether alpha falls to nothing over the life (default true)
     * @param drag      how fast it gives up its speed, per second
     * @param blend     'normal', or 'add' for anything that glows
     * @param blocks    metres: the radius of sight this burst takes away, if any
     * @param blockGrow metres per second that radius opens out at, if the
     *                  default — full size in a second and a half — is wrong
     */
    burst(options = {}) {
      if (!random) { report('unbound', 'a burst was asked for before the field had a random stream — nothing was made'); return null }
      const at = asVector(options.at)
      if (!at) { report('at', 'particles.burst needs an "at" of { x, y, z } — nothing was made'); return null }

      const count = Math.max(0, Math.min(MAX_PARTICLES, Math.round(Number(options.count) || 0)))
      const to = asVector(options.to)
      const shape = readOptions(options)

      // Asked for once for the whole burst rather than once per particle.
      makeRoom(count)
      for (let i = 0; i < count; i++) {
        // Along the segment when there is one, so a tracer is a line of
        // particles rather than a ball at the muzzle.
        const t = to && count > 1 ? i / (count - 1) : 0
        emit(shape,
          to ? at.x + (to.x - at.x) * t : at.x,
          to ? at.y + (to.y - at.y) * t : at.y,
          to ? at.z + (to.z - at.z) * t : at.z)
      }

      const now = clock()
      const longest = Array.isArray(shape.life) ? Math.max(...shape.life.map(Number)) : Number(shape.life) || 1
      const blocks = Number(options.blocks) || 0
      if (blocks > 0) {
        clouds.push({
          at, radius: blocks,
          // Smoke arrives as a ball and opens out. A cloud that is full size on
          // the first frame hides a player who was still in the open.
          grow: Number(options.blockGrow) || Math.max(0.5, blocks) / 1.5,
          born: now,
          until: now + longest
        })
      }

      const record = {
        t: round(now),
        at: [round(at.x), round(at.y), round(at.z)],
        count, life: shape.life, colour: shape.colour,
        texture: shape.texture, blend: shape.blend,
        ...(blocks > 0 ? { blocks } : {})
      }
      bursts.push(record)
      if (bursts.length > RING) bursts.shift()
      return record
    },

    /**
     * Emit from an entity for as long as it lives — a grenade's smoke trail, a
     * flare, a burning barrel.
     *
     * Returns a handle with `stop()`. It stops itself when the entity is gone,
     * because the common case is a projectile that is destroyed on contact and
     * nothing would otherwise be left to turn the trail off.
     */
    trail(entity, options = {}) {
      if (!entity || typeof entity !== 'object') {
        report('trail', 'particles.trail needs an entity to follow — nothing was made')
        return { id: 0, stop() {} }
      }
      const handle = {
        id: nextTrail++,
        entity,
        rate: Math.max(0, Number(options.rate) || 20),
        shape: readOptions(options),
        carry: 0,
        stopped: false
      }
      trails.push(handle)
      return { id: handle.id, stop() { handle.stopped = true } }
    },

    /**
     * Is there smoke on the line from here to there?
     *
     * This lives with the particles on purpose. Smoke is the particles — the
     * alternative is a second, invisible "smoke volume" placed beside the
     * visible cloud and kept in step with it by hand, and the moment those two
     * disagree a player is hidden by smoke that is not on screen, or shot
     * through smoke that is. A bot asking whether it can see you and a player
     * looking at the same grey ball have to be answered from the same data.
     *
     * It is answered against the cloud a burst declared, not against the
     * thousand particles in it. Testing a segment against a thousand points for
     * every bot on every step is the loop that quietly eats a frame budget, and
     * a smoke grenade is a sphere to anyone deciding whether they can see.
     */
    blocked(from, to) {
      const a = asVector(from)
      const b = asVector(to)
      if (!a || !b) { report('blocked', 'particles.blocked needs two points of { x, y, z }'); return false }
      const now = clock()
      for (const cloud of clouds) {
        if (now >= cloud.until) continue
        const radius = Math.min(cloud.radius, cloud.grow * Math.max(0, now - cloud.born))
        if (radius <= 0) continue
        if (segmentReaches(a, b, cloud.at) <= radius * radius) return true
      }
      return false
    },

    /**
     * One fixed step. Age, move, then emit — in that order, so a particle a
     * trail makes this step is drawn once before it starts dying.
     */
    step(seconds, world) {
      let keep = 0
      for (let i = 0; i < live.length; i++) {
        const p = live[i]
        p.age += seconds
        if (p.age >= p.life) continue

        p.velocityY += p.gravity * seconds
        if (p.drag > 0) {
          const left = Math.max(0, 1 - p.drag * seconds)
          p.velocityX *= left
          p.velocityY *= left
          p.velocityZ *= left
        }
        p.x += p.velocityX * seconds
        p.y += p.velocityY * seconds
        p.z += p.velocityZ * seconds
        p.size += p.grow * seconds

        // Compacted in place rather than filtered into a new array, because
        // this runs sixty times a second on up to three thousand of them.
        live[keep++] = p
      }
      live.length = keep

      for (const trail of trails) {
        // An entity that has been destroyed is no longer the one the world
        // holds under that id, which is how a trail on a spent grenade stops
        // without anything having to remember to stop it.
        if (!trail.stopped && world && world.byId(trail.entity.id) !== trail.entity) trail.stopped = true
        if (trail.stopped) continue
        trail.carry += trail.rate * seconds
        while (trail.carry >= 1) {
          trail.carry -= 1
          emit(trail.shape, trail.entity.x, trail.entity.y, trail.entity.z)
        }
      }
      for (let i = trails.length - 1; i >= 0; i--) if (trails[i].stopped) trails.splice(i, 1)

      const now = clock()
      for (let i = clouds.length - 1; i >= 0; i--) if (now >= clouds[i].until) clouds.splice(i, 1)
    },

    /** A named effect from the table at the bottom, with anything overridden. */
    effect(name, options = {}) {
      const recipe = EFFECTS[name]
      if (!recipe) {
        report(`effect:${name}`, `no effect called "${name}" — the ones there are: ${Object.keys(EFFECTS).join(', ')}`)
        return null
      }
      return field.burst({ ...recipe, ...options })
    },

    /**
     * Restyle a named effect, or add a new one.
     *
     * The builtin table ships generic shapes — a soft-dot muzzle flash, grey
     * smoke — and a game that wants its own art names it here, in its own
     * plugin's onLoad, without touching the builtin:
     *
     *   context.particles.define('muzzle-flash', { texture: 'fx/muzzle.png' })
     */
    define(name, overrides = {}) {
      EFFECTS[name] = { ...(EFFECTS[name] || {}), ...overrides }
      return EFFECTS[name]
    },

    /** Where every live particle is, rounded — what a determinism test compares. */
    positions() {
      return live.map(p => [round(p.x), round(p.y), round(p.z)])
    },

    clear() {
      live.length = 0
      clouds.length = 0
      trails.length = 0
      bursts.length = 0
      dropped = 0
    },

    recent: (n = 20) => bursts.slice(-n),

    /** The pictures the event wiring reaches for — the game names its own art. */
    get art() { return art },

    get state() {
      return {
        alive: live.length, cap: MAX_PARTICLES, dropped,
        clouds: clouds.length, trails: trails.length, bursts: bursts.length
      }
    }
  }

  return field
}

/**
 * The one field, at module scope for the same reason Physics 3D keeps its grid
 * there: a test imports this file directly and has to be looking at the smoke
 * the running world actually made, not at a second copy of the machinery.
 */
export const particles = makeParticleField()

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Particles',
  about: 'Smoke, sparks and debris — clouds that block sight, trails, and one-shot bursts.',
  inspect: context => {
    const s = context.particles.state
    return [{ title: 'Alive', rows: [['clouds', s.clouds], ['trails', s.trails], ['bursts', s.bursts]] }]
  },
  // Decals is not required — every call into it below is guarded — but naming
  // it means `context.decals` is there before the first bullet lands rather
  // than one plugin later.
  needs: ['Decals'],

  onLoad(context) {
    if (context.particles) {
      console.error('[particles] something else already put particles on context — replacing it')
    }
    particles.bind(context.random, () => context.time)
    context.particles = particles

    // A new level is a new run: the smoke from the last round is at coordinates
    // that now mean somewhere else, and its record would date from a clock that
    // has since gone back to zero.
    context.bus.on('level:loaded', () => { particles.clear(); said.clear() })

    wireGameEffects(context)

    // Drawing waits for the shell, because the renderer does not exist until
    // then — and in a headless world it never does, which is not an error.
    context.bus.on('shell:ready', () => attachDrawing(context))
  },

  systems: [
    {
      phase: 'fixed',
      run(world, seconds) { particles.step(seconds, world) }
    },
    {
      phase: 'frame',
      run() { painter?.sync(particles.all) }
    }
  ],

  commands: [
    {
      id: 'particles.recent',
      label: 'Bursts recently made',
      run: (context, n) => context.particles.recent(typeof n === 'number' ? n : 20)
    },
    {
      id: 'particles.state',
      label: 'How many particles are alive',
      run: context => context.particles.state
    },
    {
      id: 'particles.effect',
      label: 'Play one named effect',
      /** `run particles.effect '["smoke", {"at": [0, 1, 0]}]'` */
      run: (context, args) => {
        const [name, options] = Array.isArray(args) ? args : [args, {}]
        return context.particles.effect(name, options || {})
      }
    },
    {
      id: 'particles.clear',
      label: 'Remove every particle',
      run: context => { context.particles.clear(); return context.particles.state }
    }
  ]
}

// ------------------------------------------------------------------ the effects
/**
 * What the game asks for by name.
 *
 * A table rather than eight functions, because every one of these is the same
 * burst with different numbers, and a table is the form somebody tuning them
 * can actually read. No effect ships a texture: an untextured particle is a
 * soft dot, which is honest for every genre, and a game that wants a sprite
 * names it with `particles.define`.
 */
const EFFECTS = {
  'muzzle-flash': {
    count: 1, speed: 0, life: 0.05, size: 0.4, blend: 'add', fade: true,
    colour: '#ffd9a0'
  },
  tracer: {
    count: 14, speed: 0, life: 0.06, size: 0.03, blend: 'add', fade: true,
    colour: '#ffe6b0'
  },
  brass: {
    count: 1, speed: [1.6, 2.4], spread: 0.5, life: 1.1, size: 0.035,
    colour: ['#c9a227', '#d8b64a'], gravity: -20.32, drag: 0.4
  },
  'wall-hit': {
    count: 10, speed: [1.2, 3.4], spread: 0.7, life: [0.25, 0.55],
    size: [0.02, 0.06], colour: '#b9b2a4', gravity: -9, drag: 2.5, grow: 0.05
  },
  sparks: {
    count: 6, speed: [3, 6], spread: 0.8, life: [0.1, 0.25], size: 0.02,
    blend: 'add', colour: '#ffd07a', gravity: -20.32, drag: 1
  },
  blood: {
    count: 14, speed: [1, 3.5], spread: 0.9, life: [0.3, 0.6],
    size: [0.03, 0.07], colour: ['#8c1010', '#6b0d0d'], gravity: -14, drag: 1.5
  },
  smoke: {
    // A thousand, which is what the header promises the buffer can take, and
    // eighteen seconds, which is how long a smoke screen stands.
    count: 900, speed: [0.3, 1.6], life: [14, 18], size: [0.5, 1.1],
    grow: 0.22, colour: ['#b9b9b9', '#9d9d9d', '#cfcfcf'], drag: 1.4,
    blocks: 4
  },
  flash: {
    count: 60, speed: [4, 14], life: [0.25, 0.5], size: [0.2, 0.5],
    blend: 'add', colour: '#ffffff', drag: 3
  },
  explosion: {
    count: 220, speed: [3, 12], life: [0.6, 1.8], size: [0.25, 0.8],
    grow: 0.6, colour: ['#ffb457', '#e2662a', '#6b6b6b', '#3a3a3a'],
    gravity: 1.5, drag: 2
  }
}

/**
 * What a surface throws up when it is hit, by what it is made of.
 *
 * The first match wins, so the longer name goes first: `sandstone-brick.png`
 * would otherwise be read as sand, and the whole point of the table is that a
 * brick wall and a stone floor do not throw up the same dust.
 */
const SURFACES = [
  ['sandstone', '#c9b489'],
  ['sand', '#cdba90'],
  ['tunnel', '#a89b86'],
  ['concrete', '#b6b2ab'],
  ['plaster', '#c3bcb0'],
  ['stairs', '#b0aaa0'],
  ['ceiling', '#8f8b84'],
  ['metal', '#d8dde3'],
  ['door', '#9aa0a8'],
  ['crate', '#9c7346'],
  ['wood', '#9c7346'],
  ['tarp', '#5f7f9c'],
  ['rug', '#7a2b2b'],
  ['roof', '#9c6a4a']
]

/**
 * The pictures the event wiring reaches for, named by the game.
 *
 * The engine ships none — a decal with no texture is a tinted quad, which is
 * honest for every genre — and a game that wants its own art sets them in its
 * own plugin's onLoad:
 *
 *   context.particles.art.bulletHole = 'decals/bullet-hole.png'
 *   context.particles.art.blood = 'decals/blood.png'
 *
 * A mutable object on the field rather than constants, because the wiring
 * below reads it at event time and a game may load after this plugin.
 */
export const art = { bulletHole: '', blood: '' }

/**
 * The colour of what was hit.
 *
 * A wall that declared its own tint is taken at its word; otherwise the texture
 * name says what it is made of, because a project that has named its files
 * `sandstone-brick.png` has already said so and making it say it twice is a
 * second source of truth that can disagree.
 */
function surfaceColour(entity) {
  const tint = entity?.mesh?.tint
  if (typeof tint === 'string') return tint
  const texture = String(entity?.mesh?.texture || '').toLowerCase()
  for (const [match, colour] of SURFACES) if (texture.includes(match)) return colour
  return '#b9b2a4'
}

/** Anything that bleeds: a player or a bot, either of which carries a team. */
const isAlive = entity => !!(entity?.properties?.team || entity?.damageable)

/**
 * Turn the game's events into effects.
 *
 * `weapon:fired`, `weapon:hit`, `entity:hurt` and `entity:killed` are the
 * contract with the weapon and damage lanes. `grenade:detonated` and
 * `explosion` are offered rather than agreed: if nothing ever emits them
 * nothing happens, and the same effects are reachable by name through
 * `context.particles.effect`.
 *
 * Everything here reads its event defensively and does nothing at all when a
 * field it wanted is missing. A missing muzzle position is a shape decision
 * somebody else made, not a fault worth shouting about every shot.
 */
function wireGameEffects(context) {
  /**
   * Where each shooter's last shot left the barrel.
   *
   * The tracer is drawn when the shot lands, because that is when its far end
   * is known — and `weapon:hit` need not carry where the shot came from. One
   * point per shooter is all it takes to join the two events up.
   */
  const muzzles = new Map()

  context.bus.on('level:loaded', () => muzzles.clear())

  context.bus.on('weapon:fired', event => {
    const shooter = event?.entity
    const direction = normalise(asVector(event?.direction))
    const origin = asVector(event?.origin) || (shooter ? { x: shooter.x, y: shooter.y, z: shooter.z } : null)
    if (!origin || !direction) return

    if (shooter?.id) muzzles.set(shooter.id, origin)

    const at = { x: origin.x + direction.x * 0.3, y: origin.y + direction.y * 0.3, z: origin.z + direction.z * 0.3 }
    particles.effect('muzzle-flash', { at, direction })

    // Brass leaves to the shooter's right, which is the fire direction crossed
    // with up — no camera needed, so a bot ejects a case the same way a player
    // does.
    const right = normalise(cross(direction, { x: 0, y: 1, z: 0 }))
    if (right) {
      particles.effect('brass', {
        at: { x: origin.x + right.x * 0.15, y: origin.y - 0.05, z: origin.z + right.z * 0.15 },
        direction: { x: right.x + 0.2, y: 0.7, z: right.z + 0.2 }
      })
    }
  })

  // On this event `entity` is who fired and `target` is what they hit, which is
  // the naming the weapon lane uses throughout. Getting those two the wrong way
  // round would put a bullet hole on the shooter.
  context.bus.on('weapon:hit', event => {
    const point = asVector(event?.point) || asVector(event?.at)
    if (!point) return
    const normal = normalise(asVector(event?.normal)) || { x: 0, y: 1, z: 0 }
    const target = event?.target

    // A tracer that started at the muzzle and ends where the bullet stopped.
    // The hit carries no origin, so it comes from the shot that announced
    // itself a moment ago — which is the only reason `muzzles` exists.
    const from = asVector(event?.origin) || muzzles.get(event?.entity?.id)
    if (from) particles.effect('tracer', { at: from, to: point })

    if (isAlive(target)) {
      // A head shot sprays; a leg does not. The weapon lane has already worked
      // out which, so there is nothing to decide here beyond how much.
      particles.effect('blood', {
        at: point,
        direction: { x: -normal.x, y: -normal.y, z: -normal.z },
        count: event?.hitbox === 'head' ? 26 : 14
      })
      // Blood lands under the wound rather than on the person, because a decal
      // is stuck to the world and a person walks away from it.
      context.decals?.place({
        at: { x: point.x, y: point.y - 1.2, z: point.z },
        normal: { x: 0, y: 1, z: 0 },
        size: [0.5, 0.5], texture: art.blood, tint: '#8c1010',
        rotation: context.random() * Math.PI * 2,
        life: 25
      })
      return
    }

    const colour = surfaceColour(target)
    particles.effect('wall-hit', { at: point, direction: normal, colour })
    if (String(target?.mesh?.texture || '').includes('metal')) {
      particles.effect('sparks', { at: point, direction: normal })
    }
    context.decals?.place({
      at: point, normal, size: 0.09, texture: art.bulletHole, tint: colour,
      // Turned at random about the surface normal, so a wall of hits does not
      // read as a printed pattern. The randomness is the engine's, so the wall
      // looks the same on a replay.
      rotation: context.random() * Math.PI * 2
    })
  })

  context.bus.on('entity:hurt', event => {
    const victim = event?.entity || event?.target
    if (!victim || !isAlive(victim)) return
    // No hit point in this event, so it is put at the chest — the one place
    // that is right for a hit from any direction.
    const direction = normalise(asVector(event?.direction))
    particles.effect('blood', {
      at: { x: victim.x, y: victim.y + 0.25, z: victim.z },
      count: 6,
      ...(direction ? { direction, spread: 0.8 } : {})
    })
  })

  context.bus.on('entity:killed', event => {
    const victim = event?.entity || event?.victim
    if (!victim) return
    particles.effect('blood', { at: { x: victim.x, y: victim.y + 0.2, z: victim.z }, count: 26, speed: [1, 4.5] })
    context.decals?.place({
      at: { x: victim.x, y: victim.y - 0.9, z: victim.z },
      normal: { x: 0, y: 1, z: 0 },
      size: [1.1, 1.1], texture: art.blood, tint: '#7a0d0d',
      rotation: context.random() * Math.PI * 2,
      life: 40
    })
  })

  context.bus.on('grenade:detonated', event => {
    const at = asVector(event?.at) || asVector(event?.point)
    if (!at) return
    const kind = String(event?.kind || event?.weapon || '')
    if (kind.includes('smoke')) { particles.effect('smoke', { at }); return }
    if (kind.includes('flash')) { particles.effect('flash', { at }); return }
    particles.effect('explosion', { at, count: 120 })
  })

  context.bus.on('explosion', event => {
    const at = asVector(event?.at) || asVector(event?.point) || asVector(event?.entity)
    if (!at) return
    particles.effect('explosion', { at })
    context.decals?.place({
      at: { x: at.x, y: at.y - 0.4, z: at.z },
      normal: { x: 0, y: 1, z: 0 },
      size: [6, 6], texture: art.blood, tint: '#2a2320',
      rotation: context.random() * Math.PI * 2
    })
  })
}

// ------------------------------------------------------------------ drawing
/**
 * One buffer per texture, and camera-facing quads inside it.
 *
 * Each particle is four vertices sharing one centre, offset in *view* space by
 * a corner — which is what makes it face the camera without anything having to
 * be rotated on the CPU. The alternative, one mesh each, is a thousand draw
 * calls for one grey shape.
 *
 * Points would have been fewer vertices, but a point is clipped the moment its
 * centre leaves the frustum, and the centre of a two-metre smoke puff leaves
 * the frustum while most of the puff is still on screen — the smoke pops out at
 * the edge of the view exactly when you turn to look at it.
 */
let painter = null

function attachDrawing(context) {
  if (painter || !context.renderer?.scene) return
  // Loaded on demand rather than imported at the top of the file, because a
  // headless world has no renderer and should not pay to parse a 3D library it
  // will never call. Ten of them start at once; it adds up.
  import('three')
    .then(THREE => { painter = makePainter(THREE, context.renderer.scene) })
    .catch(e => console.error(`[particles] could not load three, so particles will be recorded but not drawn — ${e.message}`))
}

const VERTEX = `
attribute vec2 corner;
attribute float particleSize;
attribute vec4 particleColour;
varying vec4 vColour;
varying vec2 vUV;
void main() {
  vColour = particleColour;
  vUV = corner + 0.5;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  view.xy += corner * particleSize;
  gl_Position = projectionMatrix * view;
}
`

const FRAGMENT = `
varying vec4 vColour;
varying vec2 vUV;
#ifdef TEXTURED
  uniform sampler2D map;
#endif
void main() {
  vec4 colour = vColour;
  #ifdef TEXTURED
    colour *= texture2D(map, vUV);
  #else
    // A soft round dot, so an untextured particle is a puff rather than a
    // square. Cheaper than a texture and it never fails to load.
    colour.a *= smoothstep(1.0, 0.55, length(vUV - 0.5) * 2.0);
  #endif
  if (colour.a < 0.01) discard;
  gl_FragColor = colour;
  #include <colorspace_fragment>
}
`

function makePainter(THREE, scene) {
  const loader = new THREE.TextureLoader()
  const textures = new Map()
  const groups = new Map()      // texture|blend -> { geometry, mesh, capacity }

  function textureFor(src) {
    if (textures.has(src)) return textures.get(src)
    const t = loader.load(assetURL(src), undefined, undefined, () => {
      console.error(`[particles] missing texture ${assetURL(src)} (referenced as "${src}")`)
    })
    t.colorSpace = THREE.SRGBColorSpace
    textures.set(src, t)
    return t
  }

  function groupFor(key, texture, blend, capacity) {
    let group = groups.get(key)
    if (group && group.capacity >= capacity) return group
    if (group) { scene.remove(group.mesh); group.geometry.dispose() }

    // Doubling rather than allocating the ceiling up front: most groups hold a
    // handful of sparks and only one of them ever holds a smoke grenade.
    const size = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, capacity))))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))
    geometry.setAttribute('particleSize', new THREE.BufferAttribute(new Float32Array(size * 4), 1))
    geometry.setAttribute('particleColour', new THREE.BufferAttribute(new Float32Array(size * 4 * 4), 4))

    // The corner and the index buffer never change — the same four offsets and
    // two triangles for every particle that will ever live in this group.
    const corner = new Float32Array(size * 4 * 2)
    const index = new Uint32Array(size * 6)
    for (let quad = 0; quad < size; quad++) {
      corner.set([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], quad * 8)
      const v = quad * 4
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6)
    }
    geometry.setAttribute('corner', new THREE.BufferAttribute(corner, 2))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: texture ? { map: { value: textureFor(texture) } } : {},
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: texture ? { TEXTURED: '' } : {},
      transparent: true,
      // Depth is tested so smoke behind a wall stays behind it, and not written
      // so a thousand overlapping quads blend instead of clipping each other.
      depthWrite: false,
      blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide
    })

    const mesh = new THREE.Mesh(geometry, material)
    // The vertices are built in view space every frame, so the bounding sphere
    // three would compute from them is meaningless — cull it and it disappears.
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    scene.add(mesh)

    group = { geometry, mesh, capacity: size }
    groups.set(key, group)
    return group
  }

  return {
    sync(live) {
      const byGroup = new Map()
      for (const p of live) {
        const key = `${p.texture}|${p.blend}`
        const list = byGroup.get(key)
        if (list) list.push(p)
        else byGroup.set(key, [p])
      }
      // A group that has emptied still has a mesh, and the mesh has to be told
      // so or the last frame's smoke hangs there forever.
      for (const key of groups.keys()) if (!byGroup.has(key)) byGroup.set(key, [])

      for (const [key, list] of byGroup) {
        const [texture, blend] = key.split('|')
        const group = groupFor(key, texture, blend, list.length)
        const position = group.geometry.attributes.position
        const size = group.geometry.attributes.particleSize
        const colour = group.geometry.attributes.particleColour

        list.forEach((p, i) => {
          const rgb = readColour(p.colour)
          const alpha = p.fade ? Math.max(0, 1 - p.age / p.life) : 1
          for (let corner = 0; corner < 4; corner++) {
            const at = i * 4 + corner
            position.setXYZ(at, p.x, p.y, p.z)
            size.setX(at, p.size)
            colour.setXYZW(at, rgb.r, rgb.g, rgb.b, alpha)
          }
        })

        position.needsUpdate = true
        size.needsUpdate = true
        colour.needsUpdate = true
        group.geometry.setDrawRange(0, list.length * 6)
      }
    }
  }
}

// ------------------------------------------------------------------ small print
/** Where a segment gets closest to a point, as a squared distance. */
function segmentReaches(a, b, point) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  const length = dx * dx + dy * dy + dz * dz
  let t = 0
  if (length > 0) {
    t = ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / length
    t = Math.max(0, Math.min(1, t))
  }
  const ox = a.x + dx * t - point.x
  const oy = a.y + dy * t - point.y
  const oz = a.z + dz * t - point.z
  return ox * ox + oy * oy + oz * oz
}

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})

function normalise(vector) {
  if (!vector) return null
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!(length > 0)) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

/** A point written as {x,y,z} or [x,y,z] — an argument typed at a terminal is an array. */
function asVector(value) {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (value && typeof value === 'object' && (typeof value.x === 'number' || typeof value.y === 'number' || typeof value.z === 'number')) {
    return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
  }
  return null
}

/**
 * A hex colour as linear floats.
 *
 * Three works in linear light and converts a texture for you, but not a vertex
 * colour — so a colour written the way a person writes one, `#cdba90`, has to
 * be converted here or every particle comes out visibly too bright.
 */
const colourCache = new Map()
function readColour(value) {
  const text = String(value || '#ffffff').trim()
  const cached = colourCache.get(text)
  if (cached) return cached
  const hex = /^#([0-9a-f]{3})$/i.test(text)
    ? text[1] + text[1] + text[2] + text[2] + text[3] + text[3]
    : (/^#([0-9a-f]{6})$/i.test(text) ? text.slice(1) : null)
  if (!hex) {
    report(`colour:${text}`, `cannot read the colour ${JSON.stringify(value)} — using white`)
    return { r: 1, g: 1, b: 1 }
  }
  const n = parseInt(hex, 16)
  const colour = {
    r: toLinear(((n >> 16) & 255) / 255),
    g: toLinear(((n >> 8) & 255) / 255),
    b: toLinear((n & 255) / 255)
  }
  colourCache.set(text, colour)
  return colour
}

const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

/**
 * The same rule the renderer resolves a texture by: a name starting with one of
 * the project's own folders is project-relative, and anything else — subfolder
 * included — lives under assets/. Written out here rather than imported because
 * a plugin receives `ui`, it does not import it.
 */
function assetURL(src) {
  const rel = String(src).replace(/^\/?project\//, '')
  return '/project/' + (/^(assets|levels|types|behaviours|tests|plugins)\//.test(rel) ? rel : 'assets/' + rel)
}

/**
 * Say it once, not sixty times a second. Silence is the enemy, but a burst
 * asked for every frame with a broken option would otherwise fill the log until
 * nothing else in it can be read.
 */
const said = new Set()
function report(key, message) {
  if (said.has(key)) return
  said.add(key)
  console.error(`[particles] ${message}`)
}

const round = n => Math.round(n * 1000) / 1000
