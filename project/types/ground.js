export default {
  about: 'a solid platform tile. Its texture repeats once per world unit rather than stretching',
  appearance: 'A brick surface the player stands on. A wide platform draws as many bricks, not one stretched brick.',
  looksWrongWhen: 'the bricks stretch across the whole platform — `tile` was dropped, so one brick was scaled to fit.',

  // `tile` repeats the texture once per world unit instead of stretching it,
  // so one 16-wide platform draws sixteen bricks.
  sprite: { image: 'brick.png', tile: 1 },
  collider: { box: [1, 1] },
  properties: { body: 'solid' }
}
