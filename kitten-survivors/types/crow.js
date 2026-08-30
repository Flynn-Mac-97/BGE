/**
 * Crow — the swarmer. Fast, brittle, and never alone.
 *
 * A crow costs almost nothing to kill and arrives twenty at a time from one
 * bearing, so the threat is the shape of the flock rather than any bird in it.
 * That is the reason it flies: a flock at chest height reads as a separate
 * layer from the rats on the floor, and the player can see both at once in a
 * screen that is otherwise solid with bodies.
 *
 * One wide swept arrowhead: two long wings, a round head between them, and a
 * hot orange beak. The wings span 0.68 m against a 0.28 m hull, so the
 * silhouette is the opposite of a rat in every dimension, which is what makes
 * the two tellable apart at a glance.
 *
 * Blue-black, and the darkest family. The hound gave up its near-black so a
 * dark shape on the meadow means one thing. The beak is the only saturated
 * mark on it, and it is what makes a near-black shape findable at all.
 *
 * It is drawn from `models/crow.glb`, which keeps two wings named `wingLeft`
 * and `wingRight` with their origin at the shoulder. `applyPose` in
 * engine/render.js turns a named node about its local X, and the wings are
 * swept well back so that turn reads as a flap: the further back the tip, the
 * further it rises and falls.
 */
const WIDTH = 0.28
const HEIGHT = 0.5
const LENGTH = 0.34

/**
 * The wingbeat, in radians a second and radians of swing.
 *
 * A fixed rate, unlike the walkers' — a bird beats its wings at its own pace
 * whatever its ground speed.
 */
const BEAT_RATE = 16
const BEAT_SWING = 0.5

export default {
  about: 'the swarming enemy. Arrives in flocks from one bearing, so the threat is the flock, not a bird',
  appearance: 'A blue-black bird with long swept-back wings and a hot orange beak, flying at chest height. It reads as a layer above the enemies on the floor, and it is the darkest family on the meadow.',
  looksWrongWhen: 'it is a plain tinted box — models/crow.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  // The spread wings overshoot the hull on purpose: the hull is what a weapon
  // hits, the wings are what says "bird" from a camera looking down.
  mesh: { model: 'models/crow.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#3d4674' },
  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'trigger',
    family: 'crow',

    /** Faster than the kitten, so a flock cannot be outrun — only steered around. */
    speed: 5.4,

    health: 6,
    maxHealth: 6,
    radius: 0.24,

    /** Chest height on the kitten. High enough to be a second layer, low enough to feel present. */
    hover: 0.55,

    /** A wide wobble: a flock should look like birds, not like arrows. */
    wander: 0.55,

    contactDamage: 4,
    bounty: 1
  },

  update(entity, seconds) {
    flap(entity, seconds)
  }
}

/**
 * The wingbeat.
 *
 * Both wings take the SAME angle. The renderer turns each about its own local
 * X, which is the same world axis for both, so one angle lifts both tips
 * together; opposite angles would raise one wing and drop the other.
 *
 * The phase starts from the id, or a flock of twenty beats as one wing and
 * reads as a single machine rather than as birds.
 */
function flap(entity, seconds) {
  if (!Number.isFinite(entity.gaitPhase)) entity.gaitPhase = phaseFromId(entity.id)
  entity.gaitPhase += seconds * BEAT_RATE

  const swing = Math.sin(entity.gaitPhase) * BEAT_SWING
  entity.pose = { wingLeft: swing, wingRight: swing }
}

/** A fixed angle from an id, so a replay beats the same crow the same way. */
function phaseFromId(id) {
  let total = 0
  for (let index = 0; index < id.length; index += 1) {
    total = (total * 31 + id.charCodeAt(index)) % 997
  }
  return (total / 997) * Math.PI * 2
}
