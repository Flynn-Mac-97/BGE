export default {
  name: 'a coin scores its placement value, not its type default',
  level: 'level1',

  run(test) {
    // coin-2 is placed with properties.value = 50, overriding the type's 10.
    const coin = test.entity('coin-2')
    test.is(coin.properties.value, 50, 'the placement override reached the entity')

    // Drop the player straight onto it.
    test.at('player-0', coin.x, coin.y + 1.2)
    test.simulate(1)

    test.is(test.state.score, 50, 'score used the override')
    test.is(test.count('coin'), 2, 'the coin was destroyed on contact')
    test.ok(!test.exists('coin-2'), 'the right coin went')
  }
}
