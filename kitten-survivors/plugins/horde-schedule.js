/**
 * Horde Schedule — the difficulty of Kitten Survivors, as four curves and a table.
 *
 * Everything a minute of this game is worth is here and nowhere else. Nothing
 * in this file touches an entity or the world: it answers questions about a
 * number of minutes, so the whole design can be printed without playing it —
 * `run horde.curve` — and tuned by editing eight constants.
 *
 *   rateAt         spawns a second, 2.2 climbing to a cap of 26
 *   aliveCapAt     how many may stand on the meadow at once
 *   healthScaleAt  what an enemy's health is multiplied by
 *   speedScaleAt   the same for speed, with a low ceiling — a horde that
 *                  outruns the kitten is not harder, it is over
 *   SCHEDULE       which families are in the bag, and how heavily
 */

/** Every enemy type this game has, in the order they are unlocked. */
export const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']

/**
 * Which families are in the bag, from which minute, and how big a batch arrives.
 *
 * Weights, not probabilities, so a row is edited by changing one number rather
 * than by rebalancing all of them. Rats fall away but never vanish: the late
 * game still needs chaff, or there is nothing cheap left to kill.
 */
const SCHEDULE = [
  { minute: 0,    cluster: [1, 2], weights: { rat: 10 } },
  { minute: 0.75, cluster: [1, 4], weights: { rat: 10, crow: 5 } },
  { minute: 2,    cluster: [2, 5], weights: { rat: 9, crow: 7, hound: 1 } },
  { minute: 3.5,  cluster: [2, 6], weights: { rat: 7, crow: 7, hound: 2, wasp: 4 } },
  { minute: 5,    cluster: [3, 7], weights: { rat: 6, crow: 6, hound: 3, wasp: 5, boar: 2 } },
  { minute: 7,    cluster: [3, 8], weights: { rat: 4, crow: 6, hound: 4, wasp: 6, boar: 3 } },
  { minute: 10,   cluster: [4, 10], weights: { rat: 3, crow: 5, hound: 5, wasp: 7, boar: 5 } },
  { minute: 14,   cluster: [5, 12], weights: { rat: 2, crow: 5, hound: 6, wasp: 8, boar: 6 } }
]

const RATE_AT_START = 2.2
const RATE_PER_MINUTE = 1.5
const MOST_PER_SECOND = 26

const ALIVE_AT_START = 60
const ALIVE_PER_MINUTE = 55

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

const HEALTH_PER_MINUTE = 0.42
const SPEED_PER_MINUTE = 0.03
const MOST_EXTRA_SPEED = 0.35

/** A named wave every minute: one family, one bearing, all at once. */
const SWARM_EVERY = 60
const SWARM_AT_START = 24
const SWARM_PER_MINUTE = 9

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
      const upTo = Number(Array.isArray(args) ? args[0] : args) || 20
      const rows = []
      for (let minute = 0; minute <= upTo; minute++) {
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
      return { mostAlive: MOST_ALIVE, swarmEvery: SWARM_EVERY, rows }
    }
  }]
}

const round = n => Math.round(n * 1000) / 1000
