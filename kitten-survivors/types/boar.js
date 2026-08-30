/**
 * Boar — the charger, and the only enemy with a tell.
 *
 * Everything else in the horde walks at the kitten at one speed forever. A boar
 * winds up, waits, and then covers ten metres in a second and a half in a
 * straight line. That single change of pace is what stops the late game being a
 * uniform grey tide: it gives the player something to read and something to
 * dodge, and it punishes standing still in a way a rat never can.
 *
 * The charge itself lives in the Horde plugin, because when a boar decides to
 * run is a rule of this game rather than a property of a box.
 *
 * Broad, long and rust red — heavy like a hound but unmistakably a different
 * colour, because the two of them share a screen and both are large.
 *
 * The body is a wedge: narrow at the rump, widest at the shoulders, with two
 * cream tusks flaring wider still. From directly above it is an arrowhead
 * pointing where the charge will go, which is the tell made visible.
 *
 * It is drawn from `models/boar.glb`, which keeps four legs named
 * `legFrontLeft` through `legBackRight` with their origin at the hip, so
 * `applyPose` in engine/render.js drives the trot below unchanged.
 */
const WIDTH = 0.8
const HEIGHT = 0.65
const LENGTH = 1.3

/**
 * The trot: radians of leg swing per metre travelled, and how far.
 *
 * Per metre, not per second, so the charge speeds the legs up on its own and
 * the change of pace is visible in the gait as well as in the position.
 */
const STRIDE_PER_METRE = 5
const STRIDE_SWING = 0.46

export default {
  about: 'the charging enemy, and the only one whose attack the player can read coming and dodge',
  appearance: 'A broad rust-red wedge, narrow at the rump and widest at the tusks, with a dark head, a pink snout and a ridge of black bristles. It stops, winds up, then crosses ground fast in a straight line.',
  looksWrongWhen: 'it is a plain tinted box — models/boar.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  mesh: { model: 'models/boar.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#cc4b2b' },
  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'trigger',
    family: 'boar',

    /** What it stalks at. The Horde plugin raises this to `chargeSpeed` for the run. */
    speed: 2.1,

    /** Faster than the kitten by a wide margin, for a second and a half at a time. */
    chargeSpeed: 9,

    health: 55,
    maxHealth: 55,
    radius: 0.55,
    hover: 0,

    /** None while charging is the point; the Horde plugin zeroes it for the run. */
    wander: 0.06,

    contactDamage: 22,
    bounty: 4
  },

  update(entity, seconds) {
    trot(entity, seconds)
  }
}

/**
 * The trot: diagonal legs swing together, so one sine wave drives all four.
 *
 * The phase is kept on the entity and advanced by the step rather than read
 * off the clock. That is what lets the charge quadruple the leg rate without
 * snapping a leg to a new angle on the frame the charge starts.
 */
function trot(entity, seconds) {
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

/** A fixed angle from an id, so a replay steps the same boar the same way. */
function phaseFromId(id) {
  let total = 0
  for (let index = 0; index < id.length; index += 1) {
    total = (total * 31 + id.charCodeAt(index)) % 997
  }
  return (total / 997) * Math.PI * 2
}
