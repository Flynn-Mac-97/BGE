/**
 * Kernel: the way back through a run.
 *
 * `checkpoint.js` takes one moment and puts it back. An agent working a run needs
 * the last minute of it and needs to reach a step rather than a mark — "step back
 * sixty frames", "go to step 900" — so this keeps a ring of moments and walks to a
 * count.
 *
 * A moment costs about 0.3 ms to take and 78 KB for forty bodies under Rapier, so a
 * mark every step is out of the question. A mark is taken every `stride` steps and
 * `to(count)` restores the newest mark at or before that count and steps the rest of
 * the way, which is exact because the clock, the stream and the input record come
 * back with the mark. The cost of a seek is the steps between the mark and the
 * target, and nothing else.
 *
 * The input record is the part a mark cannot hold. A moment taken at step sixty
 * holds the keys pressed up to step sixty; the key pressed at seventy had not
 * happened yet. So a rewind takes the timeline from whoever has the whole of it —
 * the loop — and steps the segment again with the same keys going down at the same
 * counts. That is what makes a seek a rewind of the run rather than of a world
 * nobody touched.
 *
 * A mark is a moment of the whole world, so going back past an edit undoes the edit
 * with it. That is the honest reading of "step back", and it is said here because
 * the alternative reading — an entity's edit surviving a rewind — is the one an
 * agent would otherwise assume.
 */
import { captureMoment, restoreMoment } from './checkpoint.js'

/**
 * Marks held before the oldest is dropped.
 *
 * Two minutes of a run at the default stride, and about ten megabytes of solver
 * bytes in a scene with forty bodies in it. Deep enough that an agent can step back
 * through the last thing it did, shallow enough that a long run does not grow.
 */
const DEPTH = 120

/**
 * Steps between automatic marks.
 *
 * One stride of replay is what a seek to an unmarked count costs: at the default it
 * is at most a second of simulation, which is milliseconds in a scene with no solver
 * in it and tens of milliseconds in one with forty bodies.
 */
const STRIDE = 60

/**
 * The ring, and the walking.
 *
 * @param {object} parts `world`, `loop` and `checkpoints`.
 * @param {object} [options]
 * @param {number} [options.depth] Marks held before the oldest is dropped.
 * @param {number} [options.stride] Steps between automatic marks.
 * @param {object} [options.bus] Where a world being replaced is announced. The ring
 *   listens for the two events that mean its marks describe a world that is gone.
 * @returns {object} `mark`, `marks`, `to`, `back`, `clear`, `observe`, `stride`,
 *   `depth` and `length`.
 */
