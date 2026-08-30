/**
 * Kitten Effects — what this game's moments look like, and what may mark its
 * ground.
 *
 * The engine's Particles plugin owns the machinery and Combat Effects fires
 * the generic hurt-and-kill dust (recoloured to fur by Kitten Hit Feel's
 * defines). This file owns the looks that make a run readable at a glance: the
 * spark a weapon hit throws, the pop an enemy dies into, the sparkle on
 * experience gems, and the burst a level-up earns. It also says what is allowed
 * to mark the meadow, because the engine's answer is wrong for this game — see
 * `refuseUntexturedMarks` below.
 *
 * Every number here is this game's taste, in tables at the top so the whole
 * look is tuned in one place — none of it belongs in a builtin.
 *
 * The three measured rulings in `kitten-survivors/art/effects/rulings.json`
 * decide the shape of every table: a hit carries something near white
 * (`value.p95` at least 0.85), effects take full chroma nothing else uses
 * (`saturation.p95` at least 0.88), and effects stay sparse (`edgeDensity` at
 * most 0.09). Sparse is why counts are small and lives are short — a hundred
 * enemies die at once and the frame has to stay readable.
 */

/**
 * The glint each weapon's hit throws, keyed the way damage names its source.
 *
 * Full saturation and a white draw in every entry: the meadow is a bright day
 * at low saturation on purpose (kitten-survivors/art/world/bible.md), so a
 * pastel spark now sits inside the ground's own colour range instead of
 * standing off it. Full chroma plus white is the one combination lit grass
 * never produces.
 */
const HIT_SPARKS = {
  'claw dart': { colour: ['#ffb000', '#ffffff'], count: 4 },
  'yarn ball': { colour: ['#ff0080', '#ffffff'], count: 5 },
  'purr wave': { colour: ['#0080ff', '#ffffff'], count: 3 },
  // Hue-matched to the hairball projectile's own tint (kitten-weapons.js), at
  // full saturation and full value. The tint's own brown is dark, and a dark
  // effect reads as a stain.
  hairball: { colour: ['#ff5a00', '#ffffff'], count: 5 },
  'hairball burst': { colour: ['#ff2200', '#ffcc00', '#ffffff'], count: 9 }
}

/** A hit nothing named — contact, a script — still glints, just faintly. */
const UNNAMED_SPARK = { colour: ['#ffffff'], count: 2 }

// size 0.05: the derived floor is 0.3 m across for the whole glint, and these
// dots travel up to 0.9 m, so the cluster clears it. A single dot any larger
// reads as a blob rather than a spark.
const SPARK = { speed: [2, 4.5], life: [0.08, 0.2], size: 0.05, blend: 'add', drag: 1, gravity: -6 }

/**
 * The white centre of a hit, fired with every spark.
 *
 * The spark colours are picked one per dot, so a three-dot glint can come out
 * with no white in it at all and the frame loses its brightest pixel. This is
 * one particle that is always white, always over the 0.3 m floor, and gone in
 * four frames — the flash the ruling asks for, at a cost of one dot per hit.
 */
const HIT_CORE = { count: 1, speed: 0, life: 0.07, size: 0.32, grow: 1.6, blend: 'add', colour: '#ffffff' }

/**
 * A death is a pop, not a fade.
 *
 * The body is gone the same step it dies — Horde destroys it as soon as its
 * health reaches zero — so every bit of the read is here. Two bursts: a white
 * core that says something happened, and a saturated star burst that says it
 * was worth something.
 *
 * Small, saturated and quick, never a cloud and never a dark stain. That is the
 * whole impact vocabulary of the reference this game is built against
 * (agent-runs/2026-08-31-brawl-stars/reference/what-the-frames-show.md), and it
 * is what `effects-own-full-saturation` and the world bible's guard already ask
 * for. A soft pale puff fails both: it is unsaturated, and a hundred of them at
 * once is fog.
 */
const DEATH_CORE = { count: 1, speed: 0, life: 0.11, size: 0.34, grow: 3.2, blend: 'add', colour: '#ffffff' }

const DEATH_STAR = {
  count: 10, speed: [3, 6.5], life: [0.1, 0.22], size: 0.07, blend: 'add',
  colour: ['#ffd400', '#ffffff', '#ff9500'], gravity: -6, drag: 1.5
}

// Hue-matched to the gem's own mesh tint (#5ec8ff in types/xp-gem.js), pushed
// to full saturation for the same reason as the hit sparks.
/** The lazy glint a gem gives off while it lies there — money on the floor. */
const GEM_IDLE = { count: 1, speed: 0.25, life: 0.45, size: 0.05, blend: 'add', colour: ['#00abff', '#ffffff'] }

/**
 * Seconds between idle glints, shared by the whole field of gems.
 *
 * One gem at a time, so two hundred gems are two hundred glints spread over
 * half a minute rather than two hundred emitters. Fast enough that the field
 * twinkles; slow enough that it never reads as an effect of its own.
 */
const GEM_IDLE_EVERY = 0.18

/** The tail a gem streams once it has latched on and is flying to you. */
const GEM_TRAIL = { rate: 22, speed: 0.2, life: 0.3, size: 0.035, blend: 'add', colour: ['#00abff', '#ffffff'] }

/** The pop when gems land in the kitten. `count` is filled in from how many arrived. */
const GEM_LANDED = { direction: { x: 0, y: 1, z: 0 }, spread: 0.7, speed: [1.4, 3], life: 0.28, size: 0.07, blend: 'add', colour: ['#00abff', '#ffffff'] }

/** Dots in the landing pop for the first gem, and for every one after it. */
const GEM_LANDED_FIRST = 6
const GEM_LANDED_EACH = 2

