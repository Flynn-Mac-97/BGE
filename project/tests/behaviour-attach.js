export default {
  name: 'a behaviour runs only on what it is attached to, and each attachment keeps its own values',
  level: 'level1',

  run(test) {
    const plainCoin = test.entity('coin-0')
    const strongerCoin = test.entity('coin-1')
    const startedAt = plainCoin.y

    test.attach('coin-0', 'float')
    test.attach('coin-1', 'float', { amplitude: 1.5 })

    // sin(2 × 1s) = 0.9093, so the offset is amplitude × that.
    test.simulate(1)
    test.near(plainCoin.y, startedAt + 0.909 * 0.3, 0.01, 'the default amplitude moved coin-0')
    test.near(strongerCoin.y, strongerCoin.float.base + 0.909 * 1.5, 0.01,
      'the override moved coin-1 five times as far')
    test.is(test.entity('coin-2').y, 4, 'the coin with nothing attached did not move')

    // The type's own update still runs, and runs after the behaviour, so
    // composing something onto a type never quietly replaces what it does.
    test.is(test.entity('coin-2').rotation, 120, 'the type hook still spun every coin')

    test.detach('coin-0', 'float')
    const heldAt = plainCoin.y
    test.simulate(1)
    test.is(plainCoin.y, heldAt, 'once detached it stops moving the entity')
  }
}
