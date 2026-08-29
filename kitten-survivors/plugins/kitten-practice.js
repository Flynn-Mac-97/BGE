/**
 * Kitten Practice — straw kittens to hit, and one command that proves a weapon works.
 *
 * The horde belongs to another lane, and it may not exist yet in the checkout
 * you are reading. A weapon lane that cannot test until the enemies land is a
 * weapon lane that ships untested, so this puts up its own targets: straw
 * kittens with health, no brain, and no opinion about where they stand.
 *
 * Nothing here runs on its own. Both verbs are commands, so a level never grows
 * practice targets by accident and deleting this file costs the game nothing.
 *
 * `kitten.proof` is the whole point: it arms the kitten, stands targets around
 * it, runs the simulation, and answers with what died and how. One process, one
 * answer, no dev server and no screen — which is the only way an agent can say
 * "the weapons kill things" and mean it.
 */

/** Straw kittens are spawned under this type name. No type file: the mesh is here. */
const TARGET = 'straw kitten'

/**
 * How far out each target stands, cycled.
 *
 * Three rings, not one: the weapons have deliberately different reach, and a
 * single ring at any distance leaves at least one of them proving nothing. The
 * near ring is inside the yarn, the middle one is inside the purr wave, and the
 * far one is only reachable by something thrown.
 */
const RINGS = [1.6, 3.4, 5.5]

const HEALTH = 30     // enough to take a few hits, not enough to survive a build

export default {
  name: 'Kitten Practice',
  about: 'Straw kittens to hit, and one command that proves in a headless run that a weapon kills something.',
  needs: ['Health', 'Kitten Weapons'],

  inspect: context => [{
    title: 'Practice',
    rows: [['straw kittens standing', context.world.all(TARGET).length]]
  }],

  commands: [
    {
      id: 'kitten.dummies',
      label: 'Stand straw kittens around the player',
      /** `run kitten.dummies 8` — a ring of eight, or one number of your own. */
      run: (context, howMany) => {
        const many = Math.max(1, Math.round(Number(howMany) || 6))
        return { standing: stand(context, many).length }
      }
    },
    {
      id: 'kitten.clear',
      label: 'Take every straw kitten away',
      run: context => {
        const standing = context.world.all(TARGET)
        for (const target of standing) context.world.destroy(target)
        return { removed: standing.length }
      }
    },
    {
      id: 'kitten.proof',
      label: 'Stand targets up, run the clock, say what died',
      /**
       * `run kitten.proof '[10, 8]'` — ten seconds against eight straw kittens.
       *
       * A third argument upgrades the build first, which is how the upgrade
       * lane answers "what does this actually do" in one headless run:
       *
       *   run kitten.proof '[10, 8, {"claw dart": {"count": "+2"}}]'
       */
      run: (context, args) => {
        const [seconds, howMany, build] = Array.isArray(args) ? args : [args, 8, null]
        return prove(context, Number(seconds) || 8, Math.max(1, Math.round(Number(howMany) || 8)), build)
      }
    }
  ]
}

/** A ring of targets around the player, evenly spaced. */
function stand(context, many) {
  const player = context.world.byId('you')
  const middle = player || { x: 0, y: 0.725, z: 0 }
  const made = []

  for (let index = 0; index < many; index++) {
    const angle = (index / many) * Math.PI * 2
    const out = RINGS[index % RINGS.length]
    const target = context.world.spawn(TARGET, {
      at: [
        middle.x + Math.sin(angle) * out,
        middle.y,
        middle.z + Math.cos(angle) * out
      ],
      mesh: { box: [0.45, 0.45, 0.7], tint: '#c8a86a' }
    })
    context.health.give(target, { health: HEALTH, maxHealth: HEALTH })
    made.push(target)
  }
  return made
}

/**
 * Stand targets up, let the weapons run, and report what actually happened.
 *
 * Counted off the bus rather than by comparing the entity list, because a body
 * lingers before it is removed and a count taken at the end would call a corpse
 * a survivor. What died, what hit it and for how much is exactly the evidence
 * a claim like "the weapons work" needs.
 */
function prove(context, seconds, many, build) {
  for (const old of context.world.all(TARGET)) context.world.destroy(old)

  const you = context.world.byId('you')
  for (const [name, changes] of Object.entries(build || {})) {
    context.autoWeapons.upgrade(you, name, changes)
  }

  const killed = []
  const hits = {}
  const stopCounting = [
    context.bus.on('entity:killed', event => killed.push({
      id: event.entity?.id,
      by: event.source || 'unnamed',
      at: round(context.time)
    })),
    context.bus.on('entity:hurt', event => {
      const key = event.source || 'unnamed'
      const seen = hits[key] || (hits[key] = { hits: 0, damage: 0 })
      seen.hits++
      seen.damage += event.dealt
    })
  ]

  const standing = stand(context, many)
  const started = context.time
  context.engine.simulate(seconds)
  for (const stop of stopCounting) stop()

  const player = context.world.byId('you')
  return {
    seconds,
    ranFrom: round(started),
    to: round(context.time),
    targets: standing.length,
    killed: killed.length,
    survived: context.world.all(TARGET).filter(target => target.damageable?.alive !== false).length,
    deaths: killed,
    byWeapon: Object.fromEntries(
      Object.entries(hits).map(([name, seen]) => [name, { hits: seen.hits, damage: round(seen.damage) }])
    ),
    numbersShown: context.damageNumbers?.shown() ?? 0,
    impact: context.impact?.state(),
    weapons: player
      ? context.autoWeapons.carriedBy(player).map(weapon => ({
          name: weapon.name,
          fired: weapon.fired,
          stats: { ...weapon.stats }
        }))
      : []
  }
}

const round = n => Math.round(n * 100) / 100
