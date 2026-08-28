/**
 * The Counter-Strike move, in metres.
 *
 * Quake wrote this arithmetic, Half-Life inherited it, Counter-Strike inherited
 * it from Half-Life, and every player who has ever counter-strafed before a
 * shot or held a strafe key through a jump has been feeling these few lines.
 * This file is that arithmetic and nothing else: it has no idea a keyboard
 * exists.
 *
 * It reads six plain fields off the entity:
 *
 *   entity.wishForward   -1 to 1, back to forward
 *   entity.wishStrafe    -1 to 1, left to right
 *   entity.wishJump      true while a jump is wanted
 *   entity.wishCrouch    true while a duck is wanted
 *   entity.wishWalk      true while walking, which is slower and quiet
 *   entity.aimYaw        radians, the direction the body faces — the same
 *                        convention the camera uses, where yaw 0 faces -Z and
 *                        a positive yaw turns left. `entity.rotation`, in
 *                        degrees, stands in when nobody has aimed yet, which is
 *                        what a spawn point's facing means.
 *
 * plus one more that belongs to the lane next door:
 *
 *   entity.carriesWeapons.moveSpeedFactor
 *                        an AWP walks at 84% of a knife's pace, and that trade
 *                        is the whole reason to hold an angle with one instead
 *                        of pushing with it
 *
 * and writes four back:
 *
 *   entity.velocityX/Y/Z  what Physics 3D moves the body by
 *   entity.crouched       true while ducked; the camera drops the eye on it
 *   entity.moveSpeed      metres a second across the ground, which is what the
 *                         sound lane decides a footstep on
 *   entity.collider.box   halved in height while ducked
 *
 * `player-controlled` writes the wish fields from the bound actions, and
 * `bot-brain` writes exactly the same fields with no input at all. That split
 * is the whole reason a bot and a human move identically: there is one movement
 * model and there is no private way into it. The moment a bot gets its own path
 * the two are playing different games and neither can be balanced.
 *
 * All of it is plain fields because a behaviour may not look up another
 * behaviour. That is the rule that keeps this out of component-graph territory,
 * and it costs nothing here: a number on an entity is a perfectly good contract.
 */

/**
 * How tall a player is when nothing on the entity says otherwise, in metres.
 * Only reached if a body arrives with no collider — the collider is the truth,
 * because the thing that decides how tall you hit should decide how tall you
 * stand.
 */
const STANDING_HEIGHT = 1.83

/** Below this a body is standing still, and pretending otherwise costs a footstep. */
const AT_REST = 0.01

export default {
  about: 'the Quake ground and air move, in metres, driven by wish fields rather than by input',

  /**
   * Counter-Strike's own numbers, converted once at 1 Half-Life unit = 0.0254 m.
   * They are properties rather than constants because this is the tuning
   * surface for how the whole game feels, and a number you can reach in the
   * inspector is a number somebody will actually try changing.
   */
  properties: {
    maximumGroundSpeed: 6.35,   // 250 units — running
    walkSpeed: 3.3,             // 130 units — shift, and quiet
    crouchSpeed: 2.1,           // 83 units — ducked
    groundAcceleration: 5.5,
    groundFriction: 4,
    stopSpeed: 2.54,            // 100 units — see friction() for what this buys
    airAcceleration: 10,
    airWishSpeed: 0.76,         // 30 units — see airMove() for why this is the whole trick
    // 268 units/s, which is sqrt(2 * 800 * 45) — the impulse that gives
    // Counter-Strike's 45 unit (1.14 m) jump. The brief's 5.59 m/s is 220
    // units and clears only 0.77 m, which is under half the height of a
    // de_dust2 crate; a jump that cannot get you where a Counter-Strike player
    // expects to go is the wrong number however faithfully it was converted.
    jumpSpeed: 6.81
  },

  start(entity, context, self) {
    // The collider is the truth about height, and it is measured once here
    // because everything after this point may be looking at a halved one.
    self.standingHeight = heightOf(entity) || STANDING_HEIGHT
    self.jumpWasWished = false

    entity.velocityX = entity.velocityX ?? 0
    entity.velocityY = entity.velocityY ?? 0
    entity.velocityZ = entity.velocityZ ?? 0
    entity.crouched = entity.crouched === true
    entity.moveSpeed = 0

    // Silence is the enemy: without three numbers in the collider box Physics
    // 3D never claims this entity, so every velocity written below is ignored
    // and the only symptom is a body that stands there.
    if (!Array.isArray(entity.collider?.box) || entity.collider.box.length !== 3) {
      console.error(`[counter-strike-movement] ${entity.id} has no three-number collider box, so Physics 3D will not move it and nothing in this behaviour will have any effect.`)
    }
  },

  update(entity, seconds, context, self) {
    // A body that was placed before this behaviour was attached never saw
    // start(), and a standing height of undefined would halve to NaN.
    if (!(self.standingHeight > 0)) self.standingHeight = heightOf(entity) || STANDING_HEIGHT

    duck(entity, context, self)

    const { directionX, directionZ, wishSpeed } = wish(entity, self)

    entity.velocityX = entity.velocityX ?? 0
    entity.velocityZ = entity.velocityZ ?? 0

    // Jumping is decided before friction, and a body that has just left the
    // ground gets none. Counter-Strike skips friction on the frame you jump,
    // and that single detail is what lets a chain of hops keep its speed —
    // apply friction here and bunny-hopping quietly stops working.
    const jumped = entity.grounded === true && wantsToJump(entity, self)
    if (jumped) entity.velocityY = self.jumpSpeed
    self.jumpWasWished = entity.wishJump === true

    if (entity.grounded === true && !jumped) groundMove(entity, self, directionX, directionZ, wishSpeed, seconds)
    else airMove(entity, self, directionX, directionZ, wishSpeed, seconds)

    // The plain field the sound lane reads to decide whether anyone could have
    // heard that. Walking and ducking are quiet because they are slow, which is
    // the same reason they are quiet in Counter-Strike.
    entity.moveSpeed = Math.hypot(entity.velocityX, entity.velocityZ)
  }
}

