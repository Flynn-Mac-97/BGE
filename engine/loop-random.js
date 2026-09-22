/**
 * Kernel: the deterministic random stream.
 *
 * `Math.random` is seeded by the browser and cannot be replayed, so the engine
 * owns its own generator. A stream is a seed and a count of draws, and that pair
 * is all a world put back mid-run needs to rejoin it.
 */

/**
 * How far mulberry32 moves its state on every draw.
 *
 * Named because it is more than an implementation detail: the state advances by
 * this one addition and by nothing else, which is what makes a stream rejoinable
 * at a point without replaying every draw that led there.
 */
const STREAM_STEP = 0x6d2b79f5

/**
 * mulberry32: small, fast, and identical everywhere. The exact algorithm
 * matters less than the fact that it is ours — `Math.random` is seeded by the
 * browser and cannot be replayed.
 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + STREAM_STEP) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The deterministic stream, and the count of draws taken from it.
 *
 * The count is what `random.resume` needs: the state after n draws is the seed
 * plus n stream steps, so a rebuilt world can rejoin the stream where the
 * captured one had reached instead of starting it again.
 */
export function makeRandom(seed) {
  let current = seed
  let drawn = 0
  let generator = mulberry32(current)
  // Counted in one place, so `range`, `int`, `pick` and `chance` are all counted
  // by being written in terms of it. A helper that reached past this would make
  // the count a lie exactly where the stream was used most.
  const next = () => { drawn++; return generator() }

  const random = () => next()
  random.range = (lo, hi) => lo + next() * (hi - lo)
  random.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1))
  random.pick = list => list[Math.floor(next() * list.length)]
  random.chance = p => next() < p
  random.reset = s => { current = s ?? current; drawn = 0; generator = mulberry32(current) }

  /**
   * Rejoin a stream where it had got to, rather than starting it again.
   *
   * The state after n draws from a seed is the seed plus n stream steps, in
   * 32-bit arithmetic and nothing else, so a generator started there gives the
   * same next number the original would have given and every number after it.
   * That is what lets a world be put back mid-run and still be the same run.
   */
  random.resume = (s, n = 0) => {
    current = s ?? current
    drawn = Math.max(0, Math.round(n))
    generator = mulberry32((current + Math.imul(drawn, STREAM_STEP)) >>> 0)
  }

  Object.defineProperty(random, 'seed', { get: () => current })
  /** How many numbers have been taken since the stream was seeded. Half of where it is. */
  Object.defineProperty(random, 'draws', { get: () => drawn })
  return random
}