/** Most dots one landing pop may spend. A stream of forty gems is still one pop. */
const GEM_LANDED_MOST = 26

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

/** Gems taken since the last fixed step, so a stream of them is one pop. */
let landed = 0

/** Marks refused for having no picture, counted so `kitten.marks` can say so. */
let marksRefused = 0

const isGem = entity => entity?.properties?.pickup === 'experience'

/** A burst at an entity, lifted a little so it reads off the body, not the feet. */
const over = (entity, lift = 0.25) => ({ x: entity.x, y: entity.y + lift, z: entity.z })

/**
 * Nothing may mark the meadow without a picture to mark it with.
 *
 * The engine ships no decal art — `particles.art.blood` and `.bulletHole` are
 * empty strings — and an untextured decal draws as a solid tinted quad. Combat
 * Effects places one per hit and one per death regardless, which fills the
 * 300-mark budget with dark squares within a minute of play. Dark squares on a
 * pastel meadow break the world bible's guard, and 300 hard-edged quads break
 * `effects-never-become-fog`.
 *
 * So a mark needs a picture. This game has none, so it puts none down and a
 * kill is read in the burst instead. Give the project a decal image, name it in
 * `context.particles.art`, and marks come back with no change here.
 */
function refuseUntexturedMarks(context) {
  const wall = context.decals
  if (!wall || wall.placeGuardedByKittenEffects) return
  const place = wall.place.bind(wall)
  wall.place = options => {
    if (!options?.texture) { marksRefused++; return null }
    return place(options)
  }
  // The decal wall is one object shared by the whole process, so a second load
  // would wrap the wrapper and count every mark twice.
  wall.placeGuardedByKittenEffects = true
}

function levelUpAt(context) {
  const kitten = context.world.byId(PLAYER) || context.camera?.target
  if (!kitten) return null
  context.particles.burst({ at: over(kitten, 0.2), ...LEVEL_FOUNTAIN })
  context.particles.burst({ at: over(kitten, 0.5), ...LEVEL_HALO })
  return over(kitten, 0.2)
}

/** The whole death, at one point: a white core, then the star burst. */
function deathPop(context, at) {
  const middle = { x: at.x, y: at.y + 0.3, z: at.z }
  context.particles.burst({ at: middle, ...DEATH_CORE })
  context.particles.burst({ at: middle, ...DEATH_STAR })
}

export default {
  name: 'Kitten Effects',
  about: 'This game\'s particle looks — hit sparks per weapon, the death pop, gem sparkle, the level-up burst — and the rule that nothing marks the meadow without a picture.',
  needs: ['Particles'],

  inspect: () => [{
    title: 'Looks',
    rows: [
      ...Object.entries(HIT_SPARKS).map(([name, spark]) => [name, `${spark.count} sparks`]),
      ['death pop', `${DEATH_CORE.count + DEATH_STAR.count} dots`],
      ['level-up', `${LEVEL_FOUNTAIN.count + LEVEL_HALO.count} gold`],
      ['marks refused', marksRefused]
    ]
  }],

  onLoad(context) {
    engine = context
    refuseUntexturedMarks(context)

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
      context.particles.burst({ at: event.point, ...HIT_CORE })
    })

    // Horde announces a death before the body goes, with where it stood.
    context.bus.on('enemy:died', event => {
      if (event?.at) deathPop(context, event.at)
    })

    // The moment a gem latches it streams a tail all the way in. The trail
    // stops itself when the gem is collected and destroyed.
    context.bus.on('pickup:latched', event => {
      if (isGem(event?.entity)) context.particles.trail(event.entity, GEM_TRAIL)
    })

    // Counted here and spent once a step: a screenful of gems arrives as a
    // stream, and one swelling pop reads as a haul where forty identical
    // puffs read as noise.
    context.bus.on('pickup:collected', event => {
      if (event?.kind === 'experience') landed++
    })

    context.bus.on('experience:levelled', () => levelUpAt(context))
    context.bus.on('level:loaded', () => { landed = 0; idleCarry = 0 })
  },

  systems: [
    {
      phase: 'fixed',
      run(world, seconds) {
        if (!engine) return
        spendLandedGems(engine, world)
        glintOneGem(engine, world, seconds)
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
        deathPop(context, at)
        context.particles.burst({ at, ...GEM_LANDED, count: GEM_LANDED_FIRST })
        return { fired: true, at, state: context.particles.state }
      }
    },
    {
      id: 'kitten.marks',
      label: 'What has been allowed to mark the meadow',
      run: context => ({
        refused: marksRefused,
        why: 'a mark with no picture draws as a solid tinted square',
        art: { ...(context.particles?.art || {}) },
        wall: context.decals?.state
      })
    }
  ]
}

/** One pop for every gem that arrived this step, sized by how many. */
function spendLandedGems(context, world) {
  if (!landed) return
  const kitten = world.byId(PLAYER)
  const count = Math.min(GEM_LANDED_FIRST + (landed - 1) * GEM_LANDED_EACH, GEM_LANDED_MOST)
  landed = 0
  if (kitten) context.particles.burst({ at: over(kitten, 0.35), ...GEM_LANDED, count })
}

/**
 * One gem glints per beat, picked by the engine's seeded random so a replay
 * sparkles the same. One at a time keeps a floor of two hundred gems from
 * becoming two hundred emitters.
 */
function glintOneGem(context, world, seconds) {
  idleCarry += seconds
  while (idleCarry >= GEM_IDLE_EVERY) {
    idleCarry -= GEM_IDLE_EVERY
    const gems = world.entities.filter(isGem)
    if (!gems.length) continue
    const gem = context.random.pick(gems)
    context.particles.burst({ at: over(gem, 0.15), ...GEM_IDLE })
  }
}
