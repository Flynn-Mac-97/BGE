/**
 * Rat — the floor of the whole game. Every other enemy is tuned against it, so
 * a change to these numbers is a change to what every other enemy means.
 */
const WIDTH = 0.42
const HEIGHT = 0.32
const LENGTH = 0.62

export default {
  // What a rat IS, for anyone — person or agent — who has to recognise one.
  // `about` is repeated once per marked type in every See sidecar, which is why
  // it is held to 100 characters. None of these may restate a number from
  // `properties` below: the copy is the part that goes stale.
  about: 'the weakest and commonest enemy, and the one every other enemy is measured against',
  appearance: 'A low, long, dull-brown quadruped a third of the kitten tall. Reads as ground clutter rather than as a threat.',
  looksWrongWhen: 'it is a plain tinted box — models/rat.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  mesh: { model: 'models/rat.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#6d5844' },

  // A trigger, not a body: the horde moves itself, and the crowd it moves in
  // would cost more in Physics 3D than everything else in the game put
  // together. The collider is here so a weapon can raycast it and so touching
  // the kitten reports a contact.
  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'trigger',
    family: 'rat',

    /** Metres a second. The kitten runs at 5, so a rat is outrun and never escaped. */
    speed: 1.95,

    health: 10,
    maxHealth: 10,

    /** How much ground it claims in the crowd. Roughly its own half-width. */
    radius: 0.32,

    /** Metres its centre floats above the ground. A rat walks on it. */
    hover: 0,

    /** Radians the heading wobbles by. Just enough that a hundred rats are not one line. */
    wander: 0.14,

    contactDamage: 6,
    bounty: 1
  }
}
