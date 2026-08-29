/**
 * Kitten Rings — the two weapons that are a shape around you rather than a shot.
 *
 * A claw dart and a hairball leave your hands and Projectiles takes them from
 * there. The yarn and the purr never leave: one is a ring that turns around you
 * and one is a ring that opens out from where you stood. Neither travels in a
 * straight line, neither has a target, and both have to be carried forward
 * every step — so they are ticked here rather than pretended to be bullets.
 *
 * Kept apart from Kitten Weapons because they are a different job. That file
 * says what each weapon costs and how often it goes off; this one owns the two
 * shapes that hang about afterwards and what walking into them does.
 *
 * Both take a `hits` test rather than knowing what an enemy is, exactly the way
 * `context.projectiles.fire` does. A ring that decided for itself who counts
 * would have to be edited every time the game gains a kind of thing.
 */

/** Live rings. Module scope so reloading this file does not strand a turning ball. */
const orbiting = []
const sweeping = []

/** A point a little above the middle of a thing, which is where a hit looks right. */
const chestOf = entity => ({ x: entity.x, y: entity.y + 0.25, z: entity.z })

export default {
  name: 'Kitten Rings',
  about: 'The yarn ring that turns around you and the purr ring that sweeps out — the weapons that are a shape, not a shot.',
  needs: ['Health'],

  inspect: () => [{
    title: 'Rings',
    rows: [['balls turning', orbiting.length], ['waves opening', sweeping.length]]
  }],

  onLoad(context) {
    /**
     * Put balls in orbit around someone.
     *
     * @param how  owner      what they go round
     *             count      how many, spaced evenly so three make a triangle
     *             radius     metres out
     *             turn       radians a second
     *             seconds    how long before they unravel
     *             damage     per touch
     *             every      seconds before the same target may be hit again
     *             knockback  metres a second the touch shoves
     *             size       metres across
     *             tint       what colour
     *             hits       test deciding what a ball may hurt
     *             source     the name a hit is reported under
     */
    function orbit(how = {}) {
      const owner = how.owner
      if (!owner) return []
      const many = Math.max(1, Math.round(Number(how.count) || 1))
      const size = Number(how.size) || 0.34
      const until = context.time + (Number(how.seconds) || 2.6)
      const made = []

      for (let index = 0; index < many; index++) {
        const entity = context.world.spawn('yarn', {
          at: [owner.x, owner.y, owner.z],
          mesh: { box: [size, size, size], tint: how.tint || '#e88fb0' }
        })
        const ball = {
          entity,
          owner,
          // Spaced round the ring, so three balls are a triangle and not a clump
          // that leaves two thirds of you open.
          angle: (index / many) * Math.PI * 2,
          radius: Number(how.radius) || 1.5,
          turn: Number(how.turn) || 3.1,
          damage: Number(how.damage) || 0,
          every: Number(how.every) || 0.34,
          knockback: Number(how.knockback) || 0,
          source: how.source || 'orbit',
          hits: typeof how.hits === 'function' ? how.hits : null,
          until
        }
        orbiting.push(ball)
        made.push(entity)
      }
      return made
    }

    /**
     * Open a ring out from a point, hurting each thing once as the edge reaches it.
     *
     * Once, not continuously: standing inside a sweep must not be a grinder, or
     * the weapon stops being a way out of a crowd and becomes a way to farm one.
     */
    function sweep(how = {}) {
      const at = how.at || how.owner
      if (!at) return null
      const wave = {
        owner: how.owner || null,
        x: at.x, y: at.y, z: at.z,
        radius: Number(how.from) || 0.4,
        reach: Number(how.reach) || 4.4,
        grow: Number(how.grow) || 9,
        damage: Number(how.damage) || 0,
        knockback: Number(how.knockback) || 0,
        source: how.source || 'sweep',
        hits: typeof how.hits === 'function' ? how.hits : null,
        struck: new Set()
      }
      sweeping.push(wave)
      return wave
    }

    context.kittenRings = {
      orbit,
      sweep,
      clear() {
        for (const ball of orbiting.splice(0)) context.world.destroy(ball.entity)
        sweeping.length = 0
      },
      count: () => ({ orbiting: orbiting.length, sweeping: sweeping.length })
    }

    context.bus.on('level:loaded', () => { orbiting.length = 0; sweeping.length = 0 })

    // A ring goes round its owner, so an owner that has left the world takes it
    // with it rather than leaving one turning around a stale position.
    context.bus.on('entity:removed', entity => {
      for (let index = orbiting.length - 1; index >= 0; index--) {
        if (orbiting[index].owner === entity) orbiting.splice(index, 1)
      }
    })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      turnTheYarn(seconds, context)
      spreadTheWaves(seconds, context)
    }
  }],

  commands: [
    {
      id: 'kitten.rings',
      label: 'What is turning and what is opening out',
      run: () => ({
        orbiting: orbiting.map(ball => ({ id: ball.entity.id, source: ball.source, damage: ball.damage })),
        sweeping: sweeping.map(wave => ({ source: wave.source, radius: round(wave.radius), reach: wave.reach }))
      })
    },
    {
      id: 'kitten.rings.clear',
      label: 'Unravel every ring',
      run: context => { context.kittenRings.clear(); return context.kittenRings.count() }
    }
  ]
}

