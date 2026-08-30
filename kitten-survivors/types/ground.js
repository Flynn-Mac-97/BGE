/**
 * The meadow floor: one slab of grass, sized per placement.
 *
 * The size stays on the placement because an arena is one large slab and a patch
 * of path is a small one, and neither belongs to the type. Three numbers on the
 * collider is what puts it in the 3D physics world.
 *
 * THE TOP OF THIS SLAB IS y = 0 WHEN IT IS PLACED AT y = -HEIGHT/2, and the
 * meadow places it exactly there. Every other number in the level is measured
 * from that plane, so a prop of height h sits at y = h/2 and nobody has to carry
 * an offset around. See kitten-survivors/art/world/bible.md.
 *
 * Toon rather than lambert, four bands, and no outline. Under one directional
 * key light a flat plane of toon shading is one flat value, which is the point:
 * the ground is the quietest surface in the game and everything readable happens
 * on top of it.
 *
 * NO TEXTURE. From nine metres up a tiled texture is a legible repeat whatever
 * its scale — large tiles read as a motif and small ones as grain, and the
 * bible caps edgeDensity at 0.045 either way. The floor is one flat colour, and
 * its variation comes from light, from shadows and from what stands on it. That
 * is what the Brawl Stars frames in agent-runs/2026-08-31-brawl-stars/ do.
 *
 * It carries no painted patches either: a patchwork of floor tints clears
 * value.spread the same way light does and reads as sheets of paper thrown on a
 * lawn. See `ground-reads-as-one-surface` in the bible.
 *
 * The colour is on the PLACEMENT, never here — a tint on a type multiplies into
 * every placement that did not override it.
 */
export default {
  about: 'the meadow floor, one slab per placement. Its top face is the y = 0 plane the level is measured from',
  appearance: 'A single flat slab of one warm green under everything else, with no texture and no outline. The quietest surface on screen, and deliberately so.',
  looksWrongWhen: 'entities float above it or sink into it — the slab is not placed at y = -height/2',

  // The rule the comment above states, in a form `check` reads: the top of
  // this slab (its placed y plus half its own height) must sit on y = 0.
  invariant: { rule: 'topFaceAtY', value: 0, about: 'the top face of the slab sits at y = 0' },

  mesh: {
    box: [40, 1, 40],
    material: 'toon',
    steps: 4
  },
  collider: { box: [40, 1, 40] },
  properties: { body: 'solid' }
}
