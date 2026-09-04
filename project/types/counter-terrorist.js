/**
 * A counter-terrorist: the body, and nothing about who is driving it.
 *
 * `terrorist.js` with the other side's team, pistol and colour. Kept as its own
 * file rather than as one type with a side flag, because a flag would have to
 * be read on every line that ever mattered, and "what is a counter-terrorist"
 * should be answerable by opening one short file.
 */

/**
 * Counter-Strike's player hull, converted at 1 Half-Life unit = 0.0254 m:
 * 32 x 72 x 32 units standing. Width first, then height, then depth. Ducking
 * halves the height, and `counter-strike-movement` owns that.
 */
const WIDTH = 0.81
const STANDING_HEIGHT = 1.83

/** Said once for the whole type rather than once per body. Ten of these is a wall of text. */
let saidNoWeapons = false

export default {
  about: 'one CT-side body. terrorist.js with the other team, pistol and colour; a driver attaches on top',
  appearance: 'A human figure a little under two metres, tinted blue. Until the GLB loads it draws as a plain box.',
  looksWrongWhen: 'it floats above the floor or sinks into it — the model stands on its origin and needs `anchor: feet`.',

  mesh: {
    model: 'counter-strike/models/counter-terrorist.glb',
    // The GLB stands on the floor with its origin between its feet, which is
    // where an artist can put an origin repeatably. The entity's y is its centre,
    // so the renderer has to be told the difference or the body floats.
    anchor: 'feet',
    // The box is the fallback the renderer draws until a model loader is there
    // to read the GLB, and the collider's own size is exactly the right
    // stand-in: wrong in every detail, right in every dimension that decides
    // whether a shot at a shoulder connects.
    box: [WIDTH, STANDING_HEIGHT, WIDTH],
    tint: '#4d6f9c'
  },

  collider: { box: [WIDTH, STANDING_HEIGHT, WIDTH] },

  /**
   * The same two clips the terrorist plays: both models carry the same node
   * names, so one retarget serves both sides.
   */
  rig: {
    clips: {
      idle: 'motion/idle.json',
      walk: 'motion/walk.json',
      run: 'motion/run.json',
      crouchIdle: 'motion/crouch-idle.json',
      crouchWalk: 'motion/crouch-walk.json',
      jump: 'motion/jump.json',
      death: 'motion/death.json'
    },
    default: 'idle',
    rootMotion: false
  },

  // Order is the order they run in. Movement first, so anything reading
  // velocity or `crouched` afterwards sees this step's answer rather than last
  // step's — and chooses-motion-clip reads all of them, so it runs last.
  behaviours: ['counter-strike-movement', 'carries-weapons', 'damageable', 'chooses-motion-clip'],

  properties: {
    body: 'dynamic',
    // Spelled out. The HUD may print CT on a scoreboard; code never does.
    team: 'counter-terrorist',
    // The USP is what a counter-terrorist starts a round holding.
    startingPistol: 'usp'
  },

  start(entity, context) {
    const weapons = context.weapons
    if (!weapons?.give) {
      // Silence is the enemy, and an unarmed counter-terrorist looks exactly
      // like an armed one until somebody pulls a trigger.
      if (!saidNoWeapons) {
        saidNoWeapons = true
        console.error('[counter-terrorist] context.weapons.give is not there, so every counter-terrorist starts empty-handed. project/plugins/weapons.js is what contributes it.')
      }
      return
    }
    weapons.give(entity, entity.properties.startingPistol)
  }
}
