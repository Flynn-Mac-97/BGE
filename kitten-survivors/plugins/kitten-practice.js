/**
 * Kitten Practice — straw kittens to hit, and the two commands that prove a run
 * works without a screen.
 *
 * Nothing here runs on its own. Every verb is a command, so a level never grows
 * practice targets by accident and deleting this file costs the game nothing.
 *
 * `kitten.proof` stands targets around the kitten, arms every weapon, runs the
 * simulation and answers with what died and how. `kitten.arc` plays a real run
 * instead: it takes a card every time the world stops for one, and reports the
 * shape of the run at fixed marks. A run left to itself freezes on the first
 * level-up, because the choice screen holds the world until somebody picks —
 * which is why an unattended simulation needs this and not `simulate` alone.
 */

/** Straw kittens are spawned under this type name. No type file: the mesh is here. */
const TARGET = 'straw kitten'

/** How long the arc runs between looks for a card to take. */
const SLICE = 0.2

/** Cards taken in one look before the arc calls the screen stuck. Level-ups queue. */
const MOST_CARDS = 30

/**
 * Slices in a row that move no clock before the arc gives up.
 *
 * A held loop makes `simulate` a no-op, so a loop that only watches the clock
 * spins forever. Hit stop holds for a few steps at a time and its budget caps it
 * at a third of play, so this is far more than any real hold and short enough to
 * report rather than hang.
 */
const MOST_STILL_SLICES = 30

/**
 * Seconds the arc's kitten takes to come round one full circle when nothing is
 * close enough to run from. Moving keeps it collecting gems.
 */
const CIRCLE_SECONDS = 24

/** How far the arc's kitten looks for something to run from. About half a screen. */
const THREAT_RADIUS = 9

/** How far from the middle of the meadow it lets itself be pushed before turning back. */
const HOME_RADIUS = 20

/**
 * Radians the escape is turned by, so the kitten runs ACROSS the crowd.
 *
 * A straight retreat is caught by anything faster than the kitten, which is
 * every flying family. Fifty degrees off is what a player does instead, and it
 * is the difference between the benchmark measuring the schedule and measuring
 * how badly it steers.
 */
const SIDESTEP = 0.9

/** The four movement keys. The arc presses real keys, so it drives the real input path. */
const STEERING = { right: 'KeyD', left: 'KeyA', up: 'KeyW', down: 'KeyS' }

