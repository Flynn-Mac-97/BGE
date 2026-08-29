/**
 * The kitten you play. Small, quick, and always running from something.
 *
 * Movement is top-down on the ground plane: the keys steer X and Z, and Y is
 * left to gravity. That is the whole of the control scheme in a survivor — you
 * steer, and the weapons fire themselves — so the only thing this file has to
 * get right is how the steering FEELS. Four rules, and every one of them is a
 * thing Vampire Survivors does:
 *
 *   Instant. Velocity is the input, with no ramp up and no ramp down. A
 *   survivor is played by threading gaps a body's width wide, and any
 *   acceleration at all turns that into a guess.
 *
 *   No slide. Let go and the kitten stops on the spot. A decay would read as
 *   ice, and ice is what kills you in a game about standing in the right pixel.
 *
 *   A diagonal is not faster. Otherwise the whole game is played at 45 degrees.
 *
 *   The body faces where it runs, and turns the short way round over about a
 *   twentieth of a second. Snapping the facing makes a change of direction a
 *   flicker; anything slower reads as the kitten skidding.
 *
 * It is drawn as eighteen boxes rather than a cube, because a lowpoly cat IS a
 * handful of boxes and the engine takes them directly — see `mesh.parts` in
 * `engine/render.js`. The nose points at -Z, which is the direction the camera
 * faces at yaw 0, so `entity.yaw` turns the body the right way round.
 */

/** The hull it collides with: an upright box round the animal, not round the art. */
const WIDTH = 0.5
const HEIGHT = 0.45
const LENGTH = 0.8

/**
 * A ginger tabby, in six colours.
 *
 * The camera looks down, so the markings that matter are the ones on TOP: the
 * stripes across the back, a face a shade lighter than the body, and a pale tip
 * on the tail. From nine metres back and looking down they are most of what you
 * see of the kitten, and without them it is one brown lump.
 */
const FUR = '#e8a55c'
const FACE = '#f2b878'
const CREAM = '#f7e3c0'
const STRIPE = '#c47d3a'
const DARK = '#2a2430'
const PINK = '#e88a94'

/** How long the body takes to come round to a new heading, in seconds. */
const TURN_EASE = 0.05

/**
 * The run cycle: a trot, which is what a cat at speed actually does.
 *
 * Diagonal legs swing together — front left with back right — so one sine wave
 * drives all four, half of them negated. The swing fades in and out rather than
 * switching, because a leg caught mid-stride when the player lets go would
 * otherwise snap straight, and a snap at the exact moment the kitten stops is
 * the frame a player is looking at.
 */
const STRIDE_RATE = 13      // radians of sine per second, about four strides a second
const STRIDE_SWING = 0.55   // radians at a full run
const STRIDE_EASE = 0.06    // in and out over about a fifth of a second

