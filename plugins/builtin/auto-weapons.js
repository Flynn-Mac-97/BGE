/**
 * Auto Weapons — weapons that fire themselves, on their own clocks.
 *
 * The genre this exists for never asks the player to press attack. You steer,
 * and everything you are carrying goes off on its own cooldown. So the loop is
 * not "read input, fire" — it is "count down, fire, count again", once per
 * weapon per carrier, and the interesting part of the game is the numbers.
 *
 * Which is why every number a weapon has lives in one flat bag, `weapon.stats`,
 * and nothing else. An upgrade is then a change to a number somebody else can
 * make without reading a line of this file:
 *
 *   context.autoWeapons.upgrade(you, 'claw dart', { damage: +4, count: +1 })
 *
 * The six stats below are the ones every weapon in the genre shares. A weapon
 * may add its own, and an upgrade may raise any of them — nothing here is a
 * fixed list, because the moment it is, the upgrade lane has to come back and
 * edit this file to raise a stat it invented.
 *
 * `fire` gets the owner, the weapon and the context and does whatever it likes.
 * That is deliberate: an orbiting shield, a sweeping aura and a homing dart
 * share a cooldown and share nothing else, and a framework that tried to
 * describe all three would describe none of them well.
 *
 * The name is `Auto Weapons`, not `Weapons`, because a project may already ship
 * a plugin called `Weapons` — plugins are keyed by name, and one silently
 * replacing the other is the worst outcome available.
 */

/** What a weapon has before it says otherwise. Every one of these is upgradeable. */
const STATS = {
  level: 1,
  damage: 10,
  /** Seconds between shots. Lower is faster; nothing is allowed to reach zero. */
  cooldown: 1,
  /** How many things one firing puts out — darts, orbiting balls, sweeps. */
  count: 1,
  /** How big it is, as a multiplier on whatever the weapon calls its size. */
  area: 1,
  /** How fast what it makes travels, as a multiplier. */
  speed: 1,
  /** How long what it makes lasts, as a multiplier. */
  duration: 1,
  /** Bodies a shot may pass through beyond the first. */
  pierce: 0,
  /** Metres a second a hit shoves the thing that took it. */
  knockback: 0
}

/** No cooldown may go below this, or one upgrade too many fires every step. */
const FASTEST = 1 / 30

/** name -> definition. Module scope so a reload of the plugin keeps the table. */
const defined = new Map()

/** entity -> Map(name -> instance). Carriers, in the order they were armed. */
const carried = new Map()

const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/**
 * Fold a change into a bag of numbers.
 *
 * `{ damage: 4 }` sets damage to four. `{ damage: '+4' }` adds four, and
 * `{ cooldown: '*0.9' }` takes a tenth off it. Both forms matter: an upgrade
 * screen offering "+1 projectile" and a weapon that becomes exactly level 4 are
 * different sentences, and a table that only understood one would force the
 * other to be written out by hand every time.
 */
function fold(stats, changes) {
  for (const [key, change] of Object.entries(changes || {})) {
    if (typeof change === 'number') { stats[key] = change; continue }
    const text = String(change).trim()
    const amount = Number(text.slice(1))
    if (!Number.isFinite(amount)) { stats[key] = change; continue }
    const base = number(stats[key], 0)
    if (text.startsWith('+')) stats[key] = base + amount
    else if (text.startsWith('-')) stats[key] = base - amount
    else if (text.startsWith('*')) stats[key] = base * amount
    else stats[key] = Number(text)
  }
  if (stats.cooldown !== undefined) stats.cooldown = Math.max(FASTEST, number(stats.cooldown, 1))
  return stats
}