/** How far off an axis a direction has to lean before its key goes down. */
const KEY_LEAN = 0.383

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
  about: 'Straw kittens to hit, and two commands that prove in a headless run that the weapons kill and that a run has a shape.',
  needs: ['Health', 'Kitten Weapons', 'Choice Screen', 'Run Clock'],

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
    },
    {
      id: 'kitten.arc',
      label: 'Play a run headlessly, take a card at every level, and report its shape',
      /**
       * `run kitten.arc '[180, 15]'` — three minutes, a mark every fifteen seconds.
       *
       * A third argument drafts a build before the run starts, which is how
       * "the peak is survivable" is answered rather than asserted:
       *
       *   run kitten.arc '[150, 30, ["yarn ball", "sharp-teeth", "full-belly"]]'
       */
      run: (context, args) => {
        // The object form too, because every other command takes one. An
        // unknown key is refused rather than defaulted.
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          const unknown = Object.keys(args).filter(key => !['seconds', 'every', 'draft'].includes(key))
          if (unknown.length) {
            throw new Error(`kitten.arc takes seconds, every and draft — not ${unknown.join(', ')}`)
          }
          return playRun(context, Number(args.seconds) || 120,
            Math.max(1, Number(args.every) || 15), args.draft || null)
        }
        const [seconds, every, drafted] = Array.isArray(args) ? args : [args, 15, null]
        if (seconds !== undefined && !Number.isFinite(Number(seconds))) {
          throw new Error(`kitten.arc wants a number of seconds — got ${JSON.stringify(seconds)}`)
        }
        return playRun(context, Number(seconds) || 120, Math.max(1, Number(every) || 15), drafted)
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
  // A run starts with the starter alone; a proof is about all four, so it hands
  // out the rest rather than reporting on a quarter of the game.
  for (const name of context.autoWeapons.defined()) context.autoWeapons.give(you, name)
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

/**
 * Play a real run and report its shape.
 *
 * The choice screen holds the world while a card is on offer, so a plain
 * `simulate` freezes at the first level-up and every reading after it is the
 * same reading. This takes the first card each time, which makes the run
 * repeatable: the offer is drawn from the engine's own stream, so the same seed
 * builds the same kitten.
 */
function playRun(context, seconds, every, drafted) {
  const from = context.time
  const marks = []
  let cards = 0
  let ended = null
  const stopWatching = context.bus.on('run:ended', summary => { ended = summary })

  // Through the same verb a card uses, so a drafted build is a build a player
  // could have picked and not a set of numbers written straight onto a weapon.
  const draft = [].concat(drafted || []).map(id => context.kittenUpgrades.apply(String(id)))

  let stuck = false
  let held = null
  let still = 0
  let nextMark = from
  // The lowest health seen at any slice, not only at a mark: a dip between two
  // marks is exactly the moment the run was hardest.
  let lowest = Infinity
  while (!ended && context.time - from < seconds && !stuck && !held) {
    cards += takeCards(context)
    stuck = context.choiceScreen.isOpen
    const you = context.world.byId('you')
    lowest = Math.min(lowest, Math.round(you?.properties.health ?? Infinity))
    if (context.time >= nextMark) {
      marks.push(mark(context))
      nextMark = context.time + every
    }
    if (you) steer(context, kite(context, you, context.time - from))
    const was = context.time
    context.engine.simulate(SLICE)
    still = context.time > was ? 0 : still + 1
    // Something holds the loop and will not let go, so the clock cannot reach
    // the end of the run. Name the holder rather than spin.
    if (still >= MOST_STILL_SLICES) held = context.loop.holds.join(', ') || 'nothing named'
  }
  stopWatching()
  for (const code of Object.values(STEERING)) context.input.release(code)
  marks.push(mark(context))

  return {
    asked: seconds,
    played: round(context.time - from),
    cards,
    lowestHealth: Number.isFinite(lowest) ? lowest : null,
    // Only the refusals: a drafted id nothing recognised would otherwise be a
    // build that quietly did not happen.
    refused: draft.filter(taken => !taken.ok).map(taken => taken.reason),
    stuck: stuck || undefined,
    heldBy: held || undefined,
    ended: ended ? { clock: ended.clock, reason: ended.reason, kills: ended.kills, level: ended.level } : null,
    carried: context.kittenUpgrades.taken().map(entry => `${entry.name} ${entry.rank}`),
    marks
  }
}

/**
 * Where the arc's kitten runs next: away from whatever is close, across it
 * rather than straight back, and turned toward the middle when it has been
 * pushed to the edge. With nothing near it circles, which keeps it collecting
 * gems.
 *
 * This is a stand-in for a player and it is deliberately a plain one — what it
 * measures is the schedule, so it must not be good enough to hide a wall or bad
 * enough to die to an empty meadow.
 */
function kite(context, you, seconds) {
  let x = 0
  let z = 0
  for (const enemy of context.horde?.near(you.x, you.z, THREAT_RADIUS, []) || []) {
    const awayX = you.x - enemy.x
    const awayZ = you.z - enemy.z
    // Weighted by one over the distance squared, so the thing about to bite
    // decides where to run and the far half of the crowd barely counts.
    const apart = Math.max(0.5, Math.hypot(awayX, awayZ))
    x += awayX / (apart * apart)
    z += awayZ / (apart * apart)
  }

  const out = Math.hypot(you.x, you.z)
  if (out > HOME_RADIUS) {
    x -= you.x / out
    z -= you.z / out
  }

  if (!x && !z) {
    const angle = seconds / CIRCLE_SECONDS * Math.PI * 2
    return { x: Math.cos(angle), z: Math.sin(angle) }
  }
  const sine = Math.sin(SIDESTEP)
  const cosine = Math.cos(SIDESTEP)
  return { x: x * cosine - z * sine, z: x * sine + z * cosine }
}

/** Hold the movement keys that point where `direction` does, and let go of the rest. */
function steer(context, direction) {
  const length = Math.hypot(direction.x, direction.z) || 1
  const x = direction.x / length
  const z = direction.z / length
  // Away from the camera is negative Z, which is what the up key means.
  const wanted = { right: x > KEY_LEAN, left: x < -KEY_LEAN, up: z < -KEY_LEAN, down: z > KEY_LEAN }
  for (const [action, code] of Object.entries(STEERING)) {
    if (wanted[action]) context.input.press(code)
    else context.input.release(code)
  }
}

/** Every card on offer, taken. Level-ups queue, so one look can face several. */
function takeCards(context) {
  let taken = 0
  while (context.choiceScreen.isOpen && taken < MOST_CARDS) {
    context.choiceScreen.pick(0)
    taken++
  }
  return taken
}

/** One reading of the run: the clock, the pressure, and what the kitten has left. */
function mark(context) {
  const you = context.world.byId('you')
  return {
    at: round(context.time),
    clock: context.runClock.clock,
    level: context.experience.level,
    kills: context.horde?.stats.killed ?? 0,
    alive: context.horde?.count ?? 0,
    cap: context.horde?.stats.aliveCap ?? 0,
    health: Math.round(you?.properties.health ?? 0),
    biting: you ? context.horde?.touching(you, 0.05).length ?? 0 : 0
  }
}

const round = n => Math.round(n * 100) / 100
