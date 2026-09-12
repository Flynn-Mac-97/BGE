/**
 * Beams — the deterministic beam field: bolts, lasers and arcs between two
 * points. The particle field cannot express a line, because a particle has a
 * position and no direction, so a bolt drawn from particles is a row of dots
 * that breaks up as the camera turns.
 *
 * Simulation only. Beam Painter draws it. A headless world still records every
 * beam, so a test asserts an effect without a browser.
 *
 * The shape of a beam is a pure function of its record and the clock, so the
 * painter rebuilds the same points a test computes, and neither stores state
 * the other could disagree with.
 */

const MAX_BEAMS = 64
const MAX_SEGMENTS = 48
const RECORD_KEEP = 40

const said = new Set()

function report(key, message) {
  if (said.has(key)) return
  said.add(key)
  console.error(`[beams] ${message}`)
}

/** A world point from either form a caller may write. */
function readPoint(value) {
  if (Array.isArray(value)) {
    const [x, y, z] = value
    if (![x, y, z].every(Number.isFinite)) return null
    return { x, y, z }
  }
  if (value && typeof value === 'object') {
    const x = Number(value.x), y = Number(value.y), z = Number(value.z ?? 0)
    if (![x, y, z].every(Number.isFinite)) return null
    return { x, y, z }
  }
  return null
}

const clamp = (value, least, most) => Math.min(most, Math.max(least, value))

function number(value, fallback) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : fallback
}

/**
 * Repeatable noise from three integers.
 *
 * The jitter of a bolt has to be the same number every time it is asked for —
 * the painter asks once a frame and a test asks once — so it is hashed from the
 * beam's seed and the segment index rather than drawn from a stream.
 */
function hash(a, b, c) {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296 - 0.5
}

/** Two unit axes across a direction, for the sideways displacement of a bolt. */
function acrossAxes(dx, dy, dz) {
  const length = Math.hypot(dx, dy, dz) || 1
  const fx = dx / length, fy = dy / length, fz = dz / length
  // Any axis not parallel to the beam works; picking the one the beam points
  // along least keeps the cross product away from zero.
  const upX = Math.abs(fy) < 0.9 ? 0 : 1
  const upY = Math.abs(fy) < 0.9 ? 1 : 0
  let ax = fy * 0 - fz * upY, ay = fz * upX - fx * 0, az = fx * upY - fy * upX
  const aLength = Math.hypot(ax, ay, az) || 1
  ax /= aLength; ay /= aLength; az /= aLength
  return {
    a: { x: ax, y: ay, z: az },
    b: { x: fy * az - fz * ay, y: fz * ax - fx * az, z: fx * ay - fy * ax }
  }
}

/** How wide the beam is at one point along it, as a fraction of `width`. */
function taperAt(taper, along) {
  if (taper === 'from') return along
  if (taper === 'to') return 1 - along
  if (taper === 'both') return Math.sin(Math.pow(along, 0.75) * Math.PI) * 0.85 + 0.15
  return 1
}

