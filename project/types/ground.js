export default {
  // `tile` repeats the texture once per world unit instead of stretching it,
  // so one 16-wide platform draws sixteen bricks.
  sprite: { image: 'brick.png', tile: 1 },
  collider: { box: [1, 1] },
  properties: { body: 'solid' }
}
