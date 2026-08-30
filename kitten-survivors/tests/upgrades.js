/**
 * Every card changes a number, and this test reads the number back.
 *
 * The upgrade catalogue used to grant through `context.weapons`, a key nothing
 * publishes, with ids for weapons that were never defined — so every pick was a
 * card that did nothing. A test that only checked "a card was taken" would have
 * passed the whole time it was broken, so each check below takes a card and
 * compares a stat or a property either side of it.
 */
const WEAPONS = ['claw dart', 'yarn ball', 'purr wave', 'hairball']

/** The name Auto Weapons files a carried weapon under, and its numbers now. */
const statsOf = (context, name) =>
  context.autoWeapons.of(context.world.byId('you'), name)?.stats || null

/** Take a card and hand back the stats it produced, so a check reads one line. */
function take(test, id) {
  const taken = test.context.kittenUpgrades.apply(id)
  test.ok(taken.ok, `${id} was taken — ${taken.reason || 'ok'}`)
  return taken
}

export default {
  name: 'every upgrade changes a number',
  level: 'meadow',

  run(test) {
    const context = test.context
    const you = test.entity('you')
    // One step so the level is armed and the weapons have their starting stats.
    test.simulate(1 / 60)

    // ---- the kitten starts with two weapons, and the catalogue knows it
    const carried = context.autoWeapons.carriedBy(you).map(weapon => weapon.name)
    test.is(carried, ['claw dart', 'purr wave'], 'a run opens with claw dart and purr wave')
    test.is(context.kittenUpgrades.rankOf('claw dart'), 1, 'the starter is already at rank one, so its card offers rank two')
    test.is(context.kittenUpgrades.rankOf('yarn ball'), 0, 'yarn ball is not carried, so its card offers it new')

    // ---- every card in the catalogue is something the game actually has
    for (const entry of context.kittenUpgrades.catalogue()) {
      if (entry.kind !== 'weapon') continue
      test.ok(context.autoWeapons.defined().includes(entry.id), `${entry.id} is a weapon Auto Weapons was given`)
    }

    // ---- rank one of a weapon card arms the kitten with it
    take(test, 'yarn ball')
    test.ok(!!statsOf(context, 'yarn ball'), 'taking Yarn Ball new arms the kitten with it')
    take(test, 'hairball')
    test.is(context.autoWeapons.carriedBy(you).length, 4, 'two picks later the kitten carries all four')

    // ---- every rank of every weapon changes a stat
    for (const name of WEAPONS) {
      while (context.kittenUpgrades.rankOf(name) < 5) {
        const before = { ...statsOf(context, name) }
        const rank = context.kittenUpgrades.rankOf(name) + 1
        take(test, name)
        const after = statsOf(context, name)
        const moved = Object.keys(after).filter(key => after[key] !== before[key] && key !== 'level')
        test.ok(moved.length > 0, `${name} rank ${rank} changed ${moved.join(', ') || 'nothing'}`)
      }
      test.is(context.kittenUpgrades.rankOf(name), 5, `${name} tops out at rank five`)
    }

    // ---- and the numbers grew rather than merely moved
    const dart = statsOf(context, 'claw dart')
    test.is(dart.count, 3, 'a fully ranked claw dart throws three darts, not one')
    test.ok(dart.damage > 11, `a fully ranked claw dart hits for ${Math.round(dart.damage)}, up from 11`)
    test.ok(dart.cooldown < 1.05, `and comes round every ${dart.cooldown.toFixed(2)}s, down from 1.05`)

    // ---- passives that make weapons better reach every weapon carried
    const beforeTeeth = WEAPONS.map(name => statsOf(context, name).damage)
    take(test, 'sharp-teeth')
    const afterTeeth = WEAPONS.map(name => statsOf(context, name).damage)
    for (let index = 0; index < WEAPONS.length; index++) {
      test.near(afterTeeth[index] / beforeTeeth[index], 1.1, 0.001, `Sharp Teeth raised ${WEAPONS[index]} damage by a tenth`)
    }

    const beforeTail = statsOf(context, 'purr wave').area
    take(test, 'fluffy-tail')
    test.near(statsOf(context, 'purr wave').area / beforeTail, 1.1, 0.001, 'Fluffy Tail widened the purr wave by a tenth')

    const beforeClaws = statsOf(context, 'yarn ball').cooldown
    take(test, 'quick-claws')
    test.near(statsOf(context, 'yarn ball').cooldown / beforeClaws, 0.92, 0.001, 'Quick Claws took 8% off the yarn ball cooldown')

    // ---- passives that change the kitten change the kitten
    const speedBefore = you.properties.speed
    take(test, 'swift-paws')
    test.near(you.properties.speed / speedBefore, 1.1, 0.001, 'Swift Paws made the kitten a tenth faster')

    const reachBefore = you.properties.pickupRadius
    take(test, 'long-whiskers')
    test.near(you.properties.pickupRadius / reachBefore, 1.25, 0.001, 'Long Whiskers reached a quarter further')

    const mostBefore = you.properties.maxHealth
    you.properties.health = 10
    take(test, 'full-belly')
    test.is(you.properties.maxHealth, mostBefore + 20, 'Full Belly added 20 maximum health')
    test.is(you.properties.health, 30, 'and handed 20 of it over on the spot')

    // ---- a saucer of milk heals, and never past the top
    you.properties.health = 5
    const milk = context.kittenUpgrades.apply('saucer-of-milk')
    test.is(milk.health, 35, 'a saucer of milk drinks 30 health back')
    you.properties.health = you.properties.maxHealth
    context.kittenUpgrades.apply('saucer-of-milk')
    test.is(you.properties.health, you.properties.maxHealth, 'and a full kitten stays full')

    // ---- a weapon picked after a passive catches up on it
    // Disarmed first: reset reads the ranks back off what the kitten is holding.
    context.autoWeapons.take(you, 'hairball')
    context.kittenUpgrades.reset()
    take(test, 'sharp-teeth')
    take(test, 'sharp-teeth')
    take(test, 'hairball')
    test.near(statsOf(context, 'hairball').damage, 26 * 1.1 * 1.1, 0.001,
      'a weapon picked after two Sharp Teeth arrives with both of them applied')

    // ---- the offer is always full and never repeats a card
    const cards = context.kittenUpgrades.offer(3)
    test.is(cards.length, 3, 'a level-up always offers three cards')
    test.is(new Set(cards.map(card => card.id)).size, 3, 'and never the same card twice')
  }
}
