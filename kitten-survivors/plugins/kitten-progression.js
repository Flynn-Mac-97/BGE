/**
 * Kitten Progression — the loop that makes a run a run.
 *
 * Something dies, it leaves a gem, the gem flies to the kitten, the bar fills,
 * the world stops and you choose. Nothing in that sentence is engine work and
 * nothing in it is weapons work; it is the wiring between them, and it is all
 * this file does.
 *
 * The lanes it depends on may not exist yet, so none of them is imported and
 * none of them is required:
 *
 * - **The horde** announces a death. Several names are listened for, and
 *   `context.progression.enemyDied(entity)` is the plain door if none of them
 *   fits. A run with no enemies still levels — `experience.gain` still works.
 * - **The weapons lane** is handed picks by Kitten Upgrades, off `context`.
 * - **The kitten** is whatever is called `you`, then whatever type is `kitten`,
 *   then whoever the camera follows.
 *
 * What it puts on `context` for the other lanes:
 *
 *   context.progression.stats()   { damage, area, cooldown, speed, pickupRadius, maxHealth }
 *   the kitten's properties       damageScale, areaScale, cooldownScale — all seeded at 1
 */

/**
 * The curve. Five points for the first level, then five more each time up to
 * level twenty, then a flatter climb.
 *
 * A gem is worth one, so the first level-up is five kills and arrives in the
 * first few seconds — which is the whole reason the first minute of a survivor
 * feels generous. By level twenty a level is twenty kills, and the run has
 * turned into a defence of what you already built.
 */
const CURVE = level => (level <= 20 ? 5 * level : 100 + (level - 20) * 12)

/** What a gem looks like at each worth. Blue is one kill, red is a boss's worth. */
const GEM_TIERS = [
  { from: 25, tint: '#ff6b8a', size: 0.34 },
  { from: 5, tint: '#8ee6a0', size: 0.27 },
  { from: 0, tint: '#5ec8ff', size: 0.22 }
]

/** How far the kitten reaches for a gem before any upgrade widens it. */
const PICKUP_RADIUS = 2.2

/** Death is announced under several names. Any of them is a kill. */
const DEATH_EVENTS = ['enemy:died', 'enemy:killed', 'entity:died', 'damage:died', 'damage:killed']

/** The live wiring, published so the declared systems reach this world's own. */
export const progression = { tick: null }