export default {
  name: 'Auto Weapons',
  category: 'game',
  about: 'Weapons that fire on their own cooldowns.',
  needs: ['Health'],

  inspect: () => {
    const rows = []
    for (const [owner, weapons] of carried) {
      for (const weapon of weapons.values()) {
        rows.push([`${owner.id} ${weapon.name}`, `level ${weapon.stats.level} · ${weapon.fired} fired`])
      }
    }
    return [{ title: 'Carried', rows: rows.length ? rows : [['nothing armed', '—']] }]
  },

  onLoad(context) {
    /**
     * Describe a weapon once, by name.
     *
     * @param name        what it is called, and what an upgrade names to reach it
     * @param definition  stats  the numbers it starts with, over the defaults
     *                    fire   (context, owner, weapon) — called each cooldown
     *                    ready  optional test; false holds the cooldown at zero
     *                    start  optional, called when someone is given it
     *                    stop   optional, called when it is taken away
     *                    warmUp seconds before its first shot, default: one
     *                           cooldown, so nothing all fires on frame one
     */
    function define(name, definition = {}) {
      if (typeof definition.fire !== 'function') {
        console.error(`[auto weapons] "${name}" has no fire(context, owner, weapon) — it will never do anything`)
      }
      defined.set(name, { ...definition, name })
      return defined.get(name)
    }

    /** Arm someone. `overrides` set this carrier's own starting numbers. */
    function give(owner, name, overrides = {}) {
      const definition = defined.get(name)
      if (!owner || !definition) {
        console.error(`[auto weapons] cannot give "${name}" — ${!owner ? 'no owner' : 'no weapon by that name'}`)
        return null
      }
      let held = carried.get(owner)
      if (!held) carried.set(owner, held = new Map())
      if (held.has(name)) return held.get(name)

      const stats = fold({ ...STATS, ...(definition.stats || {}) }, overrides)
      const weapon = {
        name,
        owner,
        stats,
        definition,
        // Its own bag for whatever it needs to remember between shots — the
        // angle an orbit has reached, which enemy it last chose. Nothing else
        // reads it, which is why it is not in `stats`.
        state: {},
        fired: 0,
        lastFiredAt: -1,
        // Counted down rather than up, so "how long until this goes off" is the
        // number itself and a display needs no arithmetic.
        cooldownLeft: number(definition.warmUp, stats.cooldown)
      }
      held.set(name, weapon)
      definition.start?.(context, owner, weapon)
      context.bus.emit('weapon:given', { entity: owner, weapon: name, stats })
      return weapon
    }

    /** Disarm. The weapon's own `stop` gets to clean up whatever it left about. */
    function take(owner, name) {
      const held = carried.get(owner)
      const weapon = held?.get(name)
      if (!weapon) return false
      weapon.definition.stop?.(context, owner, weapon)
      held.delete(name)
      if (!held.size) carried.delete(owner)
      context.bus.emit('weapon:taken', { entity: owner, weapon: name })
      return true
    }

    /**
     * Change a weapon's numbers. This is the whole upgrade surface.
     *
     * Returns the stats it now has, so a screen can show what changed without
     * reading them back out of the carrier.
     */
    function upgrade(owner, name, changes = {}) {
      const weapon = carried.get(owner)?.get(name)
      if (!weapon) {
        console.error(`[auto weapons] cannot upgrade "${name}" — that carrier does not have it`)
        return null
      }
      fold(weapon.stats, changes)
      weapon.definition.upgraded?.(context, owner, weapon, changes)
      context.bus.emit('weapon:upgraded', { entity: owner, weapon: name, stats: weapon.stats, changes })
      return weapon.stats
    }

    /** One level up, and whatever else that level is worth. */
    const levelUp = (owner, name, changes = {}) =>
      upgrade(owner, name, { level: '+1', ...changes })

    /** Fire now, cooldown or not. The upgrade screen's preview, and a test's lever. */
    function fireNow(owner, name) {
      const weapon = carried.get(owner)?.get(name)
      if (!weapon) return null
      return discharge(weapon, context)
    }

    context.autoWeapons = {
      define, give, take, upgrade, levelUp, fireNow,
      /** The stat names every weapon starts with, for a screen that lists them. */
      stats: () => ({ ...STATS }),
      defined: () => [...defined.keys()],
      of: (owner, name) => carried.get(owner)?.get(name) || null,
      carriedBy: owner => [...(carried.get(owner)?.values() || [])],
      /** Everyone armed, and what they hold. What a save or a screen reads. */
      everyone: () => [...carried].map(([owner, held]) => ({
        owner,
        weapons: [...held.values()].map(weapon => ({ name: weapon.name, stats: { ...weapon.stats } }))
      }))
    }

    // A level change replaces every entity, so the carriers are gone. Keeping
    // them would arm a fresh kitten from the last run's memory of one.
    context.bus.on('level:loaded', () => carried.clear())
    context.bus.on('entity:removed', entity => carried.delete(entity))
  },

  systems: [{
    phase: 'fixed',
    /**
     * Count every cooldown down, fire whatever reached zero.
     *
     * A weapon whose carrier has died stops rather than being taken away — a run
     * that ends should still be able to show what you were holding.
     */
    run(world, seconds, context) {
      if (!carried.size) return
      for (const [owner, held] of carried) {
        if (owner.damageable?.alive === false) continue
        for (const weapon of held.values()) {
          if (weapon.definition.ready && !weapon.definition.ready(context, owner, weapon)) continue
          weapon.cooldownLeft -= seconds
          if (weapon.cooldownLeft > 0) continue
          // Set before firing, so a weapon that fires again from inside its own
          // fire hook cannot spin.
          weapon.cooldownLeft += Math.max(FASTEST, number(weapon.stats.cooldown, 1))
          discharge(weapon, context)
        }
      }
    }
  }],

  commands: [
    {
      id: 'weapons.carried',
      label: 'Who is armed',
      run: () => [...carried].map(([owner, held]) => ({
        owner: owner.id,
        weapons: [...held.values()].map(weapon => ({
          name: weapon.name,
          fired: weapon.fired,
          nextIn: round(weapon.cooldownLeft),
          stats: { ...weapon.stats }
        }))
      }))
    },
    {
      id: 'weapons.give',
      label: 'Give a weapon',
      /** `run weapons.give '["you", "claw dart"]'` */
      run: (context, args) => {
        const [id, name, overrides] = Array.isArray(args) ? args : [args, '', {}]
        const owner = context.world.byId(String(id))
        if (!owner) throw new Error(`no entity "${id}"`)
        const weapon = context.autoWeapons.give(owner, String(name), overrides || {})
        return weapon ? { owner: owner.id, weapon: weapon.name, stats: weapon.stats } : null
      }
    },
    {
      id: 'weapons.upgrade',
      label: 'Change weapon numbers',
      /** `run weapons.upgrade '["you", "claw dart", {"damage": "+5", "count": "+1"}]'` */
      run: (context, args) => {
        const [id, name, changes] = Array.isArray(args) ? args : [args, '', {}]
        const owner = context.world.byId(String(id))
        if (!owner) throw new Error(`no entity "${id}"`)
        return context.autoWeapons.upgrade(owner, String(name), changes || {})
      }
    },
    {
      id: 'weapons.defined',
      label: 'Defined weapons',
      run: () => [...defined].map(([name, definition]) => ({ name, stats: { ...STATS, ...(definition.stats || {}) } }))
    }
  ]
}

/**
 * One firing.
 *
 * Wrapped rather than called directly so a weapon that throws is reported
 * against its own name and stops that one weapon, not the whole cooldown pass —
 * a broken weapon must not disarm the rest of the build.
 */
function discharge(weapon, context) {
  weapon.fired++
  weapon.lastFiredAt = context.time
  try {
    weapon.definition.fire?.(context, weapon.owner, weapon)
  } catch (error) {
    console.error(`[auto weapons] ${weapon.name} failed while firing`, error)
  }
  return weapon
}

const round = n => Math.round(n * 1000) / 1000
