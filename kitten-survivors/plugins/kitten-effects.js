/**
 * Kitten Effects — what this game's moments look like, in particles.
 *
 * The engine's Particles plugin owns the machinery and Combat Effects fires
 * the generic hurt-and-kill dust (recoloured to fur by Kitten Hit Feel's
 * defines). This file owns the four looks that make a run readable at a
 * glance: the spark a weapon hit throws, the puff an enemy dies into, the
 * sparkle on experience gems, and the burst a level-up earns.
 *
 * Every number here is this game's taste, in tables at the top so the whole
 * look is tuned in one place — none of it belongs in a builtin.
 */

/**
 * The glint each weapon's hit throws, keyed the way damage names its source.
 *
 * Full saturation and a white draw in every entry: the meadow is a bright day
 * at low saturation on purpose (kitten-survivors/art/world/bible.md), so a
 * pastel spark now sits inside the ground's own colour range instead of
 * standing off it. Full chroma plus white is the one combination lit grass
 * never produces — see kitten-survivors/art/effects/bible.md.
 */
const HIT_SPARKS = {
  'claw dart': { colour: ['#ffb000', '#ffffff'], count: 4 },
  'yarn ball': { colour: ['#ff0080', '#ffffff'], count: 5 },
  'purr wave': { colour: ['#0080ff', '#ffffff'], count: 3 },
  // Hue-matched to the hairball projectile's own tint (kitten-weapons.js),
  // pushed from a muddy tan to the same colour at full saturation.
  hairball: { colour: ['#8a2a0a', '#ffffff'], count: 5 },
  'hairball burst': { colour: ['#ff2200', '#ffcc00', '#ffffff'], count: 9 }
}

/** A hit nothing named — contact, a script — still glints, just faintly. */
const UNNAMED_SPARK = { colour: ['#ffffff'], count: 2 }

// size 0.05: the derived floor is 0.3 m across for the whole glint, but a
// single spark dot under about 20 px on a phone is a pixel nobody can read.
const SPARK = { speed: [2, 4.5], life: [0.08, 0.2], size: 0.05, blend: 'add', drag: 1, gravity: -6 }

/** A death is a soft puff of fur that browns as it thins — never gore. */
const DEATH_PUFF = {
  count: 12, speed: [0.5, 1.6], life: [0.35, 0.65], size: [0.12, 0.22],
  grow: 0.5, colour: ['#f6e2c8', '#d8b98f', '#b9946a'], fadeTo: '#8d7a5f',
  gravity: 1.2, drag: 2.5
}

// Hue-matched to the gem's own mesh tint (#5ec8ff in types/xp-gem.js), pushed
// to full saturation for the same reason as the hit sparks.
/** The lazy glint a gem gives off while it lies there — money on the floor. */
const GEM_IDLE = { count: 1, speed: 0.25, life: 0.45, size: 0.05, blend: 'add', colour: ['#00abff', '#ffffff'] }

/** Seconds between idle glints, shared by the whole field of gems. */
const GEM_IDLE_EVERY = 0.35

/** The tail a gem streams once it has latched on and is flying to you. */
const GEM_TRAIL = { rate: 22, speed: 0.2, life: 0.3, size: 0.035, blend: 'add', colour: ['#00abff', '#ffffff'] }

/** The pop when a gem lands in the kitten. */
const GEM_TAKEN = { count: 6, direction: { x: 0, y: 1, z: 0 }, spread: 0.7, speed: [1, 2.2], life: 0.25, size: 0.04, blend: 'add', colour: ['#00abff', '#ffffff'] }

/** A level-up is the loudest good news on screen: a gold fountain and a halo. */
const LEVEL_FOUNTAIN = {
  count: 90, direction: { x: 0, y: 1, z: 0 }, spread: 0.9, speed: [3, 7],
  life: [0.5, 0.9], size: [0.05, 0.12], blend: 'add',
  colour: ['#ffb800', '#ffefb0', '#ffffff'], gravity: -7, drag: 0.6
}
// blend 'add': a halo is light around the kitten, not a solid ring — it must
// glow on top of the grass, not sit tinted underneath it.
const LEVEL_HALO = {
  count: 18, speed: 1.4, life: 0.6, size: 0.2, grow: 1.4, blend: 'add',
  colour: '#ffc700', fadeTo: '#c98a2a', drag: 2
}

