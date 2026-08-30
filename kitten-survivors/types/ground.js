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
 * Toon rather than lambert, four bands. Under one directional key light a flat
 * plane of toon shading is one flat value, which is the point: the ground is the
 * quietest surface in the game and everything readable happens on top of it.
 *
 * IT CASTS NO SHADOW AND STILL RECEIVES ONE. A 260 m plane has nothing beneath
 * it, so the only surface its own shadow can reach is itself, and at 1024 shadow
 * texels over a 90 m arena a texel is 9 cm — wide enough that a plane lit from
 * 57 degrees self-shadows into diagonal hatching. Keeping the floor out of the
 * shadow map costs nothing and removes one source of that.
 *
 * It was not the only source. The meadow's key light currently casts no shadow
 * at all; tools/make-kitten-survivors-meadow.mjs records the measurement and
 * what has to change in the engine before it can be turned back on.
 *
 * THE TEXTURE IS ON THE PLACEMENT, and so is the tint. The surface is
 * meadow/field.png, painted by tools/make-kitten-survivors-ground.mjs to hold
 * every pixel within a tenth of one value and to step less than 0.042 between
 * neighbours, so it enriches two thirds of the frame and still measures
 * edgeDensity 0 on its own. It is drawn at one repeat per 12.5 m, which is
 * wider than the 12 m of ground the camera shows, so no repeat is ever in frame
 * beside itself.
 *
 * The floor carries no painted patches of a different colour. A patchwork of
 * floor tints clears value.spread the same way light does and reads as sheets of
 * paper thrown on a lawn. See `ground-reads-as-one-surface` in the bible: what
 * variation the floor has comes from one soft texture and from what stands on it.
 */
export default {
  about: 'the meadow floor, one slab per placement. Its top face is the y = 0 plane the level is measured from',
  appearance: 'A single flat slab of warm green under everything else, carrying a soft low-contrast grass texture and no outline. The quietest surface on screen, and deliberately so.',
  looksWrongWhen: 'entities float above it or sink into it — the slab is not placed at y = -height/2',

  // The rule the comment above states, in a form `check` reads: the top of
  // this slab (its placed y plus half its own height) must sit on y = 0.
  invariant: { rule: 'topFaceAtY', value: 0, about: 'the top face of the slab sits at y = 0' },

  mesh: {
    box: [40, 1, 40],
    material: 'toon',
    steps: 4,
    shadow: false
  },
  collider: { box: [40, 1, 40] },
  properties: { body: 'solid' }
}