// ------------------------------------------------------------------ the wish
/**
 * Where the body wants to go, in the world, and how fast it is allowed to.
 *
 * The two wish axes are body-relative and the facing is one number, so a bot
 * with no camera writes exactly what a human writes. The basis rebuilt here is
 * the one `context.camera.forward()` and `.right()` publish — level on purpose,
 * because looking at the floor must not walk you into it.
 */
function wish(entity, self) {
  const yaw = facingOf(entity)
  const forwardX = -Math.sin(yaw)
  const forwardZ = -Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)

  const ahead = clampAxis(entity.wishForward)
  const beside = clampAxis(entity.wishStrafe)

  let directionX = forwardX * ahead + rightX * beside
  let directionZ = forwardZ * ahead + rightZ * beside

  // Normalised, so holding forward and strafe together is not faster than
  // holding one — the diagonal-run bug every first shooter ships with once.
  // A half-pressed wish keeps its half, which is how a bot creeps.
  const length = Math.hypot(directionX, directionZ)
  if (length > 0) {
    directionX /= length
    directionZ /= length
  }

  return { directionX, directionZ, wishSpeed: topSpeed(entity, self) * Math.min(1, length) }
}

/**
 * How fast this body is allowed to go, and what it is carrying while it does.
 *
 * `carries-weapons` keeps `moveSpeedFactor` as a plain number on its bag for
 * exactly this read, because a behaviour cannot look another behaviour up and
 * this one has to know every step. A body with no inventory carries nothing and
 * moves at the knife's pace, which is the pace every factor is measured against.
 */
function topSpeed(entity, self) {
  const base = entity.crouched === true ? self.crouchSpeed
    : entity.wishWalk === true ? self.walkSpeed
      : self.maximumGroundSpeed
  const carrying = entity.carriesWeapons?.moveSpeedFactor
  return base * (Number.isFinite(carrying) && carrying > 0 ? carrying : 1)
}

/** A wish axis is -1 to 1. Anything else is a caller's bug, not a licence to fly. */
const clampAxis = value => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0)

/**
 * Which way the body faces, in radians.
 *
 * `aimYaw` first, because that is what a camera, a bot brain and the weapons
 * lane all write and read. `rotation` second, in degrees, which is what a
 * placement means by "the way this faces" — a body dropped on a spawn point
 * should walk out of it facing the map rather than facing -Z. Exactly the order
 * `plugins/radar.js` resolves a facing in, so the arrow on the radar and the
 * direction the body walks can never disagree.
 */
function facingOf(entity) {
  if (Number.isFinite(entity.aimYaw)) return entity.aimYaw
  if (Number.isFinite(entity.rotation) && entity.rotation !== 0) return entity.rotation * Math.PI / 180
  return 0
}

// --------------------------------------------------------------- the ground
function groundMove(entity, self, directionX, directionZ, wishSpeed, seconds) {
  friction(entity, self, seconds)
  accelerate(entity, directionX, directionZ, wishSpeed, wishSpeed, self.groundAcceleration, seconds)
}

/**
 * Friction, and the stop speed that makes counter-strafing work.
 *
 * Below `stopSpeed` the drop is worked out as though you were moving AT the
 * stop speed, so the last two metres a second come off at a flat rate instead
 * of trailing away exponentially. That is what makes a stop crisp, and crisp
 * stopping is what makes tapping the opposite key before a shot — the whole
 * skill of counter-strafing — worth doing.
 *
 * Only the ground speed is scaled. Half-Life scales all three components, but
 * it has already zeroed the vertical one by the time it gets here, and in this
 * engine Physics 3D owns the fall: scaling velocityY would be this behaviour
 * quietly fighting gravity every step.
 */