/** Who the run is about — where a level-up burst belongs. */
const PLAYER = 'you'

let engine = null
let idleCarry = 0

const isGem = entity => entity?.properties?.pickup === 'experience'

/** A burst at an entity, lifted a little so it reads off the body, not the feet. */
const over = (entity, lift = 0.25) => ({ x: entity.x, y: entity.y + lift, z: entity.z })

function levelUpAt(context) {
  const kitten = context.world.byId(PLAYER) || context.camera?.target
  if (!kitten) return null
  context.particles.burst({ at: over(kitten, 0.2), ...LEVEL_FOUNTAIN })
  context.particles.burst({ at: over(kitten, 0.5), ...LEVEL_HALO })
  return over(kitten, 0.2)
}

export default {
  name: 'Kitten Effects',
  about: 'This game\'s particle looks: hit sparks per weapon, fur puffs on death, gem sparkle, and the level-up burst.',
  needs: ['Particles'],

  inspect: () => [{
    title: 'Looks',
    rows: [
      ...Object.entries(HIT_SPARKS).map(([name, spark]) => [name, `${spark.count} sparks`]),
      ['death puff', `${DEATH_PUFF.count} motes of fur`],
      ['level-up', `${LEVEL_FOUNTAIN.count + LEVEL_HALO.count} gold`]
    ]
  }],

  onLoad(context) {
    engine = context

    // A weapon landing is a glint in that weapon's colour, so a crowded
    // screen still says which of your weapons is doing the work.
    context.bus.on('weapon:hit', event => {
      if (!(event?.dealt > 0) || !event.point) return
      const spark = HIT_SPARKS[event.weapon] ?? UNNAMED_SPARK
      context.particles.burst({
        at: event.point,
        ...(event.normal ? { direction: event.normal, spread: 0.9 } : {}),
        ...SPARK, ...spark
      })
    })

    // Horde announces a death before the body goes, with where it stood.
    context.bus.on('enemy:died', event => {
      if (!event?.at) return
      context.particles.burst({ at: { ...event.at, y: event.at.y + 0.3 }, ...DEATH_PUFF })
    })

    // The moment a gem latches it streams a tail all the way in. The trail
    // stops itself when the gem is collected and destroyed.
    context.bus.on('pickup:latched', event => {
      if (isGem(event?.entity)) context.particles.trail(event.entity, GEM_TRAIL)
    })

    context.bus.on('pickup:collected', event => {
      if (event?.kind === 'experience' && event.entity) {
        context.particles.burst({ at: over(event.entity, 0.1), ...GEM_TAKEN })
      }
    })

    context.bus.on('experience:levelled', () => levelUpAt(context))
  },

  systems: [
    {
      // Idle gem sparkle on the fixed clock: every beat, one gem — picked by
      // the engine's seeded random, so a replay glints the same — gives off a
      // mote. One at a time keeps a floor of two hundred gems from becoming
      // two hundred emitters.
      phase: 'fixed',
      run(world, seconds) {
        if (!engine) return
        idleCarry += seconds
        while (idleCarry >= GEM_IDLE_EVERY) {
          idleCarry -= GEM_IDLE_EVERY
          const gems = world.entities.filter(isGem)
          if (!gems.length) continue
          const gem = engine.random.pick(gems)
          engine.particles.burst({ at: over(gem, 0.15), ...GEM_IDLE })
        }
      }
    }
  ],

  commands: [
    {
      id: 'kitten.effects.preview',
      label: 'Fire one of each look at the kitten',
      run: context => {
        const at = levelUpAt(context)
        if (!at) return { fired: false, why: `no "${PLAYER}" in this level` }
        context.particles.burst({ at, ...SPARK, ...HIT_SPARKS['claw dart'] })
        context.particles.burst({ at, ...DEATH_PUFF })
        context.particles.burst({ at, ...GEM_TAKEN })
        return { fired: true, at, state: context.particles.state }
      }
    }
  ]
}
