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
 * and nothing else. Spread across four fire hooks, the same tuning would be
 * four edits and the numbers would drift apart within a week.
 *
 * It is a separate plugin from Kitten Weapons for the same reason: a weapon
 * knows what it does, and this knows what that ought to feel like.
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
    // Dust and a puff of fur rather than blood. The builtin hit wiring fires
    // `blood` by name on every hurt and kill, so a game that wants another look
    // renames the colours instead of turning the wiring off.
    context.particles?.define('blood', { colour: ['#f6e2c8', '#d8b98f', '#b9946a'] })
    context.particles?.define('explosion', { colour: ['#ffe08a', '#f0b26b', '#c9c9c9', '#8d8d8d'] })

    // The play camera sits fourteen metres back and sees about thirteen metres
    // of ground top to bottom, so the builtin's half-metre default number is six
    // percent of the screen — set once here, every number follows, including the
    // automatic ones the builtin throws itself.
    if (context.damageNumbers) context.damageNumbers.defaults.size = 1

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
      if (event.entity?.id === PLAYER) {
        context.impact.hit({ weight: 1, at: event.point, sound: 'down' })
        return
      }
      context.impact.hit({ weight: KILL, at: event.point, sound: 'squeak' })
      // A last puff where it stood, so a death is a thing that happened rather
      // than a thing that stopped being drawn.
      context.particles?.effect('sparks', {
        at: { x: event.entity.x, y: event.entity.y + 0.25, z: event.entity.z },
        count: 14
      })
    })
  },

  commands: [{
    id: 'kitten.feel',
    label: 'How hard each source hits',
    run: context => ({ weights: { ...WEIGHT }, unnamed: UNNAMED, kill: KILL, impact: context.impact?.state() })
  }]
}
