/**
 * Pickups — things dropped in the world that come to you.
 *
 * The pull is the point. A pickup that you have to walk over is an errand; a
 * pickup that lurches toward you the moment you clip its radius and then
 * accelerates into your chest is a reward, and the difference is entirely in
 * these few numbers. So the magnet is written once, here, with the feel spelled
 * out rather than tuned by accident:
 *
 * - It **latches**. Once inside the radius a pickup stays yours and follows you
 *   out of it. Losing a gem by stepping back is the single worst thing this
 *   could do, and radius-checking every step is how that happens.
 * - It **accelerates**. It starts at a walking pace and winds up to far faster
 *   than you can run, so a screenful of gems arrives as a stream rather than a
 *   crowd that drifts.
 * - It **never misses**. Homing, not thrown: it steers at the collector every
 *   step and is taken the moment it is close enough.
 *
 * A pickup is any entity with `properties.pickup` set — the value is the kind,
 * a plain word this file never interprets. What a kind means belongs to the
 * game, so collecting one only announces it:
 *
 *   context.bus.on('pickup:collected', ({ kind, value }) => ...)
 */

const DEFAULTS = {
  /** How far a collector reaches, when it does not say. Metres. */
  radius: 2.2,
  /** Close enough to be taken. Small, so the gem is visibly on you first. */
  grab: 0.6,
  /** The lurch: how fast a pickup leaves the ground when it latches. */
  startSpeed: 3.5,
  /** The wind-up. This is what makes a full screen arrive as a stream. */
  acceleration: 38,
  maximumSpeed: 30
}

export default {
  name: 'Pickups',
  about: 'Drop things in the world that latch on inside a radius and accelerate into whoever is collecting.',
  inspect: context => {
    const list = context.pickups?.all() || []
    return list.length
      ? [{ title: 'Waiting', rows: list.slice(0, 12).map(e => [e.id, `${e.properties.pickup} ${e.properties.value ?? 1}`]) }]
      : []
  },

  onLoad(context) {
    const settings = { ...DEFAULTS }

    /**
     * Who the pickups are coming to.
     *
     * A game sets this. Falling back to whoever the camera follows means a
     * level that has said nothing still works, and that fallback is checked
     * against the world — a camera left pointing at last level's player would
     * otherwise pull every gem toward a ghost.
     */
    let collector = null
    function whoCollects() {
      const named = typeof collector === 'function' ? collector() : collector
      const entity = typeof named === 'string' ? context.world.byId(named) : named
      if (entity && context.world.entities.includes(entity)) return entity
      const followed = context.camera?.target
      return followed && context.world.entities.includes(followed) ? followed : null
    }

    const all = () => context.world.entities.filter(entity => entity.properties?.pickup)

    /** How far this collector reaches. Its own number wins, then the setting. */
    const reachOf = entity => Number(entity?.properties?.pickupRadius) || settings.radius

    /** Its own motion, in its own bag, so nothing else on the entity collides. */
    const motionOf = entity => (entity.pickupMotion ||= { latched: false, speed: 0 })

    function collect(entity, taker) {
      const kind = entity.properties.pickup
      const value = Number(entity.properties.value) || 0
      context.bus.emit('pickup:collected', { entity, collector: taker, kind, value })
      context.destroy(entity)
      return { kind, value }
    }

    context.pickups = {
      settings: () => ({ ...settings }),
      configure(options = {}) { Object.assign(settings, options); return { ...settings } },

      /** An entity, an id, or a function returning either. */
      set collector(who) { collector = who },
      get collector() { return whoCollects() },

      /**
       * Put one in the world. `at` is where it lands — usually where something
       * died — and the properties say what it is worth. `placement` carries
       * anything else the level format takes, so a drop worth more can be a
       * different colour without a second type per tier.
       */
      drop(type, at, properties = {}, placement = {}) {
        return context.spawn(type, {
          ...placement,
          at: [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0],
          properties: { pickup: 'thing', value: 1, ...properties }
        })
      },

      all,
      reachOf,

      /** Take one now, wherever it is. The screen-clearing item every game has. */
      attractAll() {
        for (const entity of all()) motionOf(entity).latched = true
        return all().length
      },

      collect
    }

    // A gem from the last run must not be waiting in this one.
    context.bus.on('level:loaded', () => {
      for (const entity of all()) context.destroy(entity)
    })
  },

  systems: [{
    // Fixed, because it moves things and takes them: a collection has to land
    // on the same step on every replay or simulate() stops repeating.
    phase: 'fixed',
    run(world, seconds, context) {
      const pickups = context.pickups
      const taker = pickups.collector
      const list = pickups.all()
      if (!list.length) return

      const settings = pickups.settings()
      const reach = taker ? pickups.reachOf(taker) : 0

      for (const entity of list) {
        const motion = entity.pickupMotion ||= { latched: false, speed: 0 }

        if (!taker) { rest(entity, motion, seconds); continue }

        const toX = taker.x - entity.x
        const toY = taker.y - entity.y
        const toZ = taker.z - entity.z
        const distance = Math.hypot(toX, toY, toZ)

        // Latched for good. A gem that could be lost by stepping backwards
        // would make the pickup radius feel like a trap rather than a reward.
        if (!motion.latched && distance <= reach) {
          motion.latched = true
          motion.speed = settings.startSpeed
          context.bus.emit('pickup:latched', { entity, collector: taker })
        }

        if (!motion.latched) { rest(entity, motion, seconds); continue }

        if (distance <= settings.grab) { pickups.collect(entity, taker); continue }

        motion.speed = Math.min(motion.speed + settings.acceleration * seconds, settings.maximumSpeed)
        // Never overshoot: a step longer than the gap would put the gem past
        // the collector and it would spend the next step coming back.
        const step = Math.min(motion.speed * seconds, distance)
        entity.x += (toX / distance) * step
        entity.y += (toY / distance) * step
        entity.z += (toZ / distance) * step
      }
    }
  }],

  commands: [
    {
      id: 'pickups.list',
      label: 'What is waiting to be picked up',
      run: context => context.pickups.all().map(entity => ({
        id: entity.id,
        kind: entity.properties.pickup,
        value: entity.properties.value ?? 1,
        at: [round(entity.x), round(entity.y), round(entity.z)],
        latched: !!entity.pickupMotion?.latched
      }))
    },
    {
      id: 'pickups.attract',
      label: 'Pull every pickup in now',
      run: context => ({ latched: context.pickups.attractAll() })
    }
  ]
}

/**
 * Waiting to be noticed.
 *
 * A gem that sits perfectly still reads as scenery. A slow bob is what makes a
 * field of them look like loot, and it costs one sine. Silent unless the
 * placement asked for it, because nothing should move a pickup a game meant to
 * leave on the floor.
 */
function rest(entity, motion, seconds) {
  const height = Number(entity.properties.bobHeight)
  if (!height) return
  const speed = Number(entity.properties.bobSpeed) || 3
  if (motion.base == null) motion.base = entity.y
  motion.phase = (motion.phase ?? 0) + seconds * speed
  entity.y = motion.base + Math.sin(motion.phase) * height
}

const round = n => Math.round(n * 1000) / 1000
