/**
 * Kitten Hit Feel — how hard this game punches, in one table.
 *
 * The engine already knows how to flash a thing white, throw a number off it,
 * freeze the world and shake the picture. What it cannot know is how much of
 * each a kitten's claw is worth, because that is not a capability, it is taste.
 *
 * So every one of those decisions is here, in one file, keyed off the two
 * events Health announces. Tuning the whole feel of the game — heavier kills,
 * less screen shake, a longer freeze on the big weapon — is editing this table
 * and nothing else.
 *
 * It also owns where a damage number stands, because a number that is not on
 * the body it counts says nothing about that body.
 *
 * It owns the punch, not the look: what a hit or a death is made of is Kitten
 * Effects. It is a separate plugin from Kitten Weapons for the same reason — a
 * weapon knows what it does, and this knows what that ought to feel like.
 */

/** How big a hit each source counts as, from zero to one. See Impact. */
const WEIGHT = {
  'claw dart': 0.24,
  'yarn ball': 0.2,
  'purr wave': 0.34,
  hairball: 0.42,
  'hairball burst': 0.85
}

/** What a hit is worth when nothing named it — contact damage, a fall, a script. */
const UNNAMED = 0.2

/** A kill is always felt more than the hit that caused it. */
const KILL = 0.62

/** Who the game is about. A hit on the kitten is felt differently to a hit by it. */
const PLAYER = 'you'

/**
 * How a damage number behaves, for this camera and this crowd.
 *
 * A number must never outsize the thing it counts. A rat is 0.32 m tall and the
 * kitten is 0.8 m, so 0.42 m is about half a kitten and reads as a label on a
 * body rather than as a figure of its own — at 1 m it was three rats tall and
 * the brightest thing in the frame.
 *
 * The other three are the crowd: at a hundred hits a second the builtin's
 * 0.85 s life leaves eighty figures in the air at once, which breaks
 * `effects-never-become-fog`. A short life clears the screen, a small rise
 * keeps the number over its owner, and the drift stops two hits in one place
 * stacking into a smear.
 */
const NUMBERS = { size: 0.42, life: 0.5, rise: 0.9, drift: 0.35 }

/**
 * Where a number starts, as a share of the height of the body it counts,
 * measured up from that body's middle. Just over the top of it.
 */
const NUMBER_SITS_AT = 0.62

/** How tall a body is when it declares no box. A rat, this game's floor. */
const A_SMALL_BODY = 0.32

/**
 * What the builtin's own automatic number is turned down to.
 *
 * Damage Numbers throws one off `entity:hurt` itself, 0.4 m above the hit
 * point — a figure for a person-sized actor, and a whole rat above a rat. It
 * calls a `show` held inside its own closure, so the published
 * `damageNumbers.show` cannot intercept it and nothing can move it.
 *
 * What a game can set is `defaults`, and that number takes its size and life
 * from there. A millimetre for a fiftieth of a second draws on no pixel and is
 * gone the next step, and this file shows the real number on the body. Size and
 * life are passed on every call here, so only the automatic one is affected;
 * rise and drift are shared, and both are this game's.
 */
const HIDE_THE_BUILTIN_NUMBER = { size: 0.001, life: 0.02 }

/**
 * A star burst, not blood.
 *
 * Combat Effects fires `blood` by name on every hurt and kill, so a game that
 * wants another look renames it rather than turning the wiring off. Its own
 * counts already scale the two — six dots for a hit, twenty-six for a kill — so
 * only the look is set here, and it is the same look Kitten Effects gives a
 * death: small, fully saturated, gone quickly, never a cloud and never a dark
 * stain. The builtin recipe is dark red, falls hard and lives long, which is a
 * wound in a shooter and fog in a crowd of a hundred.
 */
const STAR = {
  blend: 'add', colour: ['#ffd400', '#ffffff', '#ff9500'],
  life: [0.1, 0.22], size: [0.05, 0.09], gravity: -6, drag: 1.5
}

