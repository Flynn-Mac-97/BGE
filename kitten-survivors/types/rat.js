/**
 * Rat — the shambler, and the floor of the whole game.
 *
 * Slow, weak, and never not there. A rat is what the player learns the rules
 * on: it walks straight at you, it dies to one hit for the first minute, and by
 * the tenth there are two hundred of them. Everything else in the horde is
 * defined against it.
 *
 * Low and long, in the dullest brown on the meadow, so it reads as ground
 * clutter rather than as a threat — which is exactly what it is until there are
 * enough of them.
 */
const WIDTH = 0.42
const HEIGHT = 0.32
const LENGTH = 0.62

export default {
  mesh: { box: [WIDTH, HEIGHT, LENGTH], tint: '#6d5844' },

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
