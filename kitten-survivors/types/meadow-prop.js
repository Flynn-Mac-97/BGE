/**
 * A piece of the meadow: a tuft, a rock, a fence post, a barn wall.
 *
 * Everything the arena is built from is this one type, and its shape comes
 * entirely from the placement. That is the same choice `project/types/brush.js`
 * makes for de_dust2 and it is the right one here for the same reason: a rock is
 * not a different KIND of thing from a fence post, it is a different size and a
 * different surface, and inventing a type per silhouette would put forty
 * near-identical files in the project to say what forty lines of level JSON
 * already say.
 *
 * What the type does carry is the art language, in one place, so that no
 * placement has to remember it:
 *
 *   toon, four steps, a light rim outline. Chunky and banded, because the screen
 *   will be full of enemies and a surface with a smooth gradient on it is a
 *   surface the eye keeps checking. Four bands and it is read once and dismissed.
 *
 * NO COLLIDER. Scenery does not stop anything by default — an entity is only in
 * the 3D physics world when its `collider.box` has three numbers, so leaving it
 * off is what keeps two hundred tufts out of the collision grid. A placement
 * that really is a wall declares `collider` and `properties: { body: 'solid' }`,
 * and the meadow does that for four hedge lines and nothing else. In a survivor
 * every solid thing inside the arena is somewhere the crowd can pin you, so the
 * meadow has none.
 */
export default {
  mesh: {
    // A placement always says its own size; this is what a placement that forgot
    // draws, and a 1 m cube in the wrong place is meant to be noticed.
    box: [1, 1, 1],
    material: 'toon',
    steps: 4,
    outline: 0.22
  }

  // NO `tint` HERE, AND THAT IS THE WHOLE NOTE. A placement's `mesh` merges into
  // the type's key by key, so a default tint is not a fallback — it multiplies
  // into every textured placement that did not think to override it, and the
  // only way out is to write `tint: '#ffffff'` on all five hundred of them. A
  // fallback purple put here cost an hour: every texture in the meadow drew
  // through it and the arena came back as a violet night nobody had asked for.
  // An untextured placement that names no tint gets the engine's stable
  // per-type colour instead, which is visible and obviously unfinished.
}
