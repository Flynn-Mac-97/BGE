/**
 * Kitten Weapons — the four things a kitten fights with, and their numbers.
 *
 * You never press attack in this game. Everything here goes off on its own
 * clock, and the whole of playing it is watching cooldowns overlap into
 * something that clears a screen. So the design brief for each weapon is not
 * "what does it do" but "what does it do that the other three do not":
 *
 *   Claw Dart   picks the nearest thing and throws something at it
 *   Yarn Ball   orbits you and hurts whatever walks into it
 *   Purr Wave   sweeps outward from where you are standing
 *   Hairball    goes backwards, over your shoulder, and bursts
 *
 * One aims, one guards, one clears, one covers your retreat. A build that
 * happens to be strong is a build where those four cover each other.
 *
 * **The kitten starts with Claw Dart alone.** The other three are cards, so the
 * first three level-ups each change what the next thirty seconds look like
 * rather than nudging a number. Kitten Upgrades hands them out.
 *
 * Every number lives in `stats` and nothing here reads a number from anywhere
 * else, because Kitten Upgrades owns changing them from outside:
 * context.autoWeapons.upgrade(you, 'yarn ball', { count: '+1' })
 *
 * The engine's side of all this — cooldowns, damage, projectiles, flash,
 * numbers, hit stop — is in `plugins/builtin`. Nothing in this file is a
 * capability; it is all this game's opinions about how hard a cat hits.
 */

/** Who the weapons belong to. The level places exactly one, with this id. */
const PLAYER = 'you'

/**
 * What the kitten is armed with before the first card.
 *
 * Two, not four and not one. One aimed attack and one that clears the ring you
 * are standing in is the least a player can be given and still have a decision
 * about where to stand; a third and a fourth are cards, so the first two
 * level-ups change what the run looks like instead of nudging a number.
 */
const STARTERS = ['claw dart', 'purr wave']

/**
 * What counts as something to shoot at.
 *
 * Read off the world rather than agreed with the lane that spawns them: a thing
 * with health that is not you, not the floor, and not already in the air is a
 * thing worth clawing. That way this file keeps working the day enemies arrive
 * and needs no import to do it.
 */
const NEVER = new Set(['ground', 'projectile', 'light', 'yarn', 'kitten'])

function isEnemy(entity, player) {
  if (!entity || entity === player) return false
  if (entity.properties?.friendly === true) return false
  if (NEVER.has(entity.type)) return false
  return !!entity.damageable && entity.damageable.alive !== false
}

/** Which way the kitten is facing, as a flat unit vector. */
function facing(player) {
  const yaw = Number(player?.yaw)
  if (Number.isFinite(yaw)) return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }
  const length = Math.hypot(player?.velocityX || 0, player?.velocityZ || 0)
  if (length > 0.01) return { x: player.velocityX / length, y: 0, z: player.velocityZ / length }
  return { x: 0, y: 0, z: 1 }
}

export default {
  name: 'Kitten Weapons',
  about: 'Claw Dart, Yarn Ball, Purr Wave and Hairball — four cooldowns that fire themselves.',
  needs: ['Auto Weapons', 'Projectiles', 'Health', 'Impact', 'Run Clock', 'Kitten Rings'],

  inspect: context => {
    const player = context.world.byId(PLAYER)
    const carried = player ? context.autoWeapons.carriedBy(player) : []
    return [{
      title: 'Armed',
      rows: carried.length
        ? carried.map(weapon => [weapon.name, `level ${weapon.stats.level} · ${weapon.stats.damage} damage`])
        : [['nothing yet', 'no kitten in the level']]
    }]
  },

  onLoad(context) {
    describeWeapons(context)

    // Arm the kitten the moment the level is up, not on play: a headless run
    // simulates without ever entering play mode, and a weapon nobody was given
    // is a weapon that never fires in a test.
    context.bus.on('level:loaded', () => {
      const player = context.world.byId(PLAYER)
      if (!player) return
      // The player is the one thing that must not be swept up when it dies.
      context.health.give(player, { removeOnDeath: false, linger: 0 })
      for (const name of STARTERS) context.autoWeapons.give(player, name)
      // Retry loads the level again, which replaces every entity. The run clock
      // must be handed a lookup rather than a body, or the second run watches
      // the first run's corpse, finds it gone on the first step and ends at
      // 0:00. Kitten Danger hands it a body on `play:started`, which never
      // fires again after a reload, so this puts the lookup back.
      context.runClock?.watch(() => context.world.byId(PLAYER))
    })
  },

  commands: [{
    id: 'kitten.weapons',
    label: 'What the kitten is carrying',
    run: context => {
      const player = context.world.byId(PLAYER)
      if (!player) return { armed: false, why: `no entity "${PLAYER}" in this level` }
      return {
        armed: true,
        rings: context.kittenRings.count(),
        weapons: context.autoWeapons.carriedBy(player).map(weapon => ({
          name: weapon.name,
          fired: weapon.fired,
          stats: { ...weapon.stats }
        }))
      }
    }
  }]
}

