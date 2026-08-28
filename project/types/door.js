export default {
  // The blue double doors at long, mid and B, and the metal doors on the
  // buildings. In 1.6's de_dust2 not one of them opens: the doorways are simply
  // holes in the wall, and the leaves stand permanently swung back flat against
  // their jambs. So a door here is solid scenery you can bump into, and there is
  // deliberately no hook that would ever move it. A door that opened would be a
  // different map — every timing in it assumes you can see straight through.
  //
  // Placements pick the leaf: door-blue.png for the three double doorways,
  // door-metal.png for the ones set into building fronts that lead nowhere.
  mesh: {
    box: [1.2, 2.4, 0.12],
    texture: 'counter-strike/door-blue.png',
    tiling: [1, 1],   // absolute repeats: a door is one picture, not a material
    tint: '#5f86a6'
  },
  collider: { box: [1.2, 2.4, 0.12] },
  properties: { body: 'solid' }
}
