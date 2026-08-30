/**
 * Horde Waves — the clock. What arrives, when, and from which side.
 *
 * Nothing hostile is placed in `meadow.json` and nothing ever should be. A
 * survivor's crowd arrives on a clock, off the edge of the screen, and the only
 * thing that changes over twenty minutes is how fast the clock runs and what it
 * sends. Horde Schedule holds those numbers; this file spends them.
 *
 * Three things happen here and they are worth separating:
 *
 *   the drip     spawns owed are accumulated and paid out in clusters
 *   the swarm    once a minute, one family from one bearing, all at once
 *   the recycle  at the cap, the furthest over-represented enemies are taken
 *                away so new ones can arrive
 *
 * A cluster is one family on one bearing, so eight crows come in as a flock
 * rather than as eight birds. That is the difference between a wave and a
 * drizzle and it costs nothing.
 */

/** How strongly a spawn is pulled toward where the kitten is running. 1 would be all of it. */
const AHEAD = 0.45
const CLUSTER_SPREAD = 0.4

/** A swarm arrives tighter and further ahead than the drip does. It is meant to be run from. */
const SWARM_SPREAD = 0.5
const SWARM_AHEAD = 0.7

/** How far past the ring an enemy has to be before it is behind the player and pointless. */
const FORGET_BEYOND = 2.4
const FORGET_EVERY = 0.5

/**
 * How many seconds of spawn debt may bank while the meadow is full.
 *
 * Debt held through a full screen is paid the moment recycling makes room, so
 * the crowd snaps back to its cap instead of refilling at the drip's leisure.
 * Forgiveness is measured in seconds of the current rate rather than a flat
 * count — a flat 26 was two seconds of minute twenty, and discarding at that
 * scale is why the crowd used to sit well under its own cap.
 */
const OWED_SECONDS = 4

/** How long the drip rests after the meadow refuses a cluster, so a full screen is not re-asked sixty times a second. */
const REST_WHEN_FULL = 0.3

let clock = null

/**
 * Take the furthest enemies away to make room for new ones.
 *
 * Without this the population cap freezes the crowd: at the cap nothing new can
 * arrive, so minute ten is fought against the rats that spawned in minute two
 * and the schedule stops meaning anything.
 *
 * Only enemies the camera cannot see are taken. One vanishing in view is the
 * worst thing this file could do, and no amount of freshness is worth it. Which
 * ones go is decided by family first: the crowd silts up with whatever survives
 * longest, so the over-represented leave before the rare.
 */
function makeRoom(context, needed) {
  const horde = context.horde
  const target = horde.target()
  if (!target || needed <= 0) return 0

  // Out of sight means out of the camera's sight, not outside the spawn ring.
  // The two are the same on a meadow big enough for the ring; on a small one
  // the ring is pulled inside what the player can see, and recycling against it
  // would delete enemies out of the middle of the screen.
  const beyond = Math.max(horde.ringNear, context.spawnRing.visibleRadius() * 1.15)
  const wanted = context.hordeSchedule.waveAt(context.time / 60).weights
  const alive = horde.census()
  const living = Math.max(1, horde.count)

  const outOfSight = []
  for (const entity of horde.enemies) {
    if (entity._hordeOut) continue
    const distance = Math.hypot(entity.x - target.x, entity.z - target.z)
    if (distance <= beyond) continue
    outOfSight.push({
      entity,
      distance,
      surplus: context.hordeSchedule.surplusOf(entity.type, wanted, alive, living)
    })
  }

  // Over-represented first, worst family first within that, furthest first
  // within a family.
  outOfSight.sort((a, b) => {
    const over = (b.surplus > 0 ? 1 : 0) - (a.surplus > 0 ? 1 : 0)
    if (over) return over
    if (a.surplus > 0 && Math.abs(a.surplus - b.surplus) > 0.01) return b.surplus - a.surplus
    return b.distance - a.distance
  })

  let made = 0
  for (const found of outOfSight) {
    if (made >= needed) break
    if (horde.forget(found.entity)) made++
  }
  return made
}

/** One family, one bearing, count of them. The unit a wave is made of. */
function spawnCluster(context, family, count, options = {}) {
  const horde = context.horde
  const target = horde.target()
  if (!target) return 0

  // A batch sent by hand answers to the hard ceiling only. The climbing cap is
  // the difficulty curve, and somebody typing `horde.spawn hound 40` is not
  // asking the difficulty curve's permission.
  const cap = options.byHand
    ? context.hordeSchedule.mostAlive
    : context.hordeSchedule.aliveCapAt(context.time / 60)

  let room = cap - horde.count
  if (room < count) room += makeRoom(context, count - room)
  const wanted = Math.min(count, Math.max(0, room))
  if (!wanted) return 0

  const points = context.spawnRing.cluster(target, wanted, {
    ahead: options.ahead ?? AHEAD,
    spread: options.spread ?? CLUSTER_SPREAD,
    minimum: options.minimum ?? horde.ringNear,
    maximum: options.maximum ?? horde.ringFar
  })
  for (const point of points) horde.admit(family, point.x, point.z)
  return points.length
}

