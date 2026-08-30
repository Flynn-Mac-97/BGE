/**
 * Hound — the one that soaks hits.
 *
 * Slow enough to walk away from and too tough to clear, so a hound is a wall
 * that follows you. Its job is to make the player's route matter: a screen with
 * six hounds in it has corridors in it, and the rats pour through the gaps.
 *
 * Its outline says DAYLIGHT UNDERNEATH: the body is carried 0.48 m clear of the
 * ground on four thin legs set wide apart, so the shape has holes in it and the
 * bright meadow shows through. It is also the tallest thing in the game at
 * 1.08 m, more than twice the cat. Every other family is a solid mass on the
 * floor, so that gap is the one thing no other family's outline says.
 *
 * Saturated slate blue, mass 0.35 luminance, coat 0.39, and the only blue
 * family — the crow is the other cool one and it is violet. The horde carries
 * mid value and the near-black keyline does the separating: a near-black line
 * on a near-black body separates nothing. The muzzle, legs and paws stay
 * near-black, so the gap under the belly is the strongest contrast on screen.
 *
 * It is drawn from `models/hound.glb`, which keeps four legs named
 * `legFrontLeft` through `legBackRight` with their origin at the hip, so
 * `applyPose` in engine/render.js drives the lope below unchanged.
 */
const WIDTH = 0.95
const HEIGHT = 0.85
const LENGTH = 1.5

/**
 * The lope: radians of leg swing per metre travelled, and how far.
 *
 * Slow and long. A hound that stepped like a rat would stop reading as heavy,
 * and heavy is the only thing this enemy has to say.
 */
const STRIDE_PER_METRE = 5
const STRIDE_SWING = 0.5

export default {
  about: 'the enemy that soaks hits. Too slow to threaten alone; it blocks routes and makes corridors',
  appearance: 'The tallest enemy, in saturated slate blue, on four long thin dark legs with a clear gap of meadow under its belly, a scalloped mane behind the head and a dark muzzle. The only blue family.',
  looksWrongWhen: 'it is a plain tinted box — models/hound.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  // The model stands 1.08 m and overshoots the hull: the hull is what a weapon
  // hits, the height is the shape that is read.
  mesh: { model: 'models/hound.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#46679f' },
  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'trigger',
    family: 'hound',

    /** Slower than a rat. A hound is never the thing that catches you; it is the thing in the way. */
    speed: 1.55,

    health: 90,
    maxHealth: 90,

    /** Wide, so a pack of hounds cannot merge into one shape. */
    radius: 0.7,

    hover: 0,

    /** Almost none. A hound walking dead straight is what makes it read as heavy. */
    wander: 0.04,

    contactDamage: 18,
    bounty: 5
  },

  update(entity, seconds) {
    lope(entity, seconds)
  }
}

/**
 * The lope: diagonal legs swing together, so one sine wave drives all four.
 *
 * The phase is kept on the entity and advanced by the step rather than read
 * off the clock, so a change of pace never snaps a leg, and it starts from the
 * id so a pack does not march in time.
 */
function lope(entity, seconds) {
  if (!Number.isFinite(entity.gaitPhase)) entity.gaitPhase = phaseFromId(entity.id)
  entity.gaitPhase += seconds * STRIDE_PER_METRE * (entity.properties.speed || 0)

  const swing = Math.sin(entity.gaitPhase) * STRIDE_SWING
  entity.pose = {
    legFrontLeft: swing,
    legBackRight: swing,
    legFrontRight: -swing,
    legBackLeft: -swing
  }
}

/** A fixed angle from an id, so a replay steps the same hound the same way. */
function phaseFromId(id) {
  let total = 0
  for (let index = 0; index < id.length; index += 1) {
    total = (total * 31 + id.charCodeAt(index)) % 997
  }
  return (total / 997) * Math.PI * 2
}
