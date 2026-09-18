/**
 * Health — what it takes to kill something, and what happens the moment it dies.
 *
 * The arithmetic of a hit is one verb, `context.damage(target, amount, how)`,
 * because every lane in a game reaches for it: a bullet, a fall, a fire on the
 * floor, a script that just wants the boss dead. One verb means one place where
 * a kill is decided and one place that announces it, so a kill feed, a score, a
 * particle burst and a sound can all be built on the announcement instead of on
 * whoever happened to fire.
 *
 * The state lives on the entity as `entity.damageable`, the same bag name the
 * rest of this engine already reads — Particles asks it whether a thing bleeds,
 * a heads-up display asks it for a bar. A bag rather than a lookup table keeps
 * the composition rule the world model has: nothing may query this plugin, and
 * everything may read the entity.
 *
 * What this file deliberately does NOT own: hit flash, knockback, floating
 * numbers, screen shake. Those are reactions to `entity:hurt` and
 * `entity:killed`, and they live in their own plugins so a game can have the
 * arithmetic without the theatre, or the theatre tuned its own way.
 *
 * A game whose own damage rules go further — armour, hitboxes, friendly fire —
 * publishes its own `context.damage` from a project plugin and shadows this
 * one. That is why every entity this file manages is remembered in a set of its
 * own: a project that replaces the verb must not find this plugin still quietly
 * deleting its corpses.
 */

import { asVector } from '../../engine/vector.js'

/** Everything this plugin set up. Nothing else is its business. See the header. */
const managed = new Set()

const now = context => context.time

/**
 * The bag, made on demand from whatever the type already said.
 *
 * A type that declares `health` in its properties has already answered the only
 * question this needs, so asking it to also attach something would be asking it
 * twice. `maxHealth` falls back to the starting health, because a thing that
 * never said how tough it is is exactly as tough as it started.
 */
function setUp(entity, options = {}) {
  const properties = entity.properties || {}
  const max = Number(options.maxHealth ?? properties.maxHealth ?? options.health ?? properties.health ?? 1)
  const bag = entity.damageable || (entity.damageable = {})

  bag.maxHealth = max > 0 ? max : 1
  bag.health = Number(options.health ?? properties.health ?? bag.maxHealth)
  bag.alive = bag.health > 0
  bag.lastHurtBy = null
  bag.hurtAt = -1
  bag.diedAt = -1
  bag.invulnerableUntil = -1
  // Per-source cooldowns. A weapon that overlaps a target for half a second
  // must hit it once, not thirty times, and how often is the weapon's rule —
  // so it is keyed by whatever name the caller hits under.
  bag.shielded = {}
  // Whether this plugin removes the body, and how long it waits. A player is
  // the obvious exception: killing one ends a run, it does not delete a kitten.
  bag.removeOnDeath = options.removeOnDeath ?? true
  bag.linger = Number(options.linger ?? 0.35)
  if (options.team !== undefined) bag.team = options.team

  managed.add(entity)
  return bag
}

/** The bag if there is one, made if the entity has said anything about health. */
function bagFor(entity) {
  if (!entity || typeof entity !== 'object') return null
  if (entity.damageable && managed.has(entity)) return entity.damageable
  // A bag somebody else made — a project behaviour, most likely. Read it, never
  // take it over, and never queue its owner for removal.
  if (entity.damageable) return entity.damageable
  if (entity.properties?.health === undefined && entity.properties?.maxHealth === undefined) return null
  return setUp(entity, {})
}

/** Straight-line distance, ignoring height. A top-down game hits by footprint. */
const flatDistance = (a, b) => Math.hypot(a.x - b.x, (a.z || 0) - (b.z || 0))

