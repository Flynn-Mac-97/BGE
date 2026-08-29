/**
 * Wasp — the one that will not be dodged.
 *
 * The fastest thing in the game and the smallest, so by the time the player
 * unlocks it the answer has to be firepower rather than footwork. It weaves
 * hard on the way in, which is what stops a swarm of them from being a
 * straight line the player can simply step out of.
 *
 * Tiny, bright yellow and above head height: the only thing on the meadow
 * higher than a crow, and the only warm colour in the horde. Both cues exist so
 * a wasp is visible against a screen already full of dark bodies.
 */
const WIDTH = 0.24
const HEIGHT = 0.22
const LENGTH = 0.44

export default {
  mesh: { box: [WIDTH, HEIGHT, LENGTH], tint: '#e6b032' },
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
  }
}
