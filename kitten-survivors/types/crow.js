/**
 * Crow — the swarmer. Fast, brittle, and never alone.
 *
 * A crow costs almost nothing to kill and arrives twenty at a time from one
 * bearing, so the threat is the shape of the flock rather than any bird in it.
 * That is the reason it flies: a flock at chest height reads as a separate
 * layer from the rats on the floor, and the player can see both at once in a
 * screen that is otherwise solid with bodies.
 *
 * Narrow, tall and nearly black — the opposite silhouette to a rat in every
 * dimension, which is what makes the two tellable apart at a glance. It is the
 * only family allowed to be this dark; the hound gave up its near-black so that
 * a dark shape on the meadow means one thing.
 */
const WIDTH = 0.28
const HEIGHT = 0.5
const LENGTH = 0.34

export default {
  about: 'the swarming enemy. It arrives in flocks from one bearing, so the threat is the shape of the flock rather than any single bird',
  appearance: 'Narrow, tall and near-black, flying at chest height. It reads as a layer above the enemies on the floor, and it is the darkest family on the meadow.',
  looksWrongWhen: 'it is a plain tinted box — models/crow.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  // The spread wings overshoot the hull on purpose: the hull is what a weapon
  // hits, the wings are what says "bird" from a camera looking down.
  mesh: { model: 'models/crow.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#2e2a38' },
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
  }
}