function makeBeams() {
  const live = []
  const records = []
  const named = {
    bolt: { jitter: 0.35, segments: 14, flicker: 18, width: 0.1, colour: '#5ce1ff', core: '#ffffff', life: 0.35 },
    laser: { jitter: 0, segments: 2, flicker: 0, width: 0.06, colour: '#ff5a4a', core: '#ffe9e4', life: 0.12 },
    arc: { jitter: 0.12, segments: 10, flicker: 30, width: 0.04, colour: '#9ad8ff', core: '#ffffff', life: 0.2 }
  }

  let stream = null
  let clock = () => 0
  let nextId = 1
  let dropped = 0

  /** Every option a beam takes, with its default. */
  function readOptions(options) {
    return {
      life: Math.max(1 / 60, number(options.life, 0.35)),
      width: Math.max(0.001, number(options.width, 0.08)),
      jitter: Math.max(0, number(options.jitter, 0)),
      segments: clamp(Math.round(number(options.segments, 12)), 2, MAX_SEGMENTS),
      flicker: Math.max(0, number(options.flicker, 0)),
      taper: ['both', 'from', 'to', 'none'].includes(options.taper) ? options.taper : 'both',
      colour: typeof options.colour === 'string' ? options.colour : '#ffffff',
      core: typeof options.core === 'string' ? options.core : '#ffffff',
      fadeTo: typeof options.fadeTo === 'string' ? options.fadeTo : '',
      blend: options.blend === 'normal' ? 'normal' : 'add'
    }
  }

  function makeRoom() {
    while (live.length >= MAX_BEAMS) { live.shift(); dropped++ }
  }

  function file(record) {
    makeRoom()
    live.push(record)
    records.push({ id: record.id, at: clock(), from: record.from, to: record.to, life: record.life, colour: record.colour })
    if (records.length > RECORD_KEEP) records.shift()
    return record
  }

  return {
    bind(randomStream, readClock) { stream = randomStream; clock = readClock },

    /** A beam between two points. Returns the record it filed, or null. */
    beam(options = {}) {
      const from = readPoint(options.from)
      const to = readPoint(options.to)
      if (!from || !to) {
        report('ends', 'beams.beam needs `from` and `to` world points — nothing was made')
        return null
      }
      // One draw whatever the options say, so adding a beam cannot shift what
      // the game rolls next.
      const seed = Math.floor((stream ? stream() : 0) * 1e6)
      return file({ id: nextId++, from, to, born: clock(), seed, followFrom: null, followTo: null, ...readOptions(options) })
    },

    /** A bolt striking down onto a point. `height` metres above it. */
    strike(options = {}) {
      const at = readPoint(options.at)
      if (!at) {
        report('strike', 'beams.strike needs `at` — nothing was made')
        return null
      }
      const height = number(options.height, 8)
      return this.effect('bolt', { ...options, from: { x: at.x, y: at.y + height, z: at.z }, to: at })
    },

    /**
     * A beam whose ends follow entities for as long as they live. Returns a
     * handle with `stop()`; it stops itself when either entity leaves the world,
     * which is what a tether does when its holder dies.
     */
    link(fromEntity, toEntity, options = {}) {
      if (!fromEntity || !toEntity || typeof fromEntity !== 'object' || typeof toEntity !== 'object') {
        report('link', 'beams.link needs two entities — nothing was made')
        return null
      }
      const record = this.beam({
        ...options,
        from: { x: fromEntity.x, y: fromEntity.y, z: fromEntity.z },
        to: { x: toEntity.x, y: toEntity.y, z: toEntity.z }
      })
      if (!record) return null
      record.followFrom = fromEntity
      record.followTo = toEntity
      return { id: record.id, stop() { record.born = clock() - record.life } }
    },

    /** A named recipe, anything overridden. */
    effect(name, options = {}) {
      const recipe = named[name]
      if (!recipe) {
        report(`effect:${name}`, `beams.effect: no beam named "${name}" — nothing was made`)
        return null
      }
      return this.beam({ ...recipe, ...options })
    },

    /** Merge over a recipe, or add one. The game's tuning door. */
    define(name, overrides = {}) {
      named[name] = { ...(named[name] || {}), ...overrides }
      return named[name]
    },

    /**
     * The spine of a beam at a moment, as flat world points.
     *
     * Pure: the painter and a test both call this and get the same numbers.
     */
    points(record, time) {
      const age = Math.max(0, time - record.born)
      const dx = record.to.x - record.from.x
      const dy = record.to.y - record.from.y
      const dz = record.to.z - record.from.z
      const count = record.segments + 1
      const out = new Float32Array(count * 3)

      if (record.jitter <= 0) {
        for (let i = 0; i < count; i++) {
          const along = i / record.segments
          out[i * 3] = record.from.x + dx * along
          out[i * 3 + 1] = record.from.y + dy * along
          out[i * 3 + 2] = record.from.z + dz * along
        }
        return out
      }

      const axes = acrossAxes(dx, dy, dz)
      // Quantised time re-rolls the displacement, which is what reads as flicker.
      const step = record.flicker > 0 ? Math.floor(age * record.flicker) : 0
      const reach = Math.hypot(dx, dy, dz)

      for (let i = 0; i < count; i++) {
        const along = i / record.segments
        // Both ends are pinned: a bolt that missed what it struck is the one
        // error nobody can look past.
        const room = Math.sin(along * Math.PI) * record.jitter * reach * 0.25
        const a = hash(record.seed, i, step) * room
        const b = hash(record.seed, i + 977, step) * room
        out[i * 3] = record.from.x + dx * along + axes.a.x * a + axes.b.x * b
        out[i * 3 + 1] = record.from.y + dy * along + axes.a.y * a + axes.b.y * b
        out[i * 3 + 2] = record.from.z + dz * along + axes.a.z * a + axes.b.z * b
      }
      return out
    },

    /** How wide and how bright a beam is at one point along it, right now. */
    shapeAt(record, along, time) {
      const life = Math.min(1, Math.max(0, (time - record.born) / record.life))
      return {
        width: record.width * taperAt(record.taper, along),
        alpha: Math.pow(1 - life, 1.4)
      }
    },

    step(seconds, world) {
      const now = clock()
      for (const record of live) {
        if (!record.followFrom) continue
        // A destroyed entity no longer answers to its id — the beam stops.
        const goneFrom = world && world.byId(record.followFrom.id) !== record.followFrom
        const goneTo = world && world.byId(record.followTo.id) !== record.followTo
        if (goneFrom || goneTo) { record.born = now - record.life; continue }
        record.from = { x: record.followFrom.x, y: record.followFrom.y, z: record.followFrom.z }
        record.to = { x: record.followTo.x, y: record.followTo.y, z: record.followTo.z }
      }
      for (let i = live.length - 1; i >= 0; i--) {
        if (now - live[i].born >= live[i].life) live.splice(i, 1)
      }
    },

    clear() { live.length = 0; records.length = 0; dropped = 0 },
    recent(count = 20) { return records.slice(-Math.max(0, count)) },
    get all() { return live },
    get count() { return live.length },
    get names() { return Object.keys(named) },
    get state() { return { alive: live.length, cap: MAX_BEAMS, dropped, named: Object.keys(named).length } }
  }
}

/**
 * One kind of effect, as the VFX host loads it.
 *
 * `make` builds the field. `painter` is imported only in a browser, so a
 * headless world never parses a line of drawing code.
 */
export default {
  kind: 'beams',
  title: 'Beams',
  about: 'Bolts, lasers and arcs drawn as a line between two points.',
  make: makeBeams,
  forget: () => said.clear(),
  painter: () => import('./beam-painter.js')
}