export default {
  name: 'Health',
  category: 'game',
  about: 'Health, the one damage verb, and the moment something dies — the arithmetic of a hit, without the theatre.',

  inspect: context => {
    const alive = [...managed].filter(entity => entity.damageable?.alive)
    return [{
      title: 'Health',
      rows: [
        ['tracked', managed.size],
        ['alive', alive.length],
        ['weakest', alive.map(e => `${e.id} ${Math.ceil(e.damageable.health)}`).sort()[0] || '—']
      ]
    }]
  },

  onLoad(context) {
    /**
     * Take health off something.
     *
     * @param target  the entity being hit
     * @param amount  how much, before anything modifies it
     * @param how     from       who or what did it, for the kill feed
     *                source     a name to hold a per-target cooldown under
     *                every      seconds this source must wait before it may hit
     *                           this same target again
     *                direction  which way the blow travelled, for knockback
     *                point      where it landed, for a number and a spark
     *                critical   true if the game decided this one is a big one
     *                hitbox     'head', 'body' — passed straight through
     * @returns { dealt, remaining, killed, blocked }
     */
    function damage(target, amount, how = {}) {
      const bag = bagFor(target)
      if (!bag) return { dealt: 0, blocked: 'nothing to damage' }
      if (bag.alive === false) return { dealt: 0, blocked: 'already dead' }

      const at = now(context)
      const key = how.source ? String(how.source) : ''
      if (key && bag.shielded && bag.shielded[key] > at) {
        return { dealt: 0, blocked: 'hit too recently by this source' }
      }
      if (bag.invulnerableUntil > at) return { dealt: 0, blocked: 'invulnerable' }

      const asked = Math.max(0, Number(amount) || 0)
      if (!asked) return { dealt: 0, blocked: 'no damage' }

      const dealt = Math.min(asked, bag.health)
      bag.health -= dealt
      bag.hurtAt = at
      bag.lastHurtBy = how.from?.id ?? how.from ?? null
      if (key && how.every > 0) (bag.shielded || (bag.shielded = {}))[key] = at + Number(how.every)
      if (how.invulnerableFor > 0) bag.invulnerableUntil = at + Number(how.invulnerableFor)
      // The properties are what a level authored and what the inspector shows,
      // so they follow the bag rather than being a second opinion about it.
      if (target.properties && 'health' in target.properties) target.properties.health = bag.health

      const event = {
        entity: target, target, amount: dealt, dealt,
        remaining: bag.health,
        from: how.from ?? null,
        source: how.source ?? null,
        direction: asVector(how.direction),
        point: asVector(how.point) || { x: target.x, y: target.y, z: target.z },
        critical: how.critical === true,
        hitbox: how.hitbox ?? null,
        // Passed through untouched. How hard a hit shoves is the weapon's
        // number, and whoever reacts to it is not this file.
        knockback: Number(how.knockback) || 0
      }
      context.bus.emit('entity:hurt', event)

      if (bag.health > 0) return { dealt, remaining: bag.health, killed: false }

      bag.health = 0
      bag.alive = false
      bag.diedAt = at
      context.bus.emit('entity:killed', { ...event, victim: target, remaining: 0 })
      return { dealt, remaining: 0, killed: true }
    }

    /** Put health back, never above the maximum. Returns how much actually landed. */
    function heal(target, amount) {
      const bag = bagFor(target)
      if (!bag || bag.alive === false) return 0
      const given = Math.max(0, Math.min(Number(amount) || 0, bag.maxHealth - bag.health))
      bag.health += given
      if (target.properties && 'health' in target.properties) target.properties.health = bag.health
      if (given > 0) context.bus.emit('entity:healed', { entity: target, amount: given, remaining: bag.health })
      return given
    }

    /**
     * Everything alive inside a circle, hit at once.
     *
     * Flat distance, not spherical: a top-down game decides who is in a blast by
     * where their feet are, and a hitbox that also asked about height would spare
     * anything standing on a step.
     */
    function damageInRadius(how = {}) {
      const at = asVector(how.at)
      const radius = Number(how.radius) || 0
      if (!at || radius <= 0) return []
      const hit = []
      for (const entity of context.world.entities) {
        if (entity === how.from) continue
        const bag = entity.damageable
        if (!bag || bag.alive === false) continue
        if (typeof how.hits === 'function' && !how.hits(entity)) continue
        // The target's own footprint counts, so a big thing is hit at the edge
        // of the blast rather than only when its middle is inside it.
        if (flatDistance(entity, at) > radius + (radiusOf(entity) || 0)) continue
        const result = damage(entity, how.damage, {
          ...how,
          direction: how.direction || { x: entity.x - at.x, y: 0, z: entity.z - at.z },
          point: { x: entity.x, y: entity.y, z: entity.z }
        })
        if (result.dealt > 0) hit.push({ entity, ...result })
      }
      return hit
    }

    context.damage = damage
    context.heal = heal
    context.health = {
      give: (entity, options) => setUp(entity, options || {}),
      of: entity => entity?.damageable || null,
      alive: entity => entity?.damageable?.alive !== false,
      damageInRadius,
      radiusOf,
      /** Everything with health left, optionally narrowed by a test. */
      living: (test) => context.world.entities.filter(entity =>
        entity.damageable?.alive !== false && entity.damageable && (!test || test(entity))),
      /** The closest living thing to a point that passes the test, or null. */
      nearest(to, options = {}) {
        const from = asVector(to) || to
        const reach = Number(options.within) || Infinity
        let best = null, bestAway = Infinity
        for (const entity of context.world.entities) {
          if (entity === to || entity === options.from) continue
          if (!entity.damageable || entity.damageable.alive === false) continue
          if (typeof options.hits === 'function' && !options.hits(entity)) continue
          const away = flatDistance(entity, from)
          if (away > reach || away >= bestAway) continue
          best = entity
          bestAway = away
        }
        return best ? { entity: best, distance: bestAway } : null
      },
      get tracked() { return managed.size }
    }

    /**
     * A pool the moment the thing exists, not the moment it is first hit.
     *
     * Everything that looks for a target reads `entity.damageable` — this
     * plugin's own `nearest`, a weapon's aim, the Particles wiring asking
     * whether a thing bleeds. Making the bag on the first hit meant nothing
     * could be aimed at until something had already hit it, which is a
     * circular condition and reads as "the weapons ignore that enemy".
     */
    const arm = entity => {
      if (entity?.damageable) return
      if (entity?.properties?.health === undefined && entity?.properties?.maxHealth === undefined) return
      setUp(entity, {})
    }

    context.bus.on('entity:added', arm)

    // A new level is a new run: the old entities are gone, and holding them
    // would keep every corpse of every playthrough from being collected. Built
    // again from the world rather than just emptied, because the level's own
    // entities were added before this event and would otherwise be forgotten.
    context.bus.on('level:loaded', () => {
      managed.clear()
      for (const entity of context.world.entities) arm(entity)
    })
    context.bus.on('entity:removed', entity => managed.delete(entity))
  },

  systems: [{
    phase: 'fixed',
    /**
     * Collect the dead, once their linger is up.
     *
     * Removal waits so a death has somewhere to happen — a squash, a fade, a
     * burst of coins. Anything that wants longer sets `damageable.linger`, and
     * anything that must not be removed at all sets `removeOnDeath` to false.
     */
    run(world, seconds, context) {
      if (!managed.size) return
      const at = context.time
      for (const entity of [...managed]) {
        const bag = entity.damageable
        if (!bag || bag.alive !== false || bag.removeOnDeath === false) continue
        if (at < bag.diedAt + (bag.linger || 0)) continue
        managed.delete(entity)
        context.world.destroy(entity)
      }
    }
  }],

  commands: [
    {
      id: 'health.list',
      label: 'What is alive and how hurt it is',
      run: context => context.world.entities
        .filter(entity => entity.damageable)
        .map(entity => ({
          id: entity.id,
          type: entity.type,
          health: round(entity.damageable.health),
          maxHealth: entity.damageable.maxHealth,
          alive: entity.damageable.alive !== false
        }))
    },
    {
      id: 'health.damage',
      label: 'Damage one entity by id',
      /** `run health.damage '["bandit-2", 25]'` */
      run: (context, args) => {
        const [id, amount] = Array.isArray(args) ? args : [args, 1]
        const entity = context.world.byId(String(id))
        if (!entity) throw new Error(`no entity "${id}"`)
        return context.damage(entity, Number(amount) || 1, { source: 'health.damage' })
      }
    },
    {
      id: 'health.give',
      label: 'Give one entity a health pool',
      /** `run health.give '["dummy-1", {"health": 40}]'` */
      run: (context, args) => {
        const [id, options] = Array.isArray(args) ? args : [args, {}]
        const entity = context.world.byId(String(id))
        if (!entity) throw new Error(`no entity "${id}"`)
        return { id: entity.id, ...context.health.give(entity, options || {}) }
      }
    }
  ]
}

/**
 * How wide a thing is, in metres, from whatever it already declared.
 *
 * A collider first, because that is the shape the game agreed on; the drawn box
 * second, because a thing with no collider still has to be hittable; and half a
 * metre when it has said nothing at all, which is about a person.
 */
export function radiusOf(entity) {
  const box = entity?.collider?.box || entity?.mesh?.box
  if (Array.isArray(box) && Number.isFinite(box[0])) {
    return Math.max(Number(box[0]) || 0, Number(box[2]) || 0) / 2
  }
  return 0.5
}

const round = n => Math.round(n * 100) / 100