/**
 * The hairball burst, this game's biggest hit. Same vocabulary, bigger and
 * hotter — no smoke tone, because grey is the dark stain the direction forbids.
 */
const BURST = { blend: 'add', colour: ['#ff6a00', '#ffb000', '#ffffff'] }

export default {
  name: 'Kitten Hit Feel',
  about: 'How much every hit in this game shakes, freezes and sounds — one table, so the feel is tuned in one place.',
  needs: ['Impact', 'Health', 'Damage Numbers'],

  inspect: context => [{
    title: 'Hit Feel',
    rows: [
      ...Object.entries(WEIGHT).map(([name, weight]) => [name, weight]),
      ['impacts so far', context.impact?.state().hits ?? 0]
    ]
  }],

  onLoad(context) {
    context.particles?.define('blood', STAR)
    context.particles?.define('explosion', BURST)

    // Rise and drift are read straight off `defaults`; size and life are passed
    // per number, so the automatic one can be turned down without turning down
    // the one this file shows.
    if (context.damageNumbers) {
      Object.assign(context.damageNumbers.defaults, NUMBERS, HIDE_THE_BUILTIN_NUMBER)
    }

    context.bus.on('entity:hurt', event => {
      if (!(event.dealt > 0)) return
      const hurtingYou = event.entity?.id === PLAYER
      showTheNumberOnTheBody(context, event)

      context.impact.hit({
        // Being hit yourself is always the loudest thing on screen. A survivor
        // is read at a glance across a screen of forty enemies, and the one
        // thing you must never miss is your own health going down.
        weight: hurtingYou ? 0.7 : (WEIGHT[event.source] ?? UNNAMED) * (event.critical ? 1.6 : 1),
        at: event.point,
        sound: hurtingYou ? 'hurt' : 'hit'
      })
    })

    context.bus.on('entity:killed', event => {
      const you = event.entity?.id === PLAYER
      context.impact.hit({
        weight: you ? 1 : KILL,
        at: event.point,
        sound: you ? 'down' : 'squeak'
      })
    })
  },

  commands: [{
    id: 'kitten.feel',
    label: 'How hard each source hits',
    run: context => ({
      weights: { ...WEIGHT },
      unnamed: UNNAMED,
      kill: KILL,
      numbers: { ...NUMBERS },
      /** Every number in the air, and how far each is from the body it counts. */
      anchored: (context.damageNumbers?.rising() || []).map(number => ({
        text: number.text,
        at: number.at,
        offBody: nearestBody(context, number.at)
      })),
      impact: context.impact?.state()
    })
  }]
}

/** How tall a body is, by whichever box it declares. */
function heightOf(entity) {
  return Number(entity?.collider?.box?.[1]) || Number(entity?.mesh?.box?.[1]) || A_SMALL_BODY
}

/**
 * One number, on the body it counts.
 *
 * A figure standing away from what it measures says nothing about it, so this
 * takes the victim's own position rather than the hit point: a claw dart lands
 * at the height it flew, which for a crow is under the bird and for a rat is
 * over it.
 */
function showTheNumberOnTheBody(context, event) {
  const victim = event.entity
  if (!context.damageNumbers || !victim) return
  context.damageNumbers.show({
    at: { x: victim.x, y: victim.y + heightOf(victim) * NUMBER_SITS_AT, z: victim.z },
    text: event.dealt,
    critical: event.critical,
    size: NUMBERS.size,
    life: NUMBERS.life
  })
}

/** Metres from a number to the middle of the nearest body that can be hurt. */
function nearestBody(context, at) {
  let nearest = null
  for (const entity of context.world.entities) {
    if (!entity.damageable) continue
    const away = Math.hypot(entity.x - at[0], entity.y - at[1], entity.z - at[2])
    if (nearest === null || away < nearest) nearest = away
  }
  return nearest === null ? null : Math.round(nearest * 100) / 100
}
