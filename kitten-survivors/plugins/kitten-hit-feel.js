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
 * The play camera is 14 m back at 50 degrees, so it sees about 13 m of ground
 * top to bottom and a 1 m figure is the eight percent of frame height the
 * builtin asks for. The other three are the crowd: at a hundred hits a second
 * the builtin's 0.85 s life leaves eighty figures in the air at once, which
 * breaks `effects-never-become-fog`. A shorter life and a faster rise clear the
 * screen; more drift stops two hits in one place stacking into a smear.
 */
const NUMBERS = { size: 1, life: 0.55, rise: 2.6, drift: 1.1 }

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
  needs: ['Impact', 'Health'],

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

    // Set once, and every number follows — including the ones the builtin
    // throws itself off `entity:hurt`.
    if (context.damageNumbers) Object.assign(context.damageNumbers.defaults, NUMBERS)

    context.bus.on('entity:hurt', event => {
      if (!(event.dealt > 0)) return
      const hurtingYou = event.entity?.id === PLAYER

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
      impact: context.impact?.state()
    })
  }]
}
