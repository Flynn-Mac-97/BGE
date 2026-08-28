export default {
  name: 'the player can jump from the ground and not from mid-air',
  level: 'level1',

  run(test) {
    const player = test.entity('player-0')
    test.simulate(1.5)
    test.ok(player.grounded, 'landed and knows it')

    const floor = player.y
    test.hold('jump', 0.25)
    test.ok(player.y > floor + 0.5, `left the ground (${floor} -> ${round(player.y)})`)
    test.ok(!player.grounded, 'not grounded while in the air')

    // A second jump mid-air must do nothing.
    const rising = player.y
    test.hold('jump', 0.05)
    const peak = player.y
    test.simulate(2)
    test.ok(player.grounded, 'came back down')
    test.ok(peak < rising + 1.5, 'the mid-air press did not add height')
  }
}

const round = n => Math.round(n * 100) / 100
