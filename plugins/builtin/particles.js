/**
 * Particles — one-shot bursts, trails that follow an entity, and the clouds
 * a burst may declare to block sight.
 *
 * Three decisions make this an engine feature rather than a bag of sprites:
 * it is deterministic — every draw comes from the engine's seeded random and
 * every particle steps on the fixed clock, so a headless test can assert an
 * effect happened; every burst is recorded whether or not anything drew it —
 * drawing is Particle Painter's job; and it is neutral — which events fire
 * which effect lives in Combat Effects, and a game restyles any named effect
 * with `particles.define`.
 */

import { normalise, asWrittenVector } from '../../engine/vector.js'

/**
 * The ceiling for live particles. Two overlapping smoke screens are normal
 * play, so it sits well clear of that; at the ceiling the oldest go, because
 * the oldest are the closest to dying anyway.
 */
const MAX_PARTICLES = 3000

/** How many bursts are remembered for inspection. */
const RING = 40

/** One fixed step, so a hand-typed `life: 0` flashes once rather than never. */
const MINIMUM_LIFE = 1 / 60

// ------------------------------------------------------------------ the field
/** A factory, so a test can make a field with its own random stream. */
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
   * A number, or a number picked between two — `speed: 3` and `speed: [1, 4]`.
   * One draw from the stream either way, so the option shape cannot change
   * the sequence for anything after it.
   */
  const span = value => (Array.isArray(value) ? random.range(Number(value[0]) || 0, Number(value[1]) || 0) : (Number(value) || 0))

  /**
   * A unit vector in a cone about `direction` — or anywhere, a sphere being a
   * cone of half-angle pi. Sampling the cosine keeps the density even.
   */
  function coneDirection(direction, spread) {
    const limit = Math.cos(Math.max(0, Math.min(Math.PI, spread)))
    const cosine = 1 - random() * (1 - limit)
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine))
    const around = random() * Math.PI * 2
    const local = { x: Math.cos(around) * sine, y: Math.sin(around) * sine, z: cosine }
    if (!direction) return local
    // A frame whose +Z is the direction asked for. The helper swaps near the
    // poles, where a cross product with a parallel vector has no length.
    const helper = Math.abs(direction.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    const tangent = normalise(cross(helper, direction)) || { x: 1, y: 0, z: 0 }
    const bitangent = cross(direction, tangent)
    return {
      x: tangent.x * local.x + bitangent.x * local.y + direction.x * local.z,
      y: tangent.y * local.x + bitangent.y * local.y + direction.y * local.z,
      z: tangent.z * local.x + bitangent.z * local.y + direction.z * local.z
    }
  }

  /** Everything a burst decides once, so the per-particle loop only draws randoms. */
  function readOptions(options) {
    const direction = normalise(asWrittenVector(options.direction))
    return {
      direction,
      // A burst that named a direction meant a spray; one that did not, a puff.
      spread: options.spread === undefined ? (direction ? 0.4 : Math.PI) : Number(options.spread) || 0,
      speed: options.speed ?? 0, life: options.life ?? 1, size: options.size ?? 0.08,
      grow: Number(options.grow) || 0, gravity: Number(options.gravity) || 0,
      drag: Math.max(0, Number(options.drag) || 0), fade: options.fade !== false,
      colour: options.colour ?? '#ffffff',
      fadeTo: typeof options.fadeTo === 'string' ? options.fadeTo : null,
      texture: options.texture || '',
      blend: options.blend === 'add' ? 'add' : 'normal'
    }
  }

  /** Make room in one splice, not one shift per particle arriving. */
  function makeRoom(wanted) {
    const over = live.length + wanted - MAX_PARTICLES
    if (over <= 0) return
    const going = Math.min(over, live.length)
    live.splice(0, going)
    dropped += going
  }

  function emit(shape, x, y, z) {
    makeRoom(1)      // a trail emits one at a time and never asked in advance
    const along = coneDirection(shape.direction, shape.spread)
    const speed = span(shape.speed)
    const life = Math.max(MINIMUM_LIFE, span(shape.life))
    const size = Math.max(0, span(shape.size))
    const colour = Array.isArray(shape.colour) ? random.pick(shape.colour) : shape.colour
    live.push({
      x, y, z, velocityX: along.x * speed, velocityY: along.y * speed, velocityZ: along.z * speed,
      age: 0, life, size, grow: shape.grow, gravity: shape.gravity, drag: shape.drag,
      fade: shape.fade, colour, fadeTo: shape.fadeTo, texture: shape.texture, blend: shape.blend
    })
  }

  const field = {
    /**
     * The seeded random stream and the engine clock, handed in — so this
     * file cannot touch `Math.random` or the wall clock even by accident.
     */
    bind(randomSource, timeSource) { random = randomSource; clock = timeSource },
    get bound() { return !!random },

    get count() { return live.length },
    /** Read, do not mutate — the painter walks this every frame. */
    get all() { return live },
    get clouds() { return clouds },

    /**
     * One burst. The whole emitter description is data: `at` (world metres),
     * `to` (spread evenly from `at` to here — a tracer), `count`, `direction`
     * + `spread` (half-angle, radians), `speed` `life` `size` (each a number
     * or a [least, most] pair), `grow` (m/s of swelling — size over life),
     * `colour` (hex or a list to pick from), `fadeTo` (hex it slides to —
     * colour over life), `gravity`, `drag`, `fade` (alpha over life, default
     * true), `blend` ('normal' | 'add'), `texture` (soft dots without one),
     * and `blocks` + `blockGrow` for a sight-blocking cloud.
     */
    burst(options = {}) {
      if (!random) { report('unbound', 'a burst was asked for before the field had a random stream — nothing was made'); return null }
      const at = asWrittenVector(options.at)
      if (!at) { report('at', 'particles.burst needs an "at" of { x, y, z } — nothing was made'); return null }

      const count = Math.max(0, Math.min(MAX_PARTICLES, Math.round(Number(options.count) || 0)))
      const to = asWrittenVector(options.to)
      const shape = readOptions(options)

      makeRoom(count)      // once for the whole burst, not once per particle
      for (let i = 0; i < count; i++) {
        // Along the segment when there is one — a tracer is a line, not a ball.
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
          // Smoke arrives as a ball and opens out. A cloud full-size on frame
          // one hides a player who was still in the open.
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
     * Emit from an entity for as long as it lives — a smoke trail, a flare.
     * Returns a handle with `stop()`, and stops itself when the entity is
     * gone, because the common case is a projectile destroyed on contact.
     */
    trail(entity, options = {}) {
      if (!entity || typeof entity !== 'object') {
        report('trail', 'particles.trail needs an entity to follow — nothing was made')
        return { id: 0, stop() {} }
      }
      const handle = { id: nextTrail++, entity, rate: Math.max(0, Number(options.rate) || 20), shape: readOptions(options), carry: 0, stopped: false }
      trails.push(handle)
      return { id: handle.id, stop() { handle.stopped = true } }
    },

    /**
     * Is there smoke on the line from here to there? Lives with the particles
     * on purpose — a separate invisible smoke volume would eventually disagree
     * with the visible cloud. Answered against the cloud a burst declared, not
     * the thousand particles in it: a cloud is a sphere to anyone deciding
     * whether they can see.
     */
    blocked(from, to) {
      const a = asWrittenVector(from)
      const b = asWrittenVector(to)
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
        // Compacted in place — sixty times a second on up to three thousand.
        live[keep++] = p
      }
      live.length = keep

      for (const trail of trails) {
        // A destroyed entity no longer answers to its id — the trail stops itself.
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

    /** A named effect from the table below, with anything overridden. */
    effect(name, options = {}) {
      const recipe = EFFECTS[name]
      if (!recipe) {
        report(`effect:${name}`, `no effect called "${name}" — the ones there are: ${Object.keys(EFFECTS).join(', ')}`)
        return null
      }
      return field.burst({ ...recipe, ...options })
    },

    /**
     * Restyle a named effect, or add a new one — the game's tuning door:
     * `particles.define('muzzle-flash', { texture: 'fx/muzzle.png' })` in the
     * game's own plugin, never an edit to the table here.
     */
    define(name, overrides = {}) {
      EFFECTS[name] = { ...(EFFECTS[name] || {}), ...overrides }
      return EFFECTS[name]
    },

    clear() {
      live.length = clouds.length = trails.length = bursts.length = 0
      dropped = 0
    },

    recent: (n = 20) => bursts.slice(-n),

    /** The decal pictures event wiring reaches for — the game names its own art. */
    get art() { return art },

    get state() {
      return { alive: live.length, cap: MAX_PARTICLES, dropped, clouds: clouds.length, trails: trails.length, bursts: bursts.length }
    }
  }

  return field
}

/** The one field, at module scope — systems and tests see the same smoke. */
export const particles = makeParticleField()

/**
 * Decal art the Combat Effects wiring reaches for, named by the game:
 * `context.particles.art.bulletHole = '...'`. The engine ships none — an
 * untextured decal is a tinted quad. Mutable, because a game loads after this.
 */
export const art = { bulletHole: '', blood: '' }

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Particles',
  category: 'visuals',
  about: 'Bursts, trails, sight-blocking clouds.',
  inspect: context => [{ title: 'Alive', rows: Object.entries(context.particles.state) }],

  onLoad(context) {
    if (context.particles) console.error('[particles] something else already put particles on context — replacing it')
    // The drawing stream, not the simulation's: a burst that took draws from
    // the simulation made every visual change a gameplay change.
    particles.bind(context.drawing || context.random, () => context.time)
    context.particles = particles
    // A new level is a new run: old smoke sits at coordinates that now mean
    // somewhere else, on a clock that went back to zero.
    context.bus.on('level:loaded', () => { particles.clear(); said.clear() })
  },

  systems: [
    { phase: 'fixed', run(world, seconds) { particles.step(seconds, world) } }
  ],

  commands: [
    { id: 'particles.recent', label: 'Recent bursts', run: (context, n) => context.particles.recent(typeof n === 'number' ? n : 20) },
    { id: 'particles.state', label: 'Live particle count', run: context => context.particles.state },
    {
      id: 'particles.effect',
      label: 'Play an effect',
      /** `run particles.effect '["smoke", {"at": [0, 1, 0]}]'` */
      run: (context, args) => {
        const [name, options] = Array.isArray(args) ? args : [args, {}]
        return context.particles.effect(name, options || {})
      }
    },
    { id: 'particles.clear', label: 'Clear particles', run: context => { context.particles.clear(); return context.particles.state } }
  ]
}

// ------------------------------------------------------------------ the effects
/**
 * What a game asks for by name — a table, because each is the same burst
 * with different numbers, and a table is what somebody tuning them can read.
 * No effect ships a texture or a game's palette; `particles.define` is where
 * a game says what these look like.
 */
const EFFECTS = {
  'muzzle-flash': { count: 1, speed: 0, life: 0.05, size: 0.4, blend: 'add', fade: true, colour: '#ffd9a0' },
  tracer: { count: 14, speed: 0, life: 0.06, size: 0.03, blend: 'add', fade: true, colour: '#ffe6b0' },
  brass: { count: 1, speed: [1.6, 2.4], spread: 0.5, life: 1.1, size: 0.035, colour: ['#c9a227', '#d8b64a'], gravity: -20, drag: 0.4 },
  'wall-hit': { count: 10, speed: [1.2, 3.4], spread: 0.7, life: [0.25, 0.55], size: [0.02, 0.06], colour: '#b9b2a4', gravity: -9, drag: 2.5, grow: 0.05 },
  sparks: { count: 6, speed: [3, 6], spread: 0.8, life: [0.1, 0.25], size: 0.02, blend: 'add', colour: '#ffd07a', gravity: -20, drag: 1 },
  blood: { count: 14, speed: [1, 3.5], spread: 0.9, life: [0.3, 0.6], size: [0.03, 0.07], colour: ['#8c1010', '#6b0d0d'], gravity: -14, drag: 1.5 },
  smoke: { count: 900, speed: [0.3, 1.6], life: [14, 18], size: [0.5, 1.1], grow: 0.22, colour: ['#b9b9b9', '#9d9d9d', '#cfcfcf'], drag: 1.4, blocks: 4 },
  flash: { count: 60, speed: [4, 14], life: [0.25, 0.5], size: [0.2, 0.5], blend: 'add', colour: '#ffffff', drag: 3 },
  explosion: { count: 220, speed: [3, 12], life: [0.6, 1.8], size: [0.25, 0.8], grow: 0.6, colour: ['#ffb457', '#e2662a', '#6b6b6b', '#3a3a3a'], gravity: 1.5, drag: 2 }
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

const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })

/** Say each mistake once, not sixty times a second. */
const said = new Set()
function report(key, message) {
  if (said.has(key)) return
  said.add(key)
  console.error(`[particles] ${message}`)
}

const round = n => Math.round(n * 1000) / 1000
