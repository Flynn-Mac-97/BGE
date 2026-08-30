/**
 * Horde Schedule — the difficulty of Kitten Survivors, as four curves and a table.
 *
 * Everything a minute of this game is worth is here and nowhere else. Nothing
 * in this file touches an entity or the world: it answers questions about a
 * number of minutes, so the whole design can be printed without playing it —
 * `run horde.curve` — and tuned by editing the constants below.
 *
 *   RUN_SECONDS    how long a run lasts before the kitten has survived it
 *   rateAt         spawns a second
 *   aliveCapAt     how many may stand on the meadow at once
 *   healthScaleAt  what an enemy's health is multiplied by
 *   speedScaleAt   the same for speed, with a low ceiling — a horde that
 *                  outruns the kitten is not harder, it is over
 *   SCHEDULE       which families are in the bag, and how heavily
 *
 * **The run is three minutes and the arc is built to be felt at that length.**
 * A row every half minute, a swarm every half minute between them, and each
 * change lands inside the thirty seconds after a card was taken — so a pick and
 * the next escalation are the same beat of the game. The three minutes matter:
 * every curve below is read in minutes and tuned against that length, and
 * changing one without the others gives a run that climbs to nothing.
 */

/** How long the kitten has to last. The run ends `survived` at this many seconds. */
const RUN_SECONDS = 180

/** Every enemy type this game has, in the order they are unlocked. */
export const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']

/**
 * Which families are in the bag, from which half minute, and how big a batch
 * arrives.
 *
 * Weights, not probabilities, so a row is edited by changing one number rather
 * than by rebalancing all of them. Rats fall away but never vanish: the late
 * game still needs chaff, or there is nothing cheap left to kill.
 *
 * Crows open the run rather than rats. The spawn ring is twenty-two metres out
 * and a rat walks at 1.95, so a rat-only opening leaves the kitten with nothing
 * in range for eleven seconds; a crow covers the same ground in four and the
 * first kill lands about two seconds in. Rats are the body of the crowd from
 * the half minute on.
 *
 * Each family enters where it changes what the player has to do: wasps at one
 * minute outrun the kitten, hounds at ninety seconds cannot be shot down on the
 * way in, and the boar at two minutes is the first thing that kills in one hit
 * if it is not dodged.
 */
const SCHEDULE = [
  { minute: 0,   cluster: [2, 3],  weights: { crow: 8, rat: 6 } },
  { minute: 0.5, cluster: [3, 5],  weights: { rat: 10, crow: 6 } },
  { minute: 1,   cluster: [3, 6],  weights: { rat: 9, crow: 6, wasp: 4 } },
  { minute: 1.5, cluster: [3, 7],  weights: { rat: 8, crow: 6, wasp: 5, hound: 2 } },
  { minute: 2,   cluster: [4, 8],  weights: { rat: 6, crow: 6, wasp: 6, hound: 3, boar: 2 } },
  { minute: 2.5, cluster: [4, 9],  weights: { rat: 5, crow: 6, wasp: 7, hound: 4, boar: 3 } },
  { minute: 3,   cluster: [5, 10], weights: { rat: 4, crow: 6, wasp: 8, hound: 5, boar: 4 } }
]

/**
 * Spawns a second. The rate has one job: outpace the weapons.
 *
 * The crowd's size is whichever of two limits binds — the alive cap, or the
 * kill rate. A survivor's screen is meant to be cap-limited, so the rate must
 * beat the kill rate with room to spare in every minute. Measured with a built
 * kitten taking a card at every level: it kills about 5 a second by the third
 * minute, and a drip that falls behind leaves the crowd sagging under its own
 * cap. These numbers hold it at the cap from the first half minute on.
 */
const RATE_AT_START = 2
const RATE_PER_MINUTE = 2.6
const MOST_PER_SECOND = 30

/**
 * The cap is the pressure the player feels, so it carries the shape of the run.
 *
 * Twenty-two on screen at the start is a skirmish the two starting weapons hold
 * without help; a hundred and thirty-six at three minutes is a wall only a
 * built kitten walks out of. A straight line on purpose — the steps the player
 * feels are the schedule rows and the swarms, and a stepped cap on top of those
 * put two beats against each other.
 *
 * Measured: at 22 + 55/min the kitten died at 1:21 whatever it picked, which is
 * a run with no second half. These numbers give a drafted build the full three
 * minutes and an unbuilt one about ninety seconds.
 */
const ALIVE_AT_START = 22
const ALIVE_PER_MINUTE = 38

/**
 * The hard ceiling on live enemies.
 *
 * Measured, and not the simulation's limit. With the real families, the real
 * steering and the real contact pass, packed shoulder to shoulder around a
 * standing kitten: 600 cost 1.4 ms of a 16.7 ms step, 1,600 cost 3.8 ms and
 * 3,200 cost 8.0 ms, and the cost is linear in the population all the way.
 * Twenty minutes of the actual game, with a player moving and a weapon killing,
 * sits at 1.0 ms.
 *
 * The renderer is the other half, and it was measured in Chrome rather than
 * argued about: 602 entities cost 1.1 ms a frame through sync and draw, 202
 * cost 0.56, so the whole game at the cap is about 13% of a 60 Hz frame. Every
 * moving entity is still its own mesh and its own draw call — the batcher only
 * merges what has held still for 45 frames and nothing in a horde ever does —
 * so the number grows with the population and nothing amortises it.
 *
 * 600 is therefore a deliberately conservative cap rather than a wall. It is
 * what a screen can hold and still be read, it leaves most of the frame to the
 * four other lanes, and the GPU half of that measurement was taken in a hidden
 * tab, which is the part I would want measured again before raising it.
 */
