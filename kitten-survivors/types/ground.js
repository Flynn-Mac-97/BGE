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
 * an offset around. See kitten-survivors/art-language.md.
 *
 * Toon rather than lambert, four bands, and no outline. Under one directional
 * key light a flat plane of toon shading is one flat value, which is the point:
 * the ground is the quietest surface in the game and everything readable happens
 * on top of it. What variation it has comes from the texture and from the thin
 * tinted patches the level lays over it, never from its shading.
 */
export default {
  mesh: {
    box: [40, 1, 40],
    texture: 'meadow/grass.png',
    // A density, not a count: one repeat of the grass per metre, so the same
    // texture reads at the same scale on a 150 m field and on a 3 m patch.
    tiling: 1,
    material: 'toon',
    steps: 4
  },
  collider: { box: [40, 1, 40] },
  properties: { body: 'solid' }
}
