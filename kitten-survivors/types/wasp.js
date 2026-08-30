/**
 * Wasp — the one that will not be dodged.
 *
 * The fastest thing in the game and the smallest, so by the time the player
 * unlocks it the answer has to be firepower rather than footwork. It weaves
 * hard on the way in, which is what stops a swarm of them from being a
 * straight line the player can simply step out of.
 *
 * Its outline says A NEEDLE: 0.61 m from nose to sting against 0.12 m across,
 * five times as long as it is wide where nothing else in the game passes two,
 * and the wings stay inside that line so it never reads as a small crow. That
 * is the one thing no other family's outline says.
 *
 * Saturated amber with two fat black bands, mass 0.45 luminance — the
 * brightest family, because the wasp is the smallest thing on the field and
 * the one that must not be missed. The amber stops at 0.45: the lit ground
 * reads 0.68 and the cat's ginger marks 0.61, and the wasp stays under both.
 * The bands hold the dark end, and the near-black keyline reads on the amber.
 *
 * Still the most saturated hue in the horde.
 *
 * Two bands, not six — six is a pattern, and art/world/bible.md spends no
 * detail on pattern.
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
  appearance: 'A hot amber needle five times as long as it is wide, black-banded, with a straight pale sting out the back, flying higher than a crow. It weaves rather than arriving in a straight line.',
  looksWrongWhen: 'it is a plain tinted box — models/wasp.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  // The abdomen and sting overshoot the hull: the hull is what a weapon hits,
  // the length is the shape that is read.
  mesh: { model: 'models/wasp.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#ad6a10' },
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
