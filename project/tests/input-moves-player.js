export default {
  name: 'holding right moves the player right, and releasing stops it',
  level: 'level1',

  run(test) {
    const player = test.entity('player-0')
    test.simulate(1)                       // let it land first
    const start = player.x

    test.hold('right', 0.5)
    test.ok(player.x > start, `moved right (${start} -> ${round(player.x)})`)

    // Physics integrates before update hooks run, so the velocity set on the
    // last held step is spent on the next one: movement stops within one step,
    // not instantly. 0.101 is one step at speed 6, and nothing more.
    const afterHold = player.x
    test.simulate(0.5)                     // nothing held now
    test.near(player.x, afterHold, 0.101, 'stopped within one step of the key coming up')

    test.hold('left', 0.5)
    test.ok(player.x < afterHold, 'left moves the other way')
  }
}

const round = n => Math.round(n * 100) / 100
