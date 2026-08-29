/**
 * Hound — the one that soaks hits.
 *
 * Slow enough to walk away from and too tough to clear, so a hound is a wall
 * that follows you. Its job is to make the player's route matter: a screen with
 * six hounds in it has corridors in it, and the rats pour through the gaps.
 *
 * Big, wide and cold grey. Size is the only silhouette cue that survives a
 * screen with three hundred things on it, so the hound is simply larger than
 * everything else by a clear margin rather than by a subtle one.
 *
 * The grey is a mid value rather than the near-black it wants to be. Crows are
 * the dark family, and on a meadow lit only by ambient light two dark families
 * are one family — the hound has to sit clearly above the crow in value or the
 * size difference is all the player has left to read.
 */
const WIDTH = 0.95
const HEIGHT = 0.85
const LENGTH = 1.5

export default {
  mesh: { box: [WIDTH, HEIGHT, LENGTH], tint: '#7d8794' },
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
  }
}
