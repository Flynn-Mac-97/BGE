/**
 * R after death starts a second run, and a third.
 *
 * The retry used to soft-lock: the second run ended at 0:00 the moment it
 * started. Run Clock takes an entity, an id or a lookup, and Kitten Danger
 * handed it the kitten's body on `play:started`. A retry reloads the level,
 * which replaces every entity and never fires `play:started` again, so the
 * second run watched the first run's corpse, found it gone on the first step
 * and ended `died`.
 *
 * `play:started` is emitted here on purpose. Without it the bug is invisible
 * headless, which is how it survived: a simulation that never enters play mode
 * never installs the stale watch.
 */

/** How long each run is played before the kitten is killed off. */
const PLAY = 8

/** Take the kitten to zero, and let the clock notice. */
function die(test) {
  test.entity('you').properties.health = 0
  test.simulate(0.2)
}

/** Press R the way a player does, and wait for the level that comes back. */
async function retry(test) {
  const reloaded = new Promise(resolve => test.on('level:loaded', resolve))
  test.tap('kittenRestart')
  await reloaded
  // One step so the fresh level's systems have run once.
  test.simulate(1 / 60)
}

export default {
  name: 'R after death starts another run',
  level: 'meadow',

  async run(test) {
    const context = test.context
    context.bus.emit('play:started')
    test.simulate(PLAY)

    const first = context.world.byId('you')
    test.ok(context.runClock.running, 'the first run is running')

    die(test)
    test.is(context.runClock.over, true, 'the kitten dying ends the run')
    test.is(context.runClock.reason, 'died', 'and the reason is that it died')
    test.ok(context.loop.holds.includes('run-over'), 'the world is held so the result can be read')

    await retry(test)

    const second = context.world.byId('you')
    test.ok(!!second, 'a second kitten is in the world')
    test.ok(second !== first, 'and it is a new one, not the body from the last run')
    test.is(context.loop.holds, [], 'nothing is holding the world any more')
    test.is(context.runClock.over, false, 'the second run is not over before it starts')

    // The soft-lock: everything above passed while this failed, because the
    // clock was still watching the entity that had just been thrown away.
    test.is(context.runClock.watching, second, 'the run clock watches the kitten that is alive')

    test.is(context.autoWeapons.carriedBy(second).map(weapon => weapon.name), ['claw dart', 'purr wave'],
      'the second run is armed with the starting weapons')
    test.is(context.kittenUpgrades.taken().map(entry => entry.name), ['Claw Dart', 'Purr Wave'],
      'and carries nothing the first run picked up')
    test.is(second.properties.health, second.properties.maxHealth, 'at full health')

    test.simulate(PLAY)
    test.is(context.runClock.over, false, `the second run is still going at ${context.runClock.clock}`)
    test.ok(context.runClock.seconds >= PLAY - 1, `the clock counted ${context.runClock.clock} rather than staying at 0:00`)
    test.ok(context.horde.count > 0, `the horde came back — ${context.horde.count} on the meadow`)
    test.ok(context.horde.stats.killed > 0, 'and the weapons are killing it')

    // Twice, because a retry that works once and not again is the same defect
    // wearing a different number.
    die(test)
    test.is(context.runClock.reason, 'died', 'the second run ends the same way')
    await retry(test)
    test.is(context.runClock.over, false, 'and a third run starts')

    test.simulate(PLAY)
    test.is(context.runClock.over, false, `the third run is still going at ${context.runClock.clock}`)
    test.ok(context.horde.count > 0, 'with a horde on the meadow')
  }
}
