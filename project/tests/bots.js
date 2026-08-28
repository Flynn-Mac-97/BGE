/**
 * The bots: can they get there, do they only shoot what they can see, and do
 * they actually move.
 *
 * The last one is the test everybody skips and the one that catches the failure
 * everybody ships. A bot that walks into a doorframe for the whole round looks
 * exactly like a bot that is thinking hard, and no screenshot will ever tell
 * the two apart — only simulating one for ten seconds and measuring how far it
 * got will.
 *
 * Every bot here is a real `terrorist` or `counter-terrorist` with `bot-brain`
 * attached on top, which is exactly how one is built in a level: the same body,
 * the same `counter-strike-movement` underneath, and the brain in the place a
 * human's `player-controlled` would be. If a bot could be made to move by any
 * other arrangement, this test would be proving something nobody plays.
 *
 * The navigation is imported rather than reached through `context.navigation`,
 * because a test is handed `test` and never the context. It is the same pure
 * function the plugin calls, given the world's own entities, so what is checked
 * here is what the bots will walk on.
 */
import { buildNavigation } from '../plugins/bot-navigation.js'

/** Half the height of a standing player, so a body's feet can be found from its centre. */
const HALF_HEIGHT = 0.915

export default {
  name: 'bots path to both sites from both spawns, hold fire through a wall, and walk somewhere in ten seconds',
  level: 'de_dust2',

  run(test) {
    const navigation = buildNavigation(test.entities)

    // ------------------------------------------------------------ the map
    const stats = navigation.stats
    test.ok(stats.walkable > 3000, `the map has ${stats.walkable} places to stand`)
    // Islands are reported rather than forbidden — the top of a wall nobody can
    // climb is a real one — but the map has to be mostly one piece, or the
    // routes below pass by luck rather than because the map is joined up.
    const biggest = navigation.regions[0]?.cells ?? 0
    test.ok(biggest > stats.walkable * 0.9,
      `most of the map is one region: ${biggest} of ${stats.walkable} cells`)
    for (const island of stats.unreachable.slice(0, 3)) {
      test.note(`unreachable island of ${island.cells} cells at ${island.at.join(', ')}`)
    }

    // ------------------------------------------------- a route to each site
    const spawnOf = team => test.entities.find(entity =>
      entity.type === 'spawn-point' && entity.properties?.team === team)
    const siteOf = name => {
      const site = test.entities.find(entity => entity.properties?.site === name)
      // The floor of the site, not the middle of its trigger — that box reaches
      // over head height, and a bot planting the bomb stands on the ground.
      return site && { x: site.x, y: site.y - site.collider.box[1] / 2, z: site.z }
    }

    for (const team of ['terrorist', 'counter-terrorist']) {
      const spawn = spawnOf(team)
      test.ok(spawn, `${team} has a spawn point`)
      for (const name of ['A', 'B']) {
        const site = siteOf(name)
        test.ok(site, `bomb site ${name} is in the level`)
        if (!spawn || !site) continue

        const path = navigation.path(spawn, site)
        test.ok(path && path.length > 1, `${team} spawn has a route to site ${name}`)
        if (!path) continue

        const offMap = path.filter(point => !navigation.walkable(point))
        test.is(offMap.length, 0, `every step of the ${team} route to ${name} is walkable`)

        // A route that teleports between two points is a graph bug a walkable
        // check cannot see: each leg has to be one a bot could really walk.
        const longest = path.reduce((worst, point, index) =>
          index ? Math.max(worst, Math.hypot(point.x - path[index - 1].x, point.z - path[index - 1].z)) : worst, 0)
        test.ok(longest < 40, `no leg of the ${team} route to ${name} jumps the map (longest ${longest.toFixed(1)} m)`)
      }
    }

    // -------------------------------------------------- seeing and shooting
    // Staged out in the open on bomb site B, and parked there: what is measured
    // here is the eye and the trigger, so the feet are held still. The aim is
    // not held — turning towards something it has seen is the bot's own.
    const groundB = siteOf('B')
    const standing = groundB.y + HALF_HEIGHT + 0.01
    const facingWest = 90     // the yaw whose forward is -X, in the degrees a placement uses
    const onTheMark = [groundB.x, standing, groundB.z]
    const behind = [groundB.x + 4, standing, groundB.z]
    const ahead = [groundB.x - 4, standing, groundB.z]
    const bot = spawnBot(test, 'bot-shooter', 'counter-terrorist', onTheMark)
    const enemy = spawnBot(test, 'bot-target', 'terrorist', behind, false)

    // Nothing below happens during the freeze, because a bot that moved or
    // fired then would be a bug — and the match rules put every combatant on a
    // spawn point and hold it there until the round goes live. So wait it out
    // first and stage the fight afterwards. With no match rules loaded there is
    // no freeze and this returns on the first step.
    const waited = untilLive(test, bot)
    test.ok(waited < 60, `the round went live after ${waited.toFixed(0)} s of freeze`)

    // de_dust2 comes with ten bots of its own, all of them armed and all of
    // them playing. Two things keep this duel a duel: nobody in it can be
    // killed, because a death ends a round and a round ending teleports
    // everything back to a spawn point; and the shooter can only see six
    // metres, so the only thing it can possibly be looking at is the target
    // placed four metres from it.
    immortal(bot)
    immortal(enemy)
    brainOf(bot).sightRange = 6

    // The enemy starts *behind* the bot, four metres away and in plain air.
    place(bot, onTheMark, facingWest)
    place(enemy, behind, -90)
    const parked = [
      { entity: bot, at: onTheMark, yaw: facingWest * Math.PI / 180 },
      { entity: enemy, at: behind }
    ]
    test.ok(navigation.walkable({ x: bot.x, y: groundB.y, z: bot.z }),
      'the bot is standing somewhere a player could stand')

    hold(test, parked, 1)
    test.is(brainOf(bot).target, null, 'a bot cannot see what is behind it')
    test.is(brainOf(bot).triggerPulls, 0, 'and does not shoot at it')

    // Now in front, but behind a wall put there for the purpose.
    const wall = test.spawn('brush', {
      id: 'sightline-blocker',
      at: [groundB.x - 2, groundB.y + 1.5, groundB.z],
      collider: { box: [0.4, 3, 6] },
      properties: { body: 'solid' }
    })
    parked[1].at = ahead
    hold(test, parked, 1.5)
    test.is(brainOf(bot).target, null, 'and it cannot see through a wall either')
    test.is(brainOf(bot).triggerPulls, 0, 'so it holds its fire')

    // The wall comes down. Sight is answered within a tenth of a second, but
    // the trigger is not: the reaction clock only starts here, and the fastest
    // reaction this bot is allowed is longer than the gap below.
    test.destroy(wall.id)
    hold(test, parked, 0.25)
    test.is(brainOf(bot).target, enemy, 'with the wall gone it picks the enemy up')
    test.is(brainOf(bot).triggerPulls, 0, 'and still has not fired — it has a reaction time')

    hold(test, parked, 1)
    test.ok(brainOf(bot).triggerPulls > 0,
      `and now it fires (${brainOf(bot).triggerPulls} trigger pulls)`)

    test.destroy(bot.id)
    test.destroy(enemy.id)

    // ------------------------------------------------------ actually moving
    const spawn = spawnOf('terrorist')
    const standAt = [spawn.x, spawn.y + HALF_HEIGHT + 0.01, spawn.z]
    const walker = spawnBot(test, 'bot-walker', 'terrorist', standAt)
    untilLive(test, walker)
    place(walker, standAt, spawn.rotation ?? 0)
    // Blind for this stretch, on purpose. There is another body on this map and
    // a bot that can see one stops to shoot at it, which is right — and would
    // mean this measured the trigger a second time instead of the feet.
    brainOf(walker).sightRange = 0
    immortal(walker)
    const startedAt = { x: walker.x, z: walker.z }
    const startedInRound = test.state.round

    test.simulate(10)
    const travelled = Math.hypot(walker.x - startedAt.x, walker.z - startedAt.z)
    test.ok(travelled > 8, `ten seconds from spawn and the bot has gone ${travelled.toFixed(1)} m`)
    test.ok(navigation.walkable({ x: walker.x, y: walker.y - HALF_HEIGHT, z: walker.z }),
      'and it is standing somewhere a player could stand, not wedged in geometry')
    test.is(test.state.round, startedInRound, 'and the round did not turn over underneath it')
    test.ok(brainOf(walker).stuck < 2,
      `and it is not grinding against anything (stuck count ${brainOf(walker).stuck})`)
    test.note(`it ended in state "${brainOf(walker).state}" heading for site ${brainOf(walker).site}`)
  }
}

