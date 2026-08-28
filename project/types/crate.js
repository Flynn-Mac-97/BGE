export default {
  // The 1.6 wooden crate, and the 1.6 metres are not a coincidence worth losing.
  //
  // A crate is exactly tall enough that a standing player cannot see or shoot
  // over it, and exactly short enough that a crouch-jump puts you on top of it.
  // Both halves of that are load-bearing for how de_dust2 plays: a crate is
  // cover you must commit to leaving, and a position you must commit to taking.
  // Change this number and the crate stack at A stops being a plant spot and the
  // xbox in mid stops being a peek — so it is declared once, here, and every
  // placement in the map inherits it rather than choosing its own size.
  mesh: {
    box: [1.6, 1.6, 1.6],
    texture: 'counter-strike/crate-wood.png',
    tiling: 1,
    tint: '#efe7da'
  },
  collider: { box: [1.6, 1.6, 1.6] },
  properties: { body: 'solid' }
}
