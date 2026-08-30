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
 *   toon, four steps, a pale rim outline. Chunky and banded, because the screen
 *   will be full of enemies and a surface with a smooth gradient on it is a
 *   surface the eye keeps checking. Four bands and it is read once and dismissed.
 *
 * The keyline is PALE, not black, and THIN. `detail-stays-cheap` caps
 * edgeDensity at 0.045 for the whole frame, and every outlined prop spends some
 * of it. This one is baked geometry, so its width shrinks with distance and at
 * play zoom it is under a pixel — it separates a prop from the floor in a close
 * frame and buys nothing at nine metres. At 0.14 across two thousand props the
 * frame measured 0.046; at 0.08 it measures under 0.04 and no prop reads
 * differently. Creatures carry a screen-space keyline of constant width, which
 * is what an outline has to be to survive this camera; this is not that, and it
 * is not worth widening until it is.
 *
 * VALUE. Every placement inside the fence sits between 0.46 and 0.70 luminance,
 * checked by tools/make-kitten-survivors-meadow.mjs against the texture and tint
 * it actually names. The horde holds 0.14 to 0.33 and the cat holds 0.92, so a
 * prop that drifts dark hides a crow and one that drifts bright competes with
 * the cat.
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
  about: 'every static piece the arena is built from. Each placement gives its own size and surface',
  appearance: 'Chunky banded surfaces with a light rim outline, in many sizes. Scenery: it never moves and never reacts, so a shape that stays put across frames is probably one of these.',
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
  // only way out is to write `tint: '#ffffff'` on all five hundred of them. A
  // fallback purple put here cost an hour: every texture in the meadow drew
  // through it and the arena came back as a violet night nobody had asked for.
  // An untextured placement that names no tint gets the engine's stable
  // per-type colour instead, which is visible and obviously unfinished.
}
