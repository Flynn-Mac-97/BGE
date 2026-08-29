export default {
  // The meadow floor. One solid box, sized per placement — an arena is one
  // large slab and a patch of path is a small one, and neither belongs to the
  // type. Three numbers on the collider is what makes it 3D.
  mesh: {
    box: [40, 1, 40],
    tint: '#6f9c4a'
  },
  collider: { box: [40, 1, 40] },
  properties: { body: 'solid' }
}