/** Too far behind to matter. The backstop for anything the recycler never reached. */
function forgetTheLost(context) {
  const horde = context.horde
  const target = horde.target()
  if (!target) return
  const beyond = horde.ringFar * FORGET_BEYOND
  const members = horde.enemies
  for (let i = members.length - 1; i >= 0; i--) {
    const entity = members[i]
    if (entity._hordeOut) continue
    if (Math.hypot(entity.x - target.x, entity.z - target.z) <= beyond) continue
    horde.forget(entity)
  }
}

export default {
  name: 'Horde Waves',
  needs: ['Horde', 'Horde Schedule', 'Spawn Ring', 'Run Clock'],
  about: 'The spawn clock: a steady drip of clusters, a swarm every half minute, recycling from the back so the crowd stays current, and the length of a run.',

  onLoad(context) {
    const begin = () => {
      clock = {
        owed: 0,
        pending: 0,
        restingUntil: 0,
        nextSwarm: context.hordeSchedule.swarmEvery,
        swarms: 0,
        sweptAt: 0
      }
      // A run has an end the player can reach. The horde is what fills those
      // minutes, so its schedule says how many there are: last them and the run
      // ends `survived` instead of only ever ending `died`.
      context.runClock?.limit(context.hordeSchedule.runSeconds)
    }
    begin()
    context.bus.on('level:loaded', begin)
  },

  systems: [{
    phase: 'fixed',
    /**
     * Runs after Horde's death sweep and before Horde Drive's movement, because
     * both of those declare the dependency and the loader keeps that order — so
     * an enemy born this step is steered this step rather than standing still
     * for a frame.
     */
    run(world, seconds, context) {
      const horde = context.horde
      if (!horde || !clock) return
      if (!horde.target()) return

      const schedule = context.hordeSchedule
      const minutes = context.time / 60
      const wave = schedule.waveAt(minutes)

      // Checked against the clock rather than held in a timer, so a level
      // reload cannot leave a swarm pending from the last run.
      if (context.time >= clock.nextSwarm) {
        clock.nextSwarm += schedule.swarmEvery
        clock.swarms++
        const family = schedule.pickFamily(wave.weights, horde.census(), Math.max(1, horde.count))
        spawnCluster(context, family, schedule.swarmSizeAt(minutes), {
          spread: SWARM_SPREAD, ahead: SWARM_AHEAD
        })
      }

      // Whole enemies are owed, then paid out in clusters. Drawing the cluster
      // size once and holding it until it is affordable is what keeps a flock a
      // flock at low spawn rates as well as high ones.
      clock.owed += schedule.rateAt(minutes) * seconds
      if (!clock.pending) {
        const [low, high] = wave.cluster
        clock.pending = context.random.int(low, high)
      }
      if (clock.owed >= clock.pending && context.time >= clock.restingUntil) {
        const family = schedule.pickFamily(wave.weights, horde.census(), Math.max(1, horde.count))
        const sent = spawnCluster(context, family, clock.pending)
        // Paid down by what actually arrived. Subtracting the whole cluster
        // when the cap refused part of it silently discarded the rest, and
        // that discard is why the crowd used to sit well under its own cap.
        clock.owed -= sent
        if (sent < clock.pending) clock.restingUntil = context.time + REST_WHEN_FULL
        clock.pending = 0
      }
      // The meadow being full banks debt rather than discarding it, but only a
      // few seconds' worth — a long lull must not burst all at once.
      const mostOwed = schedule.rateAt(minutes) * OWED_SECONDS
      if (clock.owed > mostOwed) clock.owed = mostOwed

      if (context.time - clock.sweptAt >= FORGET_EVERY) {
        clock.sweptAt = context.time
        forgetTheLost(context)
      }
    }
  }],

  commands: [{
    id: 'horde.spawn',
    label: 'Send a batch in by hand',
    // run horde.spawn '{"family":"hound","count":12}'   or   '["crow", 20]'
    run(context, args) {
      if (!context.horde) return { error: 'Horde did not load' }
      const spec = Array.isArray(args) ? { family: args[0], count: args[1] } : (args || {})
      const family = spec.family || 'rat'
      const families = context.hordeSchedule.families
      if (!families.includes(family)) {
        return { error: `no family "${family}" — one of ${families.join(', ')}` }
      }
      const sent = spawnCluster(context, family, Number(spec.count) || 1, { ...spec, byHand: true })
      return { family, sent, alive: context.horde.count }
    }
  }]
}
