/**
 * The keyboard and mouse, turned into the fields a body moves by.
 *
 * This is the only file in the movement lane that knows a human is present.
 * It reads the bound actions and writes plain fields — wishForward, wishStrafe,
 * wishJump, wishCrouch, wishWalk, wishUse and aimYaw — and then it is done.
 * `counter-strike-movement` picks those up and turns them into velocity without
 * ever asking where they came from, and `bot-brain` writes exactly the same
 * fields with no input at all.
 *
 * That split is the point. A bot and a human move identically because there is
 * one movement model and this is merely one of two things that can drive it.
 * If a bot ever gets a private path into movement, a human and a bot are
 * playing two different games and neither can be balanced against the other.
 *
 * Attach it to the one body the person at the keyboard is driving — from the
 * level placement, or from whatever hands out bodies at the start of a round.
 * It is deliberately not on the terrorist and counter-terrorist types, because
 * nine of every ten bodies in a round are not being driven by anybody.
 *
 * List it BEFORE `counter-strike-movement` where you can. Hooks run in the
 * order they are written, so reading the keyboard first means the key you press
 * this step moves you this step. A behaviour a placement adds always sorts after
 * the ones its type declared, so attaching it that way costs one fixed step —
 * 16 ms — of input latency, which is small but is exactly the kind of thing a
 * Counter-Strike player feels without being able to name.
 */

/**
 * Every action this reads, in one list, because the edge detection below needs
 * to sample all of them once a step and comparing a whole bag is cheaper to
 * read than fourteen separate flags.
 */
const WATCHED = [
  'forward', 'back', 'strafeLeft', 'strafeRight', 'jump', 'crouch', 'walk',
  'attack', 'attack2', 'reload', 'use', 'drop',
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5'
]

const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5']

const RADIANS_TO_DEGREES = 180 / Math.PI

/**
 * Say a missing neighbour once and then be quiet.
 *
 * Silence is the enemy, but this runs sixty times a second, and a lane that is
 * still being written would otherwise bury every other line in the log.
 */
const alreadySaid = new Set()
function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[player-controlled] ${message}`)
}

export default {
  about: 'read the bound actions and write the wish fields the movement model runs on',

  properties: {},

  start(entity, context, self) {
    self.buttonsHeldLastStep = {}
    if (!context.input) {
      report('input', `there is no context.input, so ${entity.id} cannot be driven by anybody. Keyboard Input is the plugin that contributes it.`)
    }
    if (!context.camera) {
      report('camera', `there is no context.camera, so ${entity.id} will walk toward -Z whatever it is looking at. Game Camera is the plugin that contributes it.`)
    }
  },

  update(entity, seconds, context, self) {
    const input = context.input
    if (!input) return

    // Edges are worked out here rather than read from input.pressed(), because
    // `pressed` is cleared once a FRAME while this runs once a fixed STEP, and
    // one frame can carry five steps — a semi-automatic pistol would fire five
    // times for one click. The bag is where a behaviour keeps its state, so
    // last step's buttons live there and cost nothing.
    const was = self.buttonsHeldLastStep || {}
    const now = {}
    for (const action of WATCHED) now[action] = input.held(action) === true
    self.buttonsHeldLastStep = now
    const tapped = action => now[action] === true && was[action] !== true

    // ------------------------------------------------------------- movement
    entity.wishForward = (now.forward ? 1 : 0) - (now.back ? 1 : 0)
    entity.wishStrafe = (now.strafeRight ? 1 : 0) - (now.strafeLeft ? 1 : 0)
    entity.wishJump = now.jump
    entity.wishCrouch = now.crouch
    entity.wishWalk = now.walk

    // Held rather than tapped: planting and defusing are both a hold, and a
    // door only cares that the key is down.
    //
    // Written under both names on purpose. `plugins/match-rules.js` reads
    // `useHeld`, which is what plants and defuses the bomb; `behaviours/
    // bot-brain.js` writes `wishUse`, which is the name that matches the other
    // five wishes. They are one fact, and until those two lanes agree on a name
    // a human writes both rather than working under only half of them.
    entity.wishUse = now.use
    entity.useHeld = now.use

    // Where the body faces. The camera publishes this as a yaw and as the
    // forward()/right() basis built from that yaw; the one number is what
    // crosses to the movement model, because a bot has no camera and has to be
    // able to write the same field.
    //
    // aim(), not view.yaw: aim() is where the shot goes, with the recoil punch
    // counted once and the screen shake left out. Steering off view.yaw would
    // let a muzzle climb walk the player sideways.
    const aim = context.camera?.aim?.()
    if (aim && Number.isFinite(aim.yaw)) {
      entity.aimYaw = aim.yaw
      // The renderer turns a 3D mesh about Y, in degrees. Without this line the
      // body model faces one direction for the whole match while its owner
      // spins on the spot.
      entity.rotation = aim.yaw * RADIANS_TO_DEGREES
    }

    // -------------------------------------------------------------- the buy
    // Deliberately not handled here. `plugins/buy-menu.js` reads the `buy`
    // action itself and announces itself on the bus as `buy-menu:opened`,
    // which is right: opening a menu is a thing that happens to the screen,
    // not to the body. Two places reacting to one key is how a menu ends up
    // opening and closing in the same step.

    // ------------------------------------------------------------- weapons
    const weapons = context.weapons
    if (!weapons) {
      if (now.attack || now.reload || now.drop) {
        report('weapons', 'there is no context.weapons, so the trigger, the reload and the drop key do nothing. project/plugins/weapons.js is what contributes it.')
      }
      return
    }

    // A plain field read, which is how two behaviours are allowed to agree:
    // carries-weapons owns the bag and everything else reads `current` out of it.
    const held = weapons.get?.(entity.carriesWeapons?.current)

    // Automatic weapons fire while the trigger is down; everything else needs
    // the trigger released between shots. A weapon nothing can describe is
    // treated as semi-automatic on purpose — a rifle that will not empty itself
    // is a smaller failure than a pistol that does.
    if (held?.automatic === true ? now.attack : tapped('attack')) weapons.fire?.(entity)

    if (tapped('attack2')) {
      if (weapons.secondary) weapons.secondary(entity)
      else report('secondary', 'attack2 has nothing to call — context.weapons.secondary(entity) is not on the weapons surface, so the silencer, the scope and the burst have no key.')
    }

    if (tapped('reload')) weapons.reload?.(entity)
    if (tapped('drop')) weapons.drop?.(entity)

    // The buy menu takes the number keys for its own categories while it is
    // open, and says so on context. Without this a 3 would buy a rifle and draw
    // a knife in the same step, which is the exact failure buy-menu.js warns
    // about — and it is the reason that plugin publishes `isOpen` at all.
    if (context.buyMenu?.isOpen === true) return

    for (let slot = 0; slot < SLOTS.length; slot++) {
      if (tapped(SLOTS[slot])) weapons.select?.(entity, slot + 1)
    }
  }
}
