/**
 * The run has a shape, and the numbers say what it is.
 *
 * A survivor is judged on its arc, not on any one second of it: something to
 * kill straight away, a crowd that grows in steps the player can feel, a threat
 * in the middle the opening weapons cannot answer, and an end the run reaches.
 * Each of those is a number here.
 *
 * The run is played by `kitten.arc`, which takes a card every time the world
 * stops for one. Without that a simulation freezes on the first level-up and
 * every reading after it is the same reading.
 */

/** Which families the schedule has in the bag at a given minute. */
const familiesAt = (context, minutes) => Object.keys(context.hordeSchedule.waveAt(minutes).weights).sort()

export default {
  name: 'the wave schedule has an arc',
  level: 'meadow',

  async run(test) {
    const context = test.context
    const schedule = context.hordeSchedule

    // ---- the run has an end, and the schedule says where it is
    test.is(schedule.runSeconds, 180, 'a run is three minutes long')
    test.simulate(1 / 60)
    test.ok(context.runClock.watching !== null, 'the run clock is watching the kitten')

    // ---- the schedule escalates, as numbers, without playing anything
    const cap = minutes => schedule.aliveCapAt(minutes)
    test.ok(cap(0) < cap(1), `the crowd cap grows from ${cap(0)} at the start to ${cap(1)} at a minute`)
    test.ok(cap(3) >= cap(0) * 5, `and to ${cap(3)} at the peak, five times the opening`)
    test.ok(schedule.rateAt(3) > schedule.rateAt(0), 'and they arrive faster as the run goes on')
    test.ok(schedule.healthScaleAt(3) > 2, `an enemy at the peak has ${schedule.healthScaleAt(3).toFixed(1)}x the health it opened with`)
    test.ok(schedule.speedScaleAt(3) < 1.4, 'and is never so much faster that running stops working')
    test.ok(schedule.swarmSizeAt(3) > schedule.swarmSizeAt(0.5), 'swarms grow too')
    test.is(schedule.swarmEvery, 30, 'and one lands every half minute, so the beat is felt twice a minute')

    // ---- each family enters where it changes what the player has to do
    test.is(familiesAt(context, 0), ['crow', 'rat'], 'the run opens with rats and the crows that reach the kitten first')
    test.is(familiesAt(context, 1), ['crow', 'rat', 'wasp'], 'a wasp that outruns the kitten arrives at one minute')
    test.is(familiesAt(context, 1.5), ['crow', 'hound', 'rat', 'wasp'], 'a hound that soaks a whole weapon at ninety seconds')
    test.is(familiesAt(context, 2), ['boar', 'crow', 'hound', 'rat', 'wasp'], 'and the charging boar at two minutes')

    // ---- first blood, played. Through the arc rather than `simulate`, because
    // a level-up holds the world and a held step moves no clock at all — a
    // plain simulate stops dead at whatever second the first card came up.
    const deaths = []
    const stopCounting = test.on('enemy:died', () => deaths.push(context.time))
    const opening = await context.run('kitten.arc', [20, 20])
    test.near(opening.played, 20, 1, `the first twenty seconds really played — ${opening.played}s`)
    test.ok(deaths.length > 0, 'something dies in the first twenty seconds')
    test.ok(deaths[0] <= 5, `the first kill lands at ${deaths[0].toFixed(1)}s, inside a few seconds of the start`)
    test.ok(deaths.length >= 10, `and ${deaths.length} are dead by twenty seconds`)
    stopCounting()
    const early = context.horde.count

    // ---- a body stays long enough to be seen falling, and frees its slot at once
    // A tenth of a second, not two steps: a kill lands hit stop, and a held step
    // runs no system at all, so a shorter window watches nothing happen.
    const you = test.entity('you')
    const rat = context.horde.admit('rat', you.x + 4, you.z)
    test.simulate(1 / 60)
    test.ok(context.horde.enemies.includes(rat), 'the rat is in the crowd while it lives')
    context.damage(rat, 9999, { from: you, source: 'test' })
    // A kill lands hit stop, and a held step runs no fixed system, so a window
    // in seconds watches nothing happen. Drain the hold, then ask.
    for (let step = 0; step < 60 && context.loop.holding > 0; step++) test.simulate(1 / 60)
    test.simulate(0.05)
    // Its own membership, not the crowd's size: the drip is spawning through
    // this window whenever the meadow is under its cap, so a total would be
    // measuring the spawner rather than the death.
    test.ok(!context.horde.enemies.includes(rat),
      'a dead enemy leaves the population cap as soon as it dies')
    test.ok(context.world.entities.includes(rat), 'but its body stays, so the collapse has somewhere to happen')
    test.simulate(1)
    test.ok(!context.world.entities.includes(rat), 'and it is taken away once the collapse is over')

    // ---- the rest of the run, picking blind
    const blind = await context.run('kitten.arc', [160, 30])
    test.ok(blind.cards + opening.cards >= 4,
      `picking blind, the run offered ${blind.cards + opening.cards} cards — about one every twenty seconds`)
    test.ok(!blind.stuck, 'and the choice screen never held the world open')
    test.ok(context.runClock.seconds >= 60,
      `the run reached ${context.runClock.clock}, past the minute where wasps and hounds arrive`)
    test.ok(blind.ended.kills > 100, `killing ${blind.ended.kills} on the way`)

    const most = Math.max(...blind.marks.map(mark => mark.alive))
    test.ok(most > early * 2, `the crowd grew from ${early} at twenty seconds to ${most} at its worst`)
    test.ok(blind.lowestHealth < 100, `and the kitten was down to ${blind.lowestHealth} health at some point`)
  }
}
