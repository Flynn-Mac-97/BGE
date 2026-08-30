/**
 * Every static piece the arena is built from: a wall, a landmark, a clump.
 *
 * Everything the arena draws is this one type, and its shape comes entirely from
 * the placement. A landmark is not a different KIND of thing from a wall, it is
 * a different size and a different colour, and inventing a type per silhouette
 * would put a dozen near-identical files in the project to say what a dozen
 * lines of level JSON already say.
 *
 * THREE CLASSES, and a player learns the rules of the space from their shapes.
 * tools/make-kitten-survivors-meadow.mjs builds them and fails its own build if
 * a placement leaves its class:
 *
 *   WALL — the boundary, and the only thing that blocks. 1.2 m, hard-edged,
 *   axis-aligned, unbroken, one cold colour. Nothing else in the level is over
 *   0.5 m and nothing else is cold.
 *
 *   LANDMARK — a place the player can name. Right-angled in plan, three to four
 *   metres across, one warm dark colour. The camera looks almost straight down,
 *   so a landmark's plan is its silhouette.
 *
 *   DECORATION — everything else, and it says nothing. Under 0.22 m, small,
 *   blobby, and held in the ground's own hue and value.
 *
 * What the type carries is the art language, in one place, so that no placement
 * has to remember it:
 *
 *   toon, four steps, a pale rim outline. Chunky and banded, because the screen
 *   will be full of enemies and a surface with a smooth gradient on it is a
 *   surface the eye keeps checking. Four bands and it is read once and dismissed.
 *
 * The keyline is PALE and THIN. `detail-stays-cheap` caps edgeDensity at 0.045
 * for the whole frame, and every outlined prop spends some of it. It separates
 * one dark prop from another; what separates a prop from the FLOOR is the value
 * gap, which is over four tenths for the two classes that carry meaning.
 *
 * VALUE. Wall and landmark sit between 0.10 and 0.26 luminance, decoration
 * within 0.10 of the floor's 0.674. The horde holds saturated mid value and the
 * cat holds 0.92, so the arena's dark classes cannot be mistaken for an enemy
 * and its light class cannot be mistaken for the cat. The dark classes are also
 * the only dark thing in the picture, which is where `real-tonal-range` gets its
 * value.spread from.
 *
 * NO COLLIDER. Scenery does not stop anything by default — an entity is only in
 * the 3D physics world when its `collider.box` has three numbers, so leaving it
 * off is what keeps a hundred clumps out of the collision grid. The four wall
 * sides declare `collider` and `properties: { body: 'solid' }`, and nothing else
 * does. In a survivor every solid thing inside the arena is somewhere the crowd
 * can pin you, so the arena has none.
 */
export default {
  about: 'wall, landmark or decoration — every static piece the arena is built from',
  appearance: 'Chunky banded boxes with a pale rim. A tall cold wall at the boundary, warm dark right-angled landmarks a few metres across, low green clumps in the ground\'s own colour. None of it ever moves.',
  looksWrongWhen: 'a prop is among the largest things in frame and marked like a creature — a placement has the wrong size',

  mesh: {
    // A placement always says its own size; this is what a placement that forgot
    // draws, and a 1 m cube in the wrong place is meant to be noticed.
    box: [1, 1, 1],
    material: 'toon',
    steps: 4,
    outline: 0.08,
    outlineColour: '#fffaf0'
  }

  // NO `tint` HERE, AND THAT IS THE WHOLE NOTE. A placement's `mesh` merges into
  // the type's key by key, so a default tint is not a fallback — it multiplies
  // into every textured placement that did not think to override it, and the
  // only way out is to write `tint: '#ffffff'` on all of them. An untextured
  // placement that names no tint gets the engine's stable per-type colour
  // instead, which is visible and obviously unfinished.
}