export default {
  name: 'Kitten Progression',
  needs: ['Experience', 'Pickups', 'Choice Screen', 'Run Clock', 'Modifiers', 'Kitten Upgrades'],
  about: 'Gems from the dead, a bar that fills, and a level-up that stops the world.',
  inspect: context => [{
    title: 'This run',
    rows: [
      ['level', String(context.experience?.level ?? 1)],
      ['kills', String(context.progression?.kills ?? 0)],
      ['clock', context.run?.clock ?? '0:00']
    ]
  }],

  onLoad(context) {
    let kills = 0

    /**
     * The kitten. Looked up fresh every time and checked against the world, so
     * nothing here can end up acting on an entity from the last run.
     */
    function kitten() {
      const named = context.world.byId('you')
      if (named) return named
      const first = context.world.all('kitten')[0]
      if (first) return first
      const followed = context.camera?.target
      return followed && context.world.entities.includes(followed) ? followed : null
    }

    /**
     * The three multipliers and the pickup radius have to exist before an
     * upgrade multiplies them. Modifiers takes whatever it finds as the base,
     * and a scale whose base is zero stays zero however many times you take it.
     */
    function seed(entity) {
      if (!entity) return
      const properties = entity.properties
      properties.damageScale ??= 1
      properties.areaScale ??= 1
      properties.cooldownScale ??= 1
      properties.pickupRadius ??= PICKUP_RADIUS
    }

    /** What every other lane should read instead of guessing at upgrades. */
    function stats() {
      const properties = kitten()?.properties || {}
      return {
        damage: properties.damageScale ?? 1,
        area: properties.areaScale ?? 1,
        cooldown: properties.cooldownScale ?? 1,
        speed: properties.speed ?? 0,
        pickupRadius: properties.pickupRadius ?? PICKUP_RADIUS,
        maxHealth: properties.maxHealth ?? 0,
        health: properties.health ?? 0
      }
    }

    /** A gem worth `value`, where the thing died. Bigger and redder as it is worth more. */
    function dropGem(at, value = 1) {
      const tier = GEM_TIERS.find(t => value >= t.from) || GEM_TIERS[GEM_TIERS.length - 1]
      if (!context.pickups) return null
      return context.pickups.drop(
        'xp-gem',
        // Lifted off the floor, or the gem sits inside the grass and cannot be seen.
        [at[0] ?? 0, (at[1] ?? 0) + 0.3, at[2] ?? 0],
        { pickup: 'experience', value },
        { mesh: { box: [tier.size, tier.size, tier.size], tint: tier.tint } }
      )
    }

    /**
     * Something the kitten killed. One kill, one gem, worth whatever the thing
     * declared it was worth.
     */
    function enemyDied(entity) {
      if (!entity) return null
      kills++
      const worth = Number(entity.properties?.experience) || 1
      return dropGem([entity.x, entity.y, entity.z], worth)
    }

    // Every shape a death might be announced in, reduced to an entity.
    const asEntity = payload => {
      if (!payload) return null
      if (payload.id && payload.properties) return payload
      return payload.entity || payload.victim || payload.target || null
    }
    for (const name of DEATH_EVENTS) context.bus.on(name, payload => enemyDied(asEntity(payload)))

    // A gem is worth points. This is the one line that says so, and it is the
    // reason Pickups never has to know what "experience" means.
    context.bus.on('pickup:collected', ({ kind, value }) => {
      if (kind === 'experience') context.experience?.gain(value, 'gem')
    })

    /**
     * A level is a choice. Three cards, and the world stops until one is taken.
     * Levels queue inside Choice Screen, so three at once is three choices.
     */
    context.bus.on('experience:levelled', ({ level }) => {
      context.choiceScreen?.offer({
        title: 'LEVEL UP',
        subtitle: `Level ${level}`,
        options: context.kittenUpgrades.offer(3),
        onPick: option => context.kittenUpgrades.apply(option.id, kitten())
      })
    })

    // Health is capped by a bigger belly, and Modifiers may have just raised it.
    context.bus.on('modifiers:changed', ({ entity }) => {
      if (!entity?.properties) return
      const most = entity.properties.maxHealth
      if (most != null && entity.properties.health > most) entity.properties.health = most
    })

    // The run ends when the kitten does, and a card offered to a dead kitten is
    // a world held still with nobody left to answer.
    context.run?.watch(kitten)
    context.run?.report('kills', () => kills)
    context.run?.report('level', () => context.experience.level)
    context.run?.report('carried', () => context.kittenUpgrades.taken().map(entry => `${entry.name} ${entry.rank}`))
    context.bus.on('run:ended', () => context.choiceScreen?.cancel())

    context.progression = {
      stats,
      dropGem,
      enemyDied,
      kitten,
      get kills() { return kills },
      get level() { return context.experience.level }
    }

    // Curve and collector are set once the world exists, and again on every
    // level load, because a fresh level clears both.
    function arm() {
      kills = 0
      context.experience?.configure({ curve: CURVE, maxLevel: 99 })
      if (context.pickups) context.pickups.collector = kitten
      seed(kitten())
      context.world.state.kills = 0
    }
    arm()
    context.bus.on('level:loaded', arm)

    /**
     * R plays again once the run is over.
     *
     * Reloading the level is the whole restart: it clears the world, resets the
     * clock and the random stream, and every plugin here empties itself on
     * `level:loaded`. Nothing else has to be undone by hand.
     */
    context.input?.bind('kittenRestart', ['KeyR'])
    const spent = new Set()
    context.bus.on('step:end', () => spent.clear())

    progression.tick = () => {
      context.world.state.kills = kills
      if (!context.run?.over) return
      if (!context.input?.pressed('kittenRestart') || spent.has('restart')) return
      spent.add('restart')
      // Loading is asynchronous and this is a fixed step, so the failure has to
      // be caught here — an unhandled rejection would be a restart that silently
      // did nothing.
      context.editor.loadLevel(context.level())
        .catch(error => console.error('[kitten-progression] could not restart the level', error))
    }
  },

  systems: [{
    // Fixed, because restarting is a change to the game.
    phase: 'fixed',
    run: () => progression.tick?.()
  }],

  commands: [
    {
      id: 'kitten.progress',
      label: 'Level, kills and clock',
      run: context => ({
        level: context.experience.level,
        experience: `${context.experience.intoLevel}/${context.experience.needed}`,
        kills: context.progression.kills,
        clock: context.run?.clock ?? '0:00',
        carried: context.kittenUpgrades.taken(),
        stats: context.progression.stats()
      })
    },
    {
      id: 'kitten.drop',
      label: 'Drop a gem on the kitten, worth n',
      // args: how much it is worth. For trying the magnet without an enemy.
      run: (context, args) => {
        const worth = Number([].concat(args ?? [])[0] ?? 1)
        const you = context.progression.kitten()
        const at = you ? [you.x + 3, you.y, you.z] : [3, 0.3, 0]
        return { id: context.progression.dropGem(at, worth).id, worth }
      }
    }
  ]
}