/**
 * Take a body out of the fight without taking it off the map.
 *
 * A death ends a round, and a round ending teleports every player back to a
 * spawn point — which would make the measurements below meaningless rather than
 * merely wrong. Better to be honest about the arrangement than to run this on a
 * map with nothing in it, which is not the map anybody plays.
 */
function immortal(entity) {
  if (!entity.damageable) return
  entity.damageable.health = 1e6
  entity.damageable.maxHealth = 1e6
}

/** A bot's own bag, which is where every decision it has made is readable. */
const brainOf = entity => entity['bot-brain']

/**
 * One bot: the ordinary body of its side, with a brain where a human would be.
 *
 * The skill is deliberately low. A bot good enough to sidestep while shooting
 * is a bot that walks out of the sightline this test set up, and the point here
 * is the eye and the trigger rather than the footwork.
 */
function spawnBot(test, id, team, at, brain = true) {
  return test.spawn(team, {
    id,
    at,
    behaviours: brain ? { 'bot-brain': { skill: 0.2, site: 'B' } } : {}
  })
}

/**
 * Put a body somewhere, facing something, with nothing left over from where it
 * was.
 *
 * The brain's own aim and route are reset with it. A bot teleported by a test
 * is not a bot that walked, and leaving it holding last position's path is how
 * a test ends up measuring a walk to somewhere that made sense a moment ago.
 */