const MOST_ALIVE = 600

/**
 * Health and speed over a three-minute run: an enemy at the peak has 2.2 times
 * the health it opened with and moves 27% faster.
 *
 * The speed ceiling is the important one. The kitten runs at 5, a rat at 1.95
 * and a wasp at 6.2; raise the ceiling and every family outruns the kitten,
 * which does not make the run harder, it makes running pointless.
 */
const HEALTH_PER_MINUTE = 0.4
const SPEED_PER_MINUTE = 0.09
const MOST_EXTRA_SPEED = 0.3

/**
 * A named wave every half minute: one family, one bearing, all at once.
 *
 * This is the beat of the run. The drip is a background the player stops
 * noticing; a swarm is a wall arriving from one side that has to be run from,
 * and it is what makes one half minute feel unlike the last. Half a minute
 * because it has to land inside the thirty seconds after a card was taken.
 */
const SWARM_EVERY = 30
const SWARM_AT_START = 10
const SWARM_PER_MINUTE = 14

/**
 * How hard the spawner leans away from a family it already has too many of,
 * and the two ends it is held between.
 *
 * A straight weighted draw is not enough, and the reason is worth writing down.
 * The crowd is capped, so what stands on the meadow is decided by what survives
 * rather than by what spawns — and what survives is the slow families, because
 * the fast ones reach the kitten and get killed. Left alone, minute twenty is
 * two thirds rats however small the rat weight has become, and the schedule
 * stops describing anything.
 *
 * It is a controller with a slow plant, so the gain stays modest or the
 * composition oscillates: a minute of nothing but boars, then a minute with
 * none. A little of that swing is worth keeping — it is what makes one minute
 * feel unlike the last.
 */
const CORRECTION = 2.2
const LEAST_SHARE = 0.15
const MOST_SHARE = 1.7

const rateAt = minutes => Math.min(MOST_PER_SECOND, RATE_AT_START + minutes * RATE_PER_MINUTE)
const aliveCapAt = minutes => Math.min(MOST_ALIVE, Math.round(ALIVE_AT_START + minutes * ALIVE_PER_MINUTE))
const healthScaleAt = minutes => 1 + minutes * HEALTH_PER_MINUTE
const speedScaleAt = minutes => 1 + Math.min(MOST_EXTRA_SPEED, minutes * SPEED_PER_MINUTE)
const swarmSizeAt = minutes => Math.round(SWARM_AT_START + minutes * SWARM_PER_MINUTE)

/** The last row whose minute has passed. */
const waveAt = minutes => {
  let found = SCHEDULE[0]
  for (const row of SCHEDULE) if (minutes >= row.minute) found = row
  return found
}

/** How far a family is above the share the schedule asks of it, from -1 to 1. */
function surplusOf(family, weights, alive, living) {
  let total = 0
  for (const name of FAMILIES) total += weights[name] || 0
  const wanted = (weights[family] || 0) / Math.max(1, total)
  const have = (alive[family] || 0) / Math.max(1, living)
  return have - wanted
}

export default {
  name: 'Horde Schedule',
  about: 'The difficulty of Kitten Survivors: what arrives each minute, how fast, and how tough. Numbers only — it never touches the world.',

  onLoad(context) {
    context.hordeSchedule = {
      families: FAMILIES,
      mostAlive: MOST_ALIVE,
      swarmEvery: SWARM_EVERY,
      runSeconds: RUN_SECONDS,
      waveAt,
      rateAt,
      aliveCapAt,
      healthScaleAt,
      speedScaleAt,
      swarmSizeAt,
      surplusOf,

      /**
       * One family out of the bag, leaning toward whatever there is too little
       * of. `alive` is a count by type and `living` the size of the crowd —
       * handed in, because this file does not read the world.
       */
      pickFamily(weights, alive, living) {
        const names = []
        const scaled = []
        let total = 0
        for (const family of FAMILIES) {
          const weight = weights[family] || 0
          if (!weight) continue
          const lean = Math.min(MOST_SHARE, Math.max(LEAST_SHARE,
            1 - surplusOf(family, weights, alive, living) * CORRECTION))
          names.push(family)
          scaled.push(weight * lean)
          total += weight * lean
        }
        if (!names.length) return FAMILIES[0]

        let roll = context.random() * total
        for (let i = 0; i < names.length; i++) {
          roll -= scaled[i]
          if (roll <= 0) return names[i]
        }
        return names[names.length - 1]
      }
    }
  },

  commands: [{
    id: 'horde.curve',
    label: 'The difficulty curve, minute by minute',
    /**
     * The whole design of the game in one table, without running it:
     *
     *   run horde.curve        twenty minutes
     *   run horde.curve 30     thirty
     */
    run(context, args) {
      const upTo = Number(Array.isArray(args) ? args[0] : args) || RUN_SECONDS / 60
      const rows = []
      // Half minutes, because the schedule and the swarms both step on them.
      for (let minute = 0; minute <= upTo; minute += 0.5) {
        const wave = waveAt(minute)
        rows.push({
          minute,
          perSecond: round(rateAt(minute)),
          aliveCap: aliveCapAt(minute),
          healthScale: round(healthScaleAt(minute)),
          speedScale: round(speedScaleAt(minute)),
          cluster: wave.cluster.join('-'),
          swarm: swarmSizeAt(minute),
          families: Object.entries(wave.weights).map(([f, w]) => `${f}:${w}`).join(' ')
        })
      }
      return { runSeconds: RUN_SECONDS, mostAlive: MOST_ALIVE, swarmEvery: SWARM_EVERY, rows }
    }
  }]
}

const round = n => Math.round(n * 1000) / 1000
