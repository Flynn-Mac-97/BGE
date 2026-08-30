/**
 * A build a player can assemble survives the whole run.
 *
 * "Survivable peak" is a claim about what is reachable, not about every run:
 * a kitten that picks blind dies somewhere in the second half, and one that
 * builds gets to the end. Only the second half of that is worth a test, because
 * only it can be false in a way nobody would notice — a schedule tuned past
 * what any build answers still looks fine from the first thirty seconds.
 *
 * Every id below is a card the game offers, taken through the verb the choice
 * screen calls, so this is a build a player could have picked and not a set of
 * numbers written onto a weapon.
 */
const DRAFT = [
  'yarn ball', 'hairball',
  'claw dart', 'claw dart', 'claw dart',
  'yarn ball', 'yarn ball',
  'purr wave', 'purr wave',
  'sharp-teeth', 'sharp-teeth', 'sharp-teeth',
  'full-belly', 'full-belly',
  'swift-paws', 'quick-claws', 'fluffy-tail', 'long-whiskers'
]

export default {
  name: 'a built kitten survives the peak',
  level: 'meadow',

  async run(test) {
    const context = test.context
    test.simulate(1 / 60)

    const run = await context.run('kitten.arc', [185, 45, DRAFT])
    test.is(run.refused, [], 'every card in the build is one the game offers')
    test.is(run.ended?.reason, 'survived', `the run ended ${run.ended?.reason} at ${run.ended?.clock}`)
    test.is(run.ended?.clock, '3:00', 'having lasted the full three minutes')
    test.ok(run.ended.kills > 500, `and killed ${run.ended.kills} doing it`)

    // The peak has to be a peak: hardest at the end, and lived through anyway.
    const marks = run.marks
    const opening = marks[1]
    const peak = marks[marks.length - 1]
    test.ok(peak.alive > opening.alive * 2,
      `the crowd went from ${opening.alive} at ${opening.clock} to ${peak.alive} at ${peak.clock}`)
    test.ok(peak.health > 0, `the kitten came out of it with ${peak.health} health`)
    const most = test.entity('you').properties.maxHealth
    test.ok(run.lowestHealth < most,
      `having been down to ${run.lowestHealth} of ${most} on the way rather than walking through untouched`)

    const boars = context.horde.stats.aliveByFamily
    test.ok(Object.keys(boars).length >= 3, `the peak has ${Object.keys(boars).join(', ')} on the meadow at once`)
  }
}
