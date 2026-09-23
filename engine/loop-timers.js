/**
 * Kernel: timers on the fixed clock.
 *
 * `setTimeout` runs on wall time, so a run would depend on how fast the machine
 * is. The engine schedules in fixed steps instead: a timer is due at a step
 * count, which is why a clock put back by a rewind moves its timers with it.
 */
import { round3 } from './round3.js'

/**
 * The schedule, on the fixed clock.
 *
 * @param {object} [options]
 * @param {Function} [options.onError] Called when a timer throws `(error, timer)`.
 * @returns {object} `after`/`every`/`cancel`, and the calls the loop drives:
 *   `run`, `clear`, `shiftBy`, `count` and `list`.
 */
export function makeTimers({ onError } = {}) {
  let timers = []
  // Ids keep rising across a reset, so an id from an old run cannot match a new
  // timer and cancel it.
  let nextId = 1

  /**
   * Run every timer that has come due, on the fixed clock.
   *
   * The list is copied before walking it, because a callback may add or cancel
   * a timer. An interval counts from its start rather than adding to its last
   * due time, so it cannot drift over a long run.
   */
  function run(now) {
    if (!timers.length) return
    // Snapshot first: a callback may add or cancel timers, and mutating the
    // list mid-walk is how a scheduler quietly drops one.
    for (const t of [...timers]) {
      if (t.cancelled || now < t.at) continue
      try {
        t.fn()
      } catch (e) {
        onError?.(e, t)
      }
      // Count intervals from the start rather than adding to `at`, so a
      // repeating timer cannot accumulate error over a long run.
      if (t.every && !t.cancelled) t.at = t.start + ++t.n * t.every
      else t.cancelled = true
    }
    if (timers.some(t => t.cancelled)) timers = timers.filter(t => !t.cancelled)
  }

  return {
    /** Run `fn` once, `seconds` of engine time from `now`. */
    after(seconds, now, fn) {
      const t = { id: nextId++, start: now, n: 1, at: now + seconds, every: 0, fn, cancelled: false }
      timers.push(t)
      return t.id
    },

    /** Run `fn` every `seconds` of engine time, starting one interval from `now`. */
    every(seconds, now, fn) {
      const t = { id: nextId++, start: now, n: 1, at: now + seconds, every: seconds, fn, cancelled: false }
      timers.push(t)
      return t.id
    },

    /** Cancel one scheduled timer. Returns whether it was still pending. */
    cancel(id) {
      const t = timers.find(x => x.id === id)
      if (t) t.cancelled = true
      return !!t
    },

    run,

    /** Forget every timer, leaving the id counter where it is. */
    clear() {
      timers = []
    },

    /** Move every pending timer with a clock that was put back or picked up. */
    shiftBy(delta) {
      for (const t of timers) {
        t.start += delta
        t.at += delta
      }
    },

    /** How many timers are still pending, for a checkpoint that cannot carry a closure. */
    count() {
      return timers.filter(t => !t.cancelled).length
    },

    /** The pending timers as `{ id, in, every }`, `in` measured from `now`. */
    list(now) {
      return timers
        .filter(t => !t.cancelled)
        .map(t => ({ id: t.id, in: round3(t.at - now), every: t.every || undefined }))
    }
  }
}
