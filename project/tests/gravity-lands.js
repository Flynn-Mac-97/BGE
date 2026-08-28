export default {
  name: 'a dynamic body falls and rests exactly on the ground surface',
  level: 'level1',

  run(test) {
    const player = test.entity('player-0')
    test.is(player.properties.body, 'dynamic', 'the player is a dynamic body')

    test.simulate(1.5)

    // ground-0 top is y 0.5, the player collider is 0.9 tall, so 0.5 + 0.45.
    test.near(player.y, 0.95, 0.001, 'came to rest on the ground surface, not through it')
    test.ok(player.grounded, 'the ground contact was reported')

    // Resting means resting: another second must not move it.
    const settled = player.y
    test.simulate(1)
    test.near(player.y, settled, 0.0001, 'stayed put once landed')
  }
}
