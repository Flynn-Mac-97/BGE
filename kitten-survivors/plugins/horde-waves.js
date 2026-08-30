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
 *   the sweep    anything that has fallen out of the picture is put back on
 *                the edge of it, so the fight stays where the player is looking
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

/**
 * How far past its own spawn band an enemy may drift before it is sent back to
 * the edge of the frame, as a multiple of that band.
 *
 * The kitten runs at 5 and a rat walks at 1.95, so three of the five families
 * cannot keep up and trail off the bottom of the screen. Left alone they hold
 * places under the population cap where nobody can see them: measured at half a
 * minute, 29 of 34 alive were outside the frame and the player was fighting
 * five. Sending them round is what puts the crowd back in the picture.
 */
const BRING_BACK = 1.1
const SWEEP_EVERY = 0.5

/** How hard a return is pulled toward where the kitten is running. Lower than a fresh cluster's, so the same slow rat is not put in its path over and over. */
const BACK_IN_AHEAD = 0.25

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

  const wanted = context.hordeSchedule.waveAt(context.time / 60).weights
  const alive = horde.census()
  const living = Math.max(1, horde.count)

  // Out of sight is measured against the frame, bearing by bearing. The bar is
  // the sweep's, not the band's: an enemy a step outside the picture is on its
  // way in, and deleting it would spend a spawn to gain nothing.
  const outOfSight = []
  for (const entity of horde.enemies) {
    if (entity._hordeOut) continue
    const distance = pastTheBand(context, entity, target)
    if (distance <= BRING_BACK) continue
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

/**
 * Where a cluster is born: one bearing each, pushed out to just past the edge
 * of the frame on that bearing.
 *
 * Spawn Ring picks the bearings, including the pull toward where the kitten is
 * running, so its `cluster` is asked for them at unit distance and each point is
 * then pushed out. Its own band is a circle and the screen is a trapezoid: one
 * radius is either outside the far corners, and so far outside the top and
 * bottom edges that the crowd walks in unseen, or inside the corners, and enemies
 * appear in the middle of the picture.
 *
 * Explicit metres from a caller are obeyed as a plain circle — `horde.spawn hound
 * 12 minimum 30` is asking for a distance, not for the frame.
 */
function ringPoints(context, target, count, options) {
  const bearings = context.spawnRing.cluster(target, count, {
    ahead: options.ahead ?? AHEAD,
    spread: options.spread ?? CLUSTER_SPREAD,
    minimum: 1,
    maximum: 1
  })
  const asked = options.minimum !== undefined || options.maximum !== undefined
  const points = []
  for (const point of bearings) {
    const angle = Math.atan2(point.x - target.x, point.z - target.z)
    const band = asked
      ? { near: options.minimum ?? 0, far: Math.max(options.minimum ?? 0, options.maximum ?? 0) }
      : context.horde.ringToward(angle)
    const distance = context.random.range(band.near, band.far)
    points.push({ x: target.x + Math.sin(angle) * distance, z: target.z + Math.cos(angle) * distance })
  }
  return points
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

  const points = ringPoints(context, target, wanted, options)
  for (const point of points) horde.admit(family, point.x, point.z)
  return points.length
}

/** How far past its own spawn band this enemy has drifted. 1 is on the far edge of the band it would be born on. */
function pastTheBand(context, entity, target) {
  const dx = entity.x - target.x
  const dz = entity.z - target.z
  return Math.hypot(dx, dz) / context.horde.ringToward(Math.atan2(dx, dz)).far
}

/**
 * Everything that has fallen out of the picture, put back on the edge of it.
 *
 * The band is measured per bearing and its near edge is already outside the
 * frame, so anything past `BRING_BACK` of it is off screen whichever way it
 * lies — nothing a player is watching is ever moved.
 */
function bringBackTheLost(context) {
  const horde = context.horde
  const target = horde.target()
  if (!target) return
  const lost = []
  for (const entity of horde.enemies) {
    if (entity._hordeOut) continue
    if (pastTheBand(context, entity, target) > BRING_BACK) lost.push(entity)
  }
  if (!lost.length) return
  // One bearing for the whole batch, as a cluster gets: a wave that re-forms
  // from one side reads as a wave, and one sprinkled evenly round reads as fog.
  const points = ringPoints(context, target, lost.length, { ahead: BACK_IN_AHEAD })
  for (let i = 0; i < lost.length; i++) horde.sendBackIn(lost[i], points[i].x, points[i].z)
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

      if (context.time - clock.sweptAt >= SWEEP_EVERY) {
        clock.sweptAt = context.time
        bringBackTheLost(context)
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
