export default {
  // A brush is one textured solid box, and it is what the whole of de_dust2 is
  // made of — floors, walls, steps, lintels, awnings, the lot.
  //
  // Everything that matters about a brush is set per placement, and that is the
  // decision this file is really making. A map is several hundred separate
  // judgements about size and material, and none of them belong to the type: a
  // 20 m outer wall and a 0.4 m step share nothing except being solid. So the
  // defaults here are only what a brush is when nobody has said anything yet —
  // a 4 x 3 x 0.4 m sandstone wall panel, the commonest thing in the map.
  //
  // The three numbers are width along X, height along Y and depth along Z, and
  // the collider repeats them so what you see is what you walk into. `at` is the
  // centre, so this wall standing on the ground has y = 1.5.
  mesh: {
    box: [4, 3, 0.4],
    texture: 'counter-strike/sandstone-block.png',
    tiling: 1,
    tint: '#c8b48a'
  },
  collider: { box: [4, 3, 0.4] },
  properties: { body: 'solid' }

  // No hooks. A brush does nothing at all — it is only there — and adding an
  // update to it would cost the map four hundred function calls a frame to
  // achieve nothing.
}