function place(entity, at, rotation) {
  entity.x = at[0]
  entity.y = at[1]
  entity.z = at[2]
  entity.rotation = rotation
  entity.aimYaw = rotation * Math.PI / 180
  entity.velocityX = 0
  entity.velocityY = 0
  entity.velocityZ = 0

  const brain = entity['bot-brain']
  if (!brain) return
  brain.aimYaw = entity.aimYaw
  brain.aimPitch = 0
  brain.travelYaw = entity.aimYaw
  brain.target = null
  brain.noise = null
  brain.path = null
  brain.goal = null
  brain.triggerPulls = 0
  brain.stuck = 0
  brain.wasX = entity.x
  brain.wasZ = entity.z
}

/**
 * Step the world with some bodies pinned where they were put, facing one way.
 *
 * A bot with nothing to shoot at walks to the objective, and one already
 * standing on the objective goes and looks at the other site — both correct,
 * and both would have carried the shooter off its mark and turned it round
 * before the wall came down. So the feet and the *yaw* are held.
 *
 * Everything the checks actually read is still the bot's own: which target it
 * picks, how long it waits before firing, and the pitch it has to travel
 * through to put the shot on a body whose chest is below its eye.
 */
function hold(test, parked, seconds) {
  for (let step = 0; step < Math.round(seconds * 60); step++) {
    // Before, so the step runs from the mark; after, so nothing the step
    // decided has moved it off again.
    parked.forEach(pin)
    test.simulate(1 / 60)
    parked.forEach(pin)
  }
}

function pin({ entity, at, yaw }) {
  entity.x = at[0]
  entity.y = at[1]
  entity.z = at[2]
  entity.velocityX = 0
  entity.velocityY = 0
  entity.velocityZ = 0
  if (yaw === undefined) return
  entity.aimYaw = yaw
  const brain = entity['bot-brain']
  if (brain) {
    brain.aimYaw = yaw
    brain.travelYaw = yaw
  }
}

/**
 * Wait out the freeze, and say how long it took.
 *
 * Asked of the bot rather than of the match, because a test never sees the
 * context: a brain sitting in the `buy` state is a brain that has been told the
 * round has not started. It doubles as the guard for the match rules not being
 * loaded at all, where the first step already leaves that state.
 */
function untilLive(test, bot) {
  let waited = 0
  // Stepped once before it is asked, because a behaviour's bag holds only its
  // declared properties until the first hook has run.
  do {
    test.simulate(0.25)
    waited += 0.25
  } while (brainOf(bot).state === 'buy' && waited < 60)
  return waited
}
