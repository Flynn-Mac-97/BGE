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

export default {
  name: 'Kitten Danger',
  about: 'The crowd bites, the kitten bleeds, and the run can be lost.',
  needs: ['Horde', 'Health', 'Run Clock'],

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
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const kitten = world.byId('you')
      if (!kitten || !context.health?.alive(kitten)) return

      for (const enemy of context.horde.touching(kitten, REACH)) {
        const bite = enemy.properties?.contactDamage
        if (!bite) continue
        context.damage(kitten, bite, {
          from: enemy,
          // Named per enemy, so each one's cooldown is its own. A shared source
          // name would let a swarm of thirty hit no harder than a single rat.
          source: `bite:${enemy.id}`,
          every: BITE_INTERVAL,
          direction: { x: kitten.x - enemy.x, y: 0, z: kitten.z - enemy.z }
        })
      }
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
        // Per second, if every one of them keeps its teeth in.
        incoming: touching.reduce((sum, e) => sum + (e.properties?.contactDamage || 0), 0) / BITE_INTERVAL,
        families: touching.map(e => e.type)
      }
    }
  }]
}