function friction(entity, self, seconds) {
  const speed = Math.hypot(entity.velocityX, entity.velocityZ)
  if (speed < AT_REST) {
    entity.velocityX = 0
    entity.velocityZ = 0
    return
  }

  const control = Math.max(speed, self.stopSpeed)
  const remaining = Math.max(0, speed - control * self.groundFriction * seconds)
  const scale = remaining / speed
  entity.velocityX *= scale
  entity.velocityZ *= scale
}

// ------------------------------------------------------------------ the air
/**
 * The famous one.
 *
 * In the air the wish speed you may reach is clamped to about 0.76 m/s — 30
 * units — while the acceleration term keeps the *full* wish speed. So the
 * amount added each step is whatever is left between the clamp and your speed
 * ALONG THE WISH DIRECTION, and that is the entire reason air-strafing and
 * bunny-hopping exist: turn while holding a strafe key and the wish direction
 * stays nearly across your velocity, where the dot product stays near zero, so
 * the clamp never notices the speed you already have and hands you another
 * 0.76 m/s sideways. Sideways plus forwards is faster than forwards.
 *
 * Hold a key in a straight line instead and the dot product is your whole
 * speed, which is far past the clamp, so nothing is added at all.
 *
 * It looks like a bug in every reading. It is thirty years of muscle memory.
 */
function airMove(entity, self, directionX, directionZ, wishSpeed, seconds) {
  accelerate(entity, directionX, directionZ, wishSpeed, Math.min(wishSpeed, self.airWishSpeed), self.airAcceleration, seconds)
}

/**
 * Quake's accelerate, with the two speeds kept apart.
 *
 * `wishSpeed` sizes the step; `reachableSpeed` is the speed past which nothing
 * is added. On the ground they are the same number and this is exactly the
 * textbook function. In the air they differ, and see airMove above for why.
 */
function accelerate(entity, directionX, directionZ, wishSpeed, reachableSpeed, acceleration, seconds) {
  const currentSpeed = entity.velocityX * directionX + entity.velocityZ * directionZ
  const addSpeed = reachableSpeed - currentSpeed
  if (addSpeed <= 0) return

  const accelerationSpeed = Math.min(acceleration * wishSpeed * seconds, addSpeed)
  entity.velocityX += directionX * accelerationSpeed
  entity.velocityZ += directionZ * accelerationSpeed
}

// ----------------------------------------------------------------- the jump
/**
 * A jump is the rising edge of the wish, never the wish itself.
 *
 * Half-Life calls this "don't pogo stick": holding the key down hops once and
 * then stands there, and you must let go to hop again. It is the reason
 * bunny-hopping is a skill in Counter-Strike rather than something that happens
 * to anybody leaning on the space bar.
 */
const wantsToJump = (entity, self) => entity.wishJump === true && self.jumpWasWished !== true

// ---------------------------------------------------------------- the crouch
/**
 * Duck, and refuse to stand up where there is no room.
 *
 * The collider is replaced rather than edited, because it may be the very
 * object the type file declared — ducking one player by editing it in place
 * would duck every player of that type at once.
 *
 * `entity.y` is the centre of the body, so halving the height moves the centre
 * down by a quarter of the standing height and the feet stay exactly where
 * they were. The eye is not touched here: the camera eases it down off
 * `entity.crouched`, which is why the duck reads as a movement rather than as
 * a jump cut.
 */
function duck(entity, context, self) {
  const wants = entity.wishCrouch === true
  const ducked = entity.crouched === true
  if (wants === ducked) return

  const standing = self.standingHeight
  const crouched = standing / 2

  if (wants) {
    resize(entity, crouched)
    entity.crouched = true
    return
  }

  // Asked of the world, not of the player. Standing up under a vent has to
  // fail, and this is the only thing in the file that can tell. Physics 3D
  // contributes canStand; without it there is nothing to ask, and a body that
  // can always stand is a better failure than one that never can.
  if (context.canStand && !context.canStand(entity, standing)) return

  resize(entity, standing)
  entity.crouched = false
}

function resize(entity, height) {
  const box = entity.collider?.box
  if (!Array.isArray(box) || box.length !== 3) return
  const wasHeight = box[1]
  entity.collider = { ...entity.collider, box: [box[0], height, box[2]] }
  entity.y += (height - wasHeight) / 2
}

const heightOf = entity => (Array.isArray(entity.collider?.box) ? entity.collider.box[1] : 0)