/**
 * One hit from something that is not a projectile.
 *
 * Both rings land damage and then announce it, and announcing it is what the
 * particles and the hit feel are built on — so they share this rather than each
 * remembering to emit.
 */
function landHit(context, target, from, ring) {
  const point = chestOf(target)
  const result = context.damage(target, ring.damage, {
    from: ring.owner,
    source: ring.source,
    every: ring.every,
    direction: { x: target.x - from.x, y: 0, z: target.z - from.z },
    point,
    knockback: ring.knockback
  })
  if (result.dealt > 0) {
    context.bus.emit('weapon:hit', { entity: ring.owner, target, point, weapon: ring.source, ...result })
  }
  return result
}

/** Carry each ball round its owner, and hurt what it passes through. */
function turnTheYarn(seconds, context) {
  const at = context.time
  for (let index = orbiting.length - 1; index >= 0; index--) {
    const ball = orbiting[index]
    if (at >= ball.until) {
      orbiting.splice(index, 1)
      context.world.destroy(ball.entity)
      continue
    }

    const owner = ball.owner
    ball.angle += ball.turn * seconds
    ball.entity.x = owner.x + Math.sin(ball.angle) * ball.radius
    ball.entity.z = owner.z + Math.cos(ball.angle) * ball.radius
    ball.entity.y = owner.y + 0.1
    ball.entity.rotation = (ball.entity.rotation || 0) + 300 * seconds

    for (const target of context.world.entities) {
      if (ball.hits && !ball.hits(target)) continue
      if (Math.hypot(target.x - ball.entity.x, target.z - ball.entity.z) > 0.4 + context.health.radiusOf(target)) continue
      landHit(context, target, owner, ball)
    }
  }
}

/** Open every wave, hurting each thing once as the edge reaches it. */
function spreadTheWaves(seconds, context) {
  for (let index = sweeping.length - 1; index >= 0; index--) {
    const wave = sweeping[index]
    wave.radius += wave.grow * seconds
    if (wave.radius > wave.reach) { sweeping.splice(index, 1); continue }

    for (const target of context.world.entities) {
      if (wave.struck.has(target)) continue
      if (wave.hits && !wave.hits(target)) continue
      if (Math.hypot(target.x - wave.x, target.z - wave.z) > wave.radius + context.health.radiusOf(target)) continue
      wave.struck.add(target)
      landHit(context, target, wave, wave)
    }
  }
}

const round = n => Math.round(n * 100) / 100
