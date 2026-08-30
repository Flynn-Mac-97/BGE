/**
 * Wasp — the one that will not be dodged.
 *
 * The fastest thing in the game and the smallest, so by the time the player
 * unlocks it the answer has to be firepower rather than footwork. It weaves
 * hard on the way in, which is what stops a swarm of them from being a
 * straight line the player can simply step out of.
 *
 * Tiny, bright yellow and above head height: the only thing on the meadow
 * higher than a crow, and the palest, most saturated colour in the horde. Both
 * cues exist so a wasp is visible against a screen already full of bodies.
 *
 * From directly above it is a yellow oval with two fat black bands, a long
 * pale sting out the back and two pale wings. Two bands, not six — six is a
 * pattern, and art/world/bible.md spends no detail on pattern.
 *
 * It is drawn from `models/wasp.glb`, which keeps two wings named `wingLeft`
 * and `wingRight` with their origin at the root, swept back so the X rotation
 * `applyPose` in engine/render.js applies reads as a buzz at the tip.
 */
const WIDTH = 0.24
const HEIGHT = 0.22
const LENGTH = 0.44

/**
 * The buzz, in radians a second and radians of swing.
 *
 * Fast and shallow. A wide slow wingbeat would read as a bird, and the wasp
 * has to be the one thing on screen that does not move like anything else.
 */
const BEAT_RATE = 40
const BEAT_SWING = 0.22

export default {
  about: 'the fastest enemy. It cannot be outrun, so it is answered with firepower rather than movement',
  appearance: 'The smallest enemy and the only yellow one, black-banded, with a long pale sting, flying higher than a crow. It weaves on the way in rather than approaching in a straight line.',
  looksWrongWhen: 'it is a plain tinted box — models/wasp.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  mesh: { model: 'models/wasp.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#ffc31f' },
  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'trigger',
    family: 'wasp',

    /** Half again as fast as the kitten. Running away from a wasp is not a plan. */
    speed: 6.2,

    health: 9,
    maxHealth: 9,
    radius: 0.2,

    /** Above the crows, so the horde has three readable heights rather than two. */
    hover: 1,

    /** The widest weave in the game — a wasp should never arrive on the line it set out on. */
    wander: 1.15,

    contactDamage: 5,
    bounty: 2
  },

  update(entity, seconds) {
    buzz(entity, seconds)
  }
}

/**
 * The buzz.
 *
 * Both wings take the SAME angle. The renderer turns each about its own local
 * X, which is the same world axis for both, so one angle lifts both tips
 * together; opposite angles would raise one wing and drop the other.
 */
function buzz(entity, seconds) {
  if (!Number.isFinite(entity.gaitPhase)) entity.gaitPhase = phaseFromId(entity.id)
  entity.gaitPhase += seconds * BEAT_RATE

  const swing = Math.sin(entity.gaitPhase) * BEAT_SWING
  entity.pose = { wingLeft: swing, wingRight: swing }
}

/** A fixed angle from an id, so a replay beats the same wasp the same way. */
function phaseFromId(id) {
  let total = 0
  for (let index = 0; index < id.length; index += 1) {
    total = (total * 31 + id.charCodeAt(index)) % 997
  }
  return (total / 997) * Math.PI * 2
}