export function makeRewind({ world, loop, checkpoints, bus, depth = DEPTH, stride = STRIDE }) {
  const parts = { world, loop, checkpoints }

  /** Oldest first. Each is `{ steps, moment }`, and every one is a whole moment. */
  let marks = []
  /** The count the newest mark was taken at, so the observer does not take twins. Null before the first. */
  let newest = null

  /** Take a moment now, and keep it until the ring is deeper than it holds. */
  function mark() {
    const at = loop.steps
    marks.push({ steps: at, moment: captureMoment(parts) })
    while (marks.length > depth) marks.shift()
    newest = at
    return at
  }

  /** The newest mark at or before `steps`, or null when the ring does not reach back that far. */
  const newestAtOrBefore = steps => {
    for (let at = marks.length - 1; at >= 0; at--) if (marks[at].steps <= steps) return marks[at]
    return null
  }

  /**
   * Go back to a step count.
   *
   * The newest mark at or before the count is put back and the rest of the way is
   * stepped, which is the same run by construction. Everything after the count is
   * abandoned: the marks taken in it are dropped, because the timeline the run is
   * on has just been rewritten.
   *
   * Going forward is refused with the verb to use instead. It would be a rewind and
   * a replay of a future that has not happened, and `simulate` already steps.
   *
   * @param {number} steps The step count to go back to.
   * @returns {object} `from`, `to`, the `mark` used, the `replayed` steps, where the
   *   clock actually ended up, and why not when it did not land.
   */
  function to(steps) {
    const from = loop.steps
    const wanted = Number(steps)
    if (!Number.isFinite(wanted)) return { from, to: steps, reached: false, why: `${steps} is not a step count` }
    const target = Math.max(0, Math.round(wanted))
    if (target > from) {
      return { from, to: target, reached: false, why: `step ${target} has not happened — the clock is at ${from}. Step forward with simulate instead of seeking to it.` }
    }
    if (target === from) return { from, to: target, reached: true, replayed: 0, at: from }

    const mark = newestAtOrBefore(target)
    if (!mark) {
      return {
        from, to: target, reached: false,
        why: marks.length
          ? `the ring reaches back to step ${marks[0].steps} and no further`
          : 'this run has no marks — nothing has stepped since the level opened'
      }
    }

    const replayed = target - mark.steps
    // A replay must not be stepped through by the frame driver at the same time: a
    // tick landing mid-replay would advance a world being rebuilt. Starting it
    // again afterwards is the caller's loop, not a second kind of play.
    const wasRunning = loop.running
    if (wasRunning) loop.stop()
    let back = null
    try {
      // The timeline, not the mark's copy of it: the keys pressed after the mark are
      // what the segment being replayed did with its keyboard.
      back = restoreMoment(mark.moment, parts, { input: loop.input.events })
      if (replayed > 0) loop.step(replayed)
    } finally {
      if (wasRunning) loop.start()
    }

    // The future the run was on is gone: a mark taken in it describes a world that
    // no longer follows from this one. The stride counts from the newest mark left,
    // so marks go on being taken where the clock now is.
    marks = marks.filter(one => one.steps <= mark.steps)
    newest = marks.length ? marks[marks.length - 1].steps : null

    const at = loop.steps
    const reached = at === target
    return {
      from, to: target, reached, mark: mark.steps, replayed, at,
      // Named, because a solver that would not go back leaves a world that reads as
      // rewound and runs as the later one.
      ...(back.refused.length ? { refused: back.refused } : {}),
      ...(back.lost.length ? { lost: back.lost } : {}),
      // A held clock is why a replay stops short: the steps run, and the count does
      // not move. Named, because "it did not get there" is otherwise read as a
      // broken seek rather than as a paused game.
      ...(reached ? {} : { heldBy: loop.holds })
    }
  }

  return {
    stride,
    depth,
    get length() { return marks.length },

    /**
     * Every mark held, oldest first.
     *
     * The counts and nothing else: a moment is hundreds of kilobytes, and a reader
     * asking what it can go back to wants the counts.
     */
    get marks() { return marks.map(one => ({ steps: one.steps })) },

    /** The oldest count the ring can reach, or null when it holds nothing. */
    get oldest() { return marks.length ? marks[0].steps : null },

    mark,

    /** Throw the ring away. The moments go with it. */
    clear() {
      marks = []
      newest = null
    },

    /**
     * Called once per fixed step, before the step runs.
     *
     * The count is read before the step because a mark describes the world at the
     * count the clock reads: a mark taken inside a step would be a world that has
     * already moved and a clock that says it has not, and replaying it would skip
     * the step it was taken in.
     *
     * An empty ring marks on the first step whatever the stride, so a world always
     * has one mark behind it — the one the level opened with.
     */
    observe() {
      if (newest !== null && loop.steps - newest < stride) return 0
      return mark()
    },

    to,

    /** Go back `count` steps from where the clock is. */
    back(count = 1) {
      const wanted = Math.max(1, Math.round(Number(count) || 1))
      return to(loop.steps - wanted)
    }
  }
}

/**
 * Wire the ring to the two events that mean its marks describe a world that is gone.
 *
 * A level load and a restored page both replace every entity, so a mark taken before
 * either would put back entities the world no longer has. Both clear the ring, and
 * the next step marks where the new world starts.
 *
 * The mark waits for that step rather than being taken here, and that is the whole
 * reason this is two lines instead of three. A plugin resets what it owns when it
 * hears the same event — Run Clock puts its clock back to zero on `level:loaded` —
 * and this listener is registered before the plugins load, so a mark taken here would
 * hold the state of the world that just ended. The step after the event has every
 * listener's answer in it.
 *
 * @param {object} rewind From `makeRewind`.
 * @param {object} bus The bus those two events are announced on.
 * @returns {void}
 */
export function watchWorldChanges(rewind, bus) {
  const restart = () => rewind.clear()
  bus.on('level:loaded', restart)
  bus.on('world:restored', restart)
}