export default {
  mesh: {
    tint: FUR,
    // Positions are metres from the entity's centre, so the feet sit at half
    // the hull height below zero and everything is built up from there.
    parts: [
      // Four legs, tucked in under the body. Named, because named parts are the
      // ones `entity.pose` can swing — see the run cycle in update().
      { name: 'legFrontLeft', box: [0.10, 0.16, 0.10], at: [-0.13, -0.145, -0.20] },
      { name: 'legFrontRight', box: [0.10, 0.16, 0.10], at: [0.13, -0.145, -0.20] },
      { name: 'legBackLeft', box: [0.10, 0.16, 0.10], at: [-0.13, -0.145, 0.22] },
      { name: 'legBackRight', box: [0.10, 0.16, 0.10], at: [0.13, -0.145, 0.22] },

      { box: [0.42, 0.30, 0.54], at: [0, 0.085, 0.05] },
      { box: [0.26, 0.20, 0.05], at: [0, 0.02, -0.30], tint: CREAM },

      // Three bars across the back. From a camera looking down these are most
      // of what you actually see of the kitten, so they carry the character.
      { box: [0.44, 0.03, 0.055], at: [0, 0.235, -0.10], tint: STRIPE },
      { box: [0.44, 0.03, 0.055], at: [0, 0.235, 0.02], tint: STRIPE },
      { box: [0.44, 0.03, 0.055], at: [0, 0.235, 0.14], tint: STRIPE },

      // The head rides proud of the shoulders rather than level with them. Sunk
      // into the body it read as one lump with ears, which is a bear.
      { box: [0.30, 0.28, 0.26], at: [0, 0.22, -0.31], tint: FACE },
      // Ears, tipped out a little. A cat read from above is two triangles and a
      // tail, and straight-up ears look like a bear's.
      { box: [0.09, 0.12, 0.05], at: [-0.095, 0.42, -0.29], rotation: [0, 0, 14], tint: FACE },
      { box: [0.09, 0.12, 0.05], at: [0.095, 0.42, -0.29], rotation: [0, 0, -14], tint: FACE },

      { box: [0.16, 0.09, 0.06], at: [0, 0.17, -0.45], tint: CREAM },
      { box: [0.05, 0.04, 0.03], at: [0, 0.185, -0.495], tint: PINK },
      { box: [0.06, 0.055, 0.03], at: [-0.075, 0.27, -0.45], tint: DARK },
      { box: [0.06, 0.055, 0.03], at: [0.075, 0.27, -0.45], tint: DARK },

      // The tail, held high off the rump. Rotating about X tips the +Z end
      // upwards, so a steep negative angle is a cat that is pleased with itself.
      // The pale tip is the one part of the kitten that is above everything else
      // in the picture, which makes it the easiest thing to find in a crowd.
      { box: [0.06, 0.06, 0.30], at: [0, 0.29, 0.376], rotation: [-68, 0, 0] },
      { box: [0.07, 0.07, 0.09], at: [0, 0.391, 0.417], rotation: [-68, 0, 0], tint: CREAM }
    ]
  },

  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'dynamic',
    speed: 5,
    health: 100,
    maxHealth: 100
  },

  start(entity) {
    // The level may have turned it with the editor's handle, which is degrees.
    // From here on the facing is `yaw`, in radians, because radians are what
    // every other angle in this engine is in and what the renderer turns a body
    // by while the world is running.
    entity.yaw = (entity.rotation || 0) * Math.PI / 180
  },

  update(entity, seconds, context) {
    // axis('y') is the up/down keys, which on a top-down floor is forward and
    // back along Z. Away from the camera is negative Z.
    const sideways = context.input.axis('x')
    const forward = context.input.axis('y')
    const length = Math.hypot(sideways, forward)

    if (length === 0) {
      entity.velocityX = 0
      entity.velocityZ = 0
      swingLegs(entity, 0, seconds, context)
      return
    }

    const speed = entity.properties.speed
    entity.velocityX = (sideways / length) * speed
    entity.velocityZ = (-forward / length) * speed

    // Where the nose has to point for it to be running nose-first. The camera's
    // forward at a given yaw is (-sin yaw, 0, -cos yaw), so the yaw that faces
    // a velocity is the arc tangent of its negation — get this backwards and the
    // kitten runs everywhere in reverse, which looks like an animation bug.
    const heading = Math.atan2(-entity.velocityX, -entity.velocityZ)
    // Not `entity.yaw` directly: a kitten spawned into a running world has not
    // been through start(), and one NaN here is a body that never draws again.
    const facing = Number.isFinite(entity.yaw) ? entity.yaw : 0
    const turn = wrapAngle(heading - facing)
    entity.yaw = wrapAngle(facing + turn * (1 - Math.exp(-seconds / TURN_EASE)))

    swingLegs(entity, 1, seconds, context)
  }
}

/**
 * Swing the legs, or let them settle.
 *
 * `context.time`, not a wall clock, so a replay runs the same stride on the same
 * frame — the rule every moving thing in this engine follows.
 */
function swingLegs(entity, effort, seconds, context) {
  const eased = Number.isFinite(entity.stride) ? entity.stride : 0
  entity.stride = eased + (effort - eased) * (1 - Math.exp(-seconds / STRIDE_EASE))

  const swing = Math.sin(context.time * STRIDE_RATE) * STRIDE_SWING * entity.stride
  entity.pose = {
    legFrontLeft: swing,
    legBackRight: swing,
    legFrontRight: -swing,
    legBackLeft: -swing
  }
}

/** Into plus or minus PI, so turning one way all game never grows the number. */
function wrapAngle(radians) {
  const shifted = (radians + Math.PI) % (Math.PI * 2)
  return shifted < 0 ? shifted + Math.PI : shifted - Math.PI
}
