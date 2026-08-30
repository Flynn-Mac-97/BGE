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
 */
const WIDTH = 0.8
const HEIGHT = 0.65
const LENGTH = 1.3

export default {
  about: 'the charging enemy, and the only one whose attack the player can read coming and dodge',
  appearance: 'A broad, heavy, rust-red quadruped. It stops, winds up, then crosses ground fast in a straight line — the pause before the run is the tell.',
  looksWrongWhen: 'it is a plain tinted box — models/boar.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  mesh: { model: 'models/boar.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#8a4226' },
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
  }
}
