/**
 * A terrorist: the body, and nothing about who is driving it.
 *
 * The same file serves the person at the keyboard, a bot, and the nine bodies
 * standing in a warmup doing nothing at all. What differs between them is only
 * whether `player-controlled` or `bot-brain` is attached on top, which is why
 * neither of them is in the list below — nine of every ten bodies in a round
 * are not being driven by a human, and a type is what a thing IS.
 *
 * `counter-terrorist.js` is this file with a different team, a different
 * pistol and a different colour, and that is deliberate: two short files that
 * each say what one side is beat one file with a flag in it, because the flag
 * would have to be read on every line that mattered.
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
  about: 'one T-side body. The same file serves a human, a bot or an idle body; a driver attaches on top',
  appearance: 'A human figure a little under two metres, tinted sand-brown. Until the GLB loads it draws as a plain box.',
  looksWrongWhen: 'it floats above the floor or sinks into it — the model stands on its origin and needs `anchor: feet`.',

  mesh: {
    model: 'counter-strike/models/terrorist.glb',
    // The GLB stands on the floor with its origin between its feet, which is
    // where an artist can put an origin repeatably. The entity's y is its centre,
    // so the renderer has to be told the difference or the body floats.
    anchor: 'feet',
    // The box is the fallback the renderer draws until a model loader is there
    // to read the GLB, and the collider's own size is exactly the right
    // stand-in: wrong in every detail, right in every dimension that decides
    // whether a shot at a shoulder connects.
    box: [WIDTH, STANDING_HEIGHT, WIDTH],
    tint: '#9c7b4a'
  },

  collider: { box: [WIDTH, STANDING_HEIGHT, WIDTH] },

  /**
   * Two captured clips, played by Rig Animation onto the GLB's named nodes.
   *
   * Generated from text with `tools/make-rig-clip.mjs` and retargeted through
   * `assets/motion/soma-to-terrorist.json`, which drops the captured Hips: its
   * rotation carries the captured body's facing, and `entity.yaw` decides
   * facing here. `rootMotion` stays off for the same reason — the body is moved
   * by counter-strike-movement, not by the clip.
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
    // Spelled out. The HUD may print T on a scoreboard; code never does.
    team: 'terrorist',
    // A terrorist buys out of a Glock. Here rather than in the weapons table
    // because it is a fact about this side, not about the pistol.
    startingPistol: 'glock18'
  },

  start(entity, context) {
    const weapons = context.weapons
    if (!weapons?.give) {
      // Silence is the enemy, and an unarmed terrorist looks exactly like an
      // armed one until somebody pulls a trigger.
      if (!saidNoWeapons) {
        saidNoWeapons = true
        console.error('[terrorist] context.weapons.give is not there, so every terrorist starts empty-handed. project/plugins/weapons.js is what contributes it.')
      }
      return
    }
    weapons.give(entity, entity.properties.startingPistol)
  }
}