// ------------------------------------------------------------------ the four
function describeWeapons(context) {
  const weapons = context.autoWeapons

  /**
   * Claw Dart — throws a claw at whatever is closest.
   *
   * The one weapon that aims. With nothing to aim at it throws forward anyway,
   * because a weapon that goes quiet when the screen is empty reads as broken
   * rather than as idle.
   */
  weapons.define('claw dart', {
    stats: { damage: 11, cooldown: 1.05, count: 1, speed: 1, area: 1, pierce: 0, knockback: 4 },
    fire(context, player, weapon) {
      const stats = weapon.stats
      const already = new Set()
      const spread = 0.28

      for (let index = 0; index < Math.max(1, Math.round(stats.count)); index++) {
        const found = context.health.nearest(player, {
          from: player,
          within: 18,
          hits: entity => isEnemy(entity, player) && !already.has(entity)
        })
        if (found) already.add(found.entity)

        // Fanned when there is nothing left to pick: extra darts have to go
        // somewhere, and a fan is what reads as "more darts" on an empty screen.
        const aim = found
          ? { x: found.entity.x - player.x, y: 0, z: found.entity.z - player.z }
          : turned(facing(player), (index - (stats.count - 1) / 2) * spread)

        context.projectiles.fire({
          from: { x: player.x, y: player.y + 0.1, z: player.z },
          direction: aim,
          speed: 16 * stats.speed,
          damage: stats.damage,
          life: 1.6 * stats.duration,
          radius: 0.22 * stats.area,
          pierce: stats.pierce,
          knockback: stats.knockback,
          // Enough turn to correct for a walking target, not enough to chase one
          // round a corner. A dart that never misses stops being a decision.
          homing: found ? 3.5 : 0,
          spin: 900,
          owner: player,
          source: 'claw dart',
          hits: entity => isEnemy(entity, player),
          mesh: { box: [0.16 * stats.area, 0.16 * stats.area, 0.4 * stats.area], tint: '#fff3d0' }
        })
      }
      context.play?.('claw')
    }
  })

  /**
   * Yarn Ball — balls that go round you and hurt what walks into them.
   *
   * The defensive one. It never aims and never chases; it makes the ring around
   * you expensive to enter, which is what changes how you move rather than what
   * you shoot. Balls last a while and then the cooldown starts again, so there
   * is a gap you have to survive — take that away and it is a permanent shield.
   */
  weapons.define('yarn ball', {
    stats: { damage: 9, cooldown: 3.4, count: 2, speed: 1, area: 1, duration: 1, knockback: 5 },
    fire(context, player, weapon) {
      const stats = weapon.stats
      context.kittenRings.orbit({
        owner: player,
        count: stats.count,
        radius: 1.5 * stats.area,
        size: 0.34 * stats.area,
        turn: 3.1 * stats.speed,
        seconds: 2.6 * stats.duration,
        damage: stats.damage,
        knockback: stats.knockback,
        source: 'yarn ball',
        hits: entity => isEnemy(entity, player)
      })
      context.play?.('yarn')
    }
  })

  /**
   * Purr Wave — a ring that sweeps out from where you stand.
   *
   * The crowd clearer. It has no direction at all, which is the point: it is the
   * answer to being surrounded, and it is worthless against one thing far away.
   * Damage lands once per enemy as the edge passes them, so standing inside it
   * is not a grinder.
   */
  weapons.define('purr wave', {
    stats: { damage: 14, cooldown: 2.8, count: 1, area: 1, speed: 1, duration: 1, knockback: 7 },
    fire(context, player, weapon) {
      const stats = weapon.stats
      for (let index = 0; index < Math.max(1, Math.round(stats.count)); index++) {
        // A second ring follows rather than starting on top of the first, or
        // "count 2" would be one ring that does double damage.
        const delay = index * 0.22
        const reach = 4.4 * stats.area
        const grow = 9 * stats.speed
        const start = () => {
          context.kittenRings.sweep({
            owner: player, reach, grow,
            damage: stats.damage,
            knockback: stats.knockback,
            source: 'purr wave',
            hits: entity => isEnemy(entity, player)
          })
          // Particles thrown outward at exactly the speed the damage ring
          // travels, so what you see is where it hurts. One burst rather than a
          // ring redrawn every step, which would be sixty bursts a wave.
          context.particles?.burst({
            at: { x: player.x, y: player.y, z: player.z },
            count: 70, speed: grow, life: reach / grow, size: [0.14, 0.3],
            drag: 0, gravity: 0, blend: 'add', colour: ['#cfe4ff', '#ffffff', '#ffe9b8']
          })
        }
        if (delay > 0) context.after(delay, start)
        else start()
      }
      context.play?.('purr')
    }
  })

  /**
   * Hairball — lobbed back over your shoulder, and it bursts.
   *
   * The one that fires the wrong way. In a game where you spend the whole run
   * walking away from a crowd, backwards is where the crowd is, and a weapon
   * that only covers your retreat is worth carrying for exactly that reason.
   */
  weapons.define('hairball', {
    stats: { damage: 26, cooldown: 3.9, count: 1, area: 1, speed: 1, duration: 1, knockback: 9 },
    fire(context, player, weapon) {
      const stats = weapon.stats
      const behind = facing(player)
      const many = Math.max(1, Math.round(stats.count))

      for (let index = 0; index < many; index++) {
        const away = turned({ x: -behind.x, y: 0, z: -behind.z }, (index - (many - 1) / 2) * 0.45)
        context.projectiles.fire({
          from: { x: player.x, y: player.y + 0.3, z: player.z },
          // Thrown up as well as back, so it arcs over whatever is chasing you
          // and lands behind them rather than at your heels.
          direction: { x: away.x, y: 0.5, z: away.z },
          speed: 7 * stats.speed,
          gravity: -1.6,
          damage: Math.round(stats.damage * 0.35),
          life: 1.05 * stats.duration,
          radius: 0.3 * stats.area,
          knockback: stats.knockback,
          spin: 420,
          owner: player,
          source: 'hairball',
          hits: entity => isEnemy(entity, player),
          mesh: { box: [0.34 * stats.area, 0.34 * stats.area, 0.34 * stats.area], tint: '#a9906f' },
          onEnd: shot => burst(shot, stats, player, context)
        })
      }
      context.play?.('cough')
    }
  })
}

/** Where a hairball stops, whatever stopped it. */
function burst(shot, stats, player, context) {
  const at = { x: shot.entity.x, y: shot.entity.y, z: shot.entity.z }
  const radius = 2.4 * stats.area

  context.health.damageInRadius({
    at,
    radius,
    damage: stats.damage,
    from: player,
    source: 'hairball burst',
    knockback: stats.knockback,
    critical: true,
    hits: entity => isEnemy(entity, player)
  })

  context.bus.emit('explosion', { at })
  context.impact.hit({ weight: 0.85, at, sound: 'burst' })
}

/** Turn a flat vector by an angle, for a fan of shots. */
function turned(vector, radians) {
  const sin = Math.sin(radians), cos = Math.cos(radians)
  return { x: vector.x * cos - vector.z * sin, y: 0, z: vector.x * sin + vector.z * cos }
}
