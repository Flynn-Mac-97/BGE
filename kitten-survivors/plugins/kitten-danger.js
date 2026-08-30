/**
 * What the crowd does to the kitten. The reason a run ends.
 *
 * Every part of this existed and none of it was joined. The five families each
 * declare `contactDamage` in their properties; the Horde publishes
 * `context.horde.touching(entity)` and its own guide calls it "what is eating
 * the kitten"; Health owns `context.damage`. Nothing read the first, nothing
 * called the second, and the kitten's health bar sat at 100/100 through a run
 * of five thousand kills. A survivor you cannot lose is a screensaver with a
 * kill counter.
 *
 * That is a seam, not an oversight: one lane built the crowd and another built
 * the cat, each finished its own half, and the join belonged to neither.
 */

/**
 * Seconds one enemy must wait before biting the same kitten again.
 *
 * Contact is continuous — a rat that reaches you is touching you every step —
 * so without a cooldown a single rat does its damage sixty times a second and
 * the kitten dies in under a second at level one. Half a second is about a
 * bite, and it is per-enemy rather than per-kitten: standing in a crowd of ten
 * has to hurt ten times as much as standing next to one, or there is no reason
 * to keep moving, which is the entire game.
 */
const BITE_INTERVAL = 0.5

/** How far past the two radii still counts as contact. Enemies are small; a hair of reach keeps a chase from feeling hollow. */
const REACH = 0.05

/**
 * Metres past contact that already count as danger.
 *
 * Being bitten is loud — the world freezes, the kitten flashes, a number comes
 * off it — but it arrives with no notice, and a survivor is played by reading
 * the crowd a moment before it closes. This band is the notice: anything inside
 * it is close enough to bite next.
 */
const WARNING_BAND = 0.55

/** Seconds between warning pulses. One pulse however many are closing in. */
const WARNING_EVERY = 0.22

/**
 * The ring that says the crowd has reached you.
 *
 * Full-saturation red is a colour nothing else in this game uses, so danger is
 * separable by colour alone — the same rule the effects bible sets for every
 * effect. It is a shell of dots thrown from the kitten, so from a top-down
 * camera it reads as a ring closing on it.
 */
const WARNING_RING = {
  speed: 2.1, life: 0.26, size: 0.09, blend: 'add',
  colour: ['#ff1f3d', '#ffffff'], drag: 1
}

/** Dots in a pulse for the first enemy closing, and for every one after it. */
const WARNING_FIRST = 4
const WARNING_EACH = 1

/** Most dots one pulse may spend. Forty enemies closing is still one pulse. */
const WARNING_MOST = 16

/** The spark where a bite lands, in the same red, so a bite has a place. */
const BITE_SPARK = {
  count: 5, speed: [1.5, 3.4], life: [0.12, 0.24], size: 0.07, blend: 'add',
  colour: ['#ff1f3d', '#ffffff'], gravity: -3, drag: 2
}

/** Seconds since the last warning pulse. */
let warningCarry = 0

export default {
  name: 'Kitten Danger',
  about: 'The crowd bites, the kitten bleeds, and the run can be lost — with a red warning before the teeth arrive.',
  needs: ['Horde', 'Health', 'Run Clock', 'Particles'],

  onLoad(context) {
    const you = () => context.world.byId('you')

    context.bus.on('play:started', () => {
      const kitten = you()
      if (!kitten) return
      // Health arms anything declaring `health`, but only on its first hit —
      // and the run has to be watching a pool that exists before one lands.
      context.health.give(kitten, {
        health: kitten.properties.health,
        maxHealth: kitten.properties.maxHealth,
        removeOnDeath: false
      })
      context.runClock?.watch(kitten)
    })

    context.bus.on('level:loaded', () => { warningCarry = 0 })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const kitten = world.byId('you')
      if (!kitten || !context.health?.alive(kitten)) return

      bite(context, kitten)
      warn(context, kitten, seconds)
    }
  }],

  commands: [{
    id: 'kitten.danger',
    label: 'What is biting the kitten',
    run(context) {
      const kitten = context.world.byId('you')
      if (!kitten) return { biting: 0, why: 'no kitten in this level' }
      const touching = context.horde.touching(kitten, REACH)
      return {
        health: context.health.of(kitten)?.health ?? kitten.properties.health,
        biting: touching.length,
        /** Close enough to bite next — what the red pulse is warning about. */
        closing: context.horde.touching(kitten, REACH + WARNING_BAND).length,
        // Per second, if every one of them keeps its teeth in.
        incoming: touching.reduce((sum, e) => sum + (e.properties?.contactDamage || 0), 0) / BITE_INTERVAL,
        families: touching.map(e => e.type)
      }
    }
  }]
}

/** Everything in reach takes a bite, on its own cooldown. */
function bite(context, kitten) {
  for (const enemy of context.horde.touching(kitten, REACH)) {
    const damage = enemy.properties?.contactDamage
    if (!damage) continue
    const result = context.damage(kitten, damage, {
      from: enemy,
      // Named per enemy, so each one's cooldown is its own. A shared source
      // name would let a swarm of thirty hit no harder than a single rat.
      source: `bite:${enemy.id}`,
      every: BITE_INTERVAL,
      direction: { x: kitten.x - enemy.x, y: 0, z: kitten.z - enemy.z }
    })
    // Halfway to the enemy, so a bite has a place on screen and the player can
    // see which side of the kitten it came from.
    if (result.dealt > 0) {
      context.particles?.burst({
        at: { x: (kitten.x + enemy.x) / 2, y: kitten.y + 0.3, z: (kitten.z + enemy.z) / 2 },
        ...BITE_SPARK
      })
    }
  }
}

/**
 * One red pulse while anything is close enough to bite next.
 *
 * Throttled and sized by the count rather than fired per enemy, so a crowd of
 * forty costs one burst and reads as one ring rather than forty overlapping
 * ones.
 */
function warn(context, kitten, seconds) {
  warningCarry += seconds
  if (warningCarry < WARNING_EVERY) return
  warningCarry = 0

  const closing = context.horde.touching(kitten, REACH + WARNING_BAND).length
  if (!closing) return

  context.particles?.burst({
    at: { x: kitten.x, y: kitten.y + 0.2, z: kitten.z },
    count: Math.min(WARNING_FIRST + (closing - 1) * WARNING_EACH, WARNING_MOST),
    ...WARNING_RING
  })
}
