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
 * It is drawn from `models/kitten.glb`, a lowpoly Blender model. The renderer
 * swings a named node of a model exactly as it swings a named part — see
 * `applyPose` in `engine/render.js` — so the model keeps the four legs as
 * separate nodes named `legFrontLeft` through `legBackRight`, each with its
 * origin at the hip, and the run cycle below drives them unchanged. The nose
 * points at -Z, which is the direction the camera faces at yaw 0, so
 * `entity.yaw` turns the body the right way round.
 *
 * The proportions are a character's, not an animal's: the head is wider than
 * the ribs and nearly half the standing height, and the legs are short stubs.
 * At a few percent of a phone screen a correctly proportioned cat is a smudge,
 * and only the head-to-body ratio survives.
 *
 * The model is drawn twice the size it is authored at — see GROWTH. Fixing the
 * rest of the gap between what the cat measures and what the art bible asks for
 * needs a more upright model, not more scale: this camera is near plan, so
 * length buys screen area and no height at all.
 */

/**
 * How much bigger than the file the cat is drawn.
 *
 * The player must be found first in a frame holding a hundred enemies, and the
 * measure that decides it is standing height against the tallest thing the
 * arena repeats. Inside the fence that is 0.5 m, reached by three families —
 * 562 tufts, 367 bushes, 176 rocks. Doubled, the cat stands at 0.90 m: 1.8
 * times the tallest common prop, and above the largest enemy, the hound at
 * 0.85. The player is the biggest single body on the field and the hound is
 * the only thing near it.
 *
 * The renderer multiplies a model by `mesh.scale`, so this grows the drawing,
 * the keyline and the contact shadow together. The three sizes below restate
 * the result: `mesh.box` beside a model is what the scene queries measure and
 * what places a feet anchor, and `collider.box` is what the horde's contact
 * test reads its reach from. All four numbers must agree, or the cat is bitten
 * at a range it does not look like it has.
 *
 * `art/world/bible.md` still says the cat is 0.8 m long and 0.45 m tall and
 * that every other size is read against it. Nothing else moved, so that ruling
 * is now wrong and needs rewriting in `art/world/rulings.json`.
 */
const GROWTH = 2

/** The size the GLB is authored at, in metres: width, height, length. */
const AUTHORED = [0.5, 0.45, 0.8]

/** The size it really stands at: the hull it collides with, and the box queries measure. */
const [WIDTH, HEIGHT, LENGTH] = AUTHORED.map(metres => metres * GROWTH)

/** Centre height of a cat standing on the meadow, which is one flat slab topped at y = 0. */
const STANDING_Y = HEIGHT / 2

/**
 * A ginger-and-white kitten. The colours are painted into the model's materials
 * by `agent-runs/creatures/blender/make-kitten.py`, which builds the model and
 * is the file to edit to change it.
 *
 * Its outline says A HOOK: the tail runs back out of the rump, rises, and
 * curls hard to one side, so from above the cat is a compact body with a thick
 * J behind it. That is the one thing no other family's outline says. The hook
 * is in the ground plane rather than in height, because this camera is close
 * to plan and a purely vertical tail foreshortens to nothing.
 *
 * It is the only BRIGHT family. The play frame runs a median of 0.72 luminance
 * and the five enemy families are held under 0.38, so the top surfaces of the
 * cat — back, head and the whole upper tail — are 0.92 white and it is the one
 * thing on screen above the ground. Ginger is kept for the ears, the legs, the
 * flanks and the base of the tail, which this camera sees edge-on.
 *
 * There are no tabby bars. Five bands across the back is surface pattern,
 * which art/world/bible.md forbids, and at phone size it reads as noise.
 *
 * This constant only paints the stand-in box while the model file loads, so it
 * is the mass colour, not the marks.
 */
const FUR = '#f4e8d5'

/**
 * The player's own hue, carried on the keyline. Nothing else in the game may
 * use it.
 *
 * The cat's fur comes out of the GLB's materials and cannot be reserved: cream
 * and ginger are what the meadow and half the horde are already made of. The
 * keyline can, because the renderer takes a colour per type and draws it at a
 * constant screen width, so it holds at any distance and over any background.
 *
 * Violet is the one band with nothing in it. The meadow and the horde hold the
 * warm hues, the gems and the hounds the cyans and blues, the ground and the
 * mid-worth gems the greens, and damage the reds. It is also the complement of
 * the meadow's yellow-green, so it separates against the floor at any value.
 *
 * Dark on purpose — 0.12 luminance against a floor at 0.46 to 0.70 and a cat at
 * 0.92. A keyline separates by value first; the hue is what names whose it is.
 *
 * 3 px against the engine's 2.2 px default. The line grows the silhouette by a
 * fixed number of pixels whatever the frame size, so it costs most on the
 * cat's thinnest features: at 4 px the ear tips close to solid violet on a
 * 540-wide frame, and at 3 they keep their ginger.
 */
const PLAYER_HUE = '#7b2fe0'
const PLAYER_KEYLINE = 3

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
  about: 'the player. Steered on the ground plane; weapons fire themselves, so movement is the input',
  appearance: 'A white-backed ginger kitten with a head wider than its body, ginger ears and legs and a thick white tail hooking out behind it, outlined in violet. The tallest and brightest thing on the meadow.',
  looksWrongWhen: 'it is no taller than the props around it, which means the model is drawn at the size its file was authored at, or it is off the centre of the frame, which means the camera lost its target',

  mesh: {
    // The model is authored feet-on-origin, the only origin an artist can put
    // back in the same place twice, so `anchor` drops it by half the hull.
    // The box is what stands in while the file loads, and the tint paints it
    // fur-coloured so the wait never flashes a grey cube. The stand-in is drawn
    // inside the scaled holder, so for the moment before the GLB arrives it is
    // GROWTH times the box.
    model: 'models/kitten.glb',
    anchor: 'feet',
    box: [WIDTH, HEIGHT, LENGTH],
    scale: GROWTH,
    tint: FUR,
    keyline: PLAYER_KEYLINE,
    keylineColour: PLAYER_HUE
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

    // A collider is centred on `y`, so a body on the meadow stands at half its
    // own height. A level writes that number by hand against the height the
    // type had when the placement was made, so the type has to hold the floor
    // itself: a body that starts inside a solid is thrown clear of it. Only
    // ever lifted, so a level that puts the cat higher on purpose keeps it.
    entity.y = Math.max(entity.y, STANDING_Y)
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
