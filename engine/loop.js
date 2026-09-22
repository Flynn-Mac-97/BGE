/**
 * Kernel: the clock and the run's holds.
 *
 * Physics runs on a fixed step so behaviour is deterministic; rendering runs per
 * frame. Game code never sees the difference — that is why there is an `update`
 * hook and no `fixedUpdate`.
 *
 * The clock reads the wall clock only to measure how fast frames arrive, so the
 * same level replays to the same numbers. The three other ways a run can fail to
 * repeat — `Math.random`, `setTimeout` and input from outside — are owned by
 * `loop-random.js`, `loop-timers.js` and `loop-input.js`, and `engine check`
 * fails a file that reaches around them.
 */
import { round3 } from './round3.js'
import { makeInputRecord } from './loop-input.js'
import { makeRandom } from './loop-random.js'
import { makeTimers } from './loop-timers.js'

const STEP = 1 / 60
const MAX_CATCHUP = 5
const DEFAULT_SEED = 1

/**
 * Wall milliseconds a tick rate is measured over. Long enough that one slow
 * frame is not a verdict, short enough to catch a tab being hidden mid-run.
 */
const RATE_WINDOW = 1000

/**
 * Engine seconds per wall second below which the run is reported as slow.
 *
 * Half speed is not a hitch. Every position, count and timing read while the
 * loop is under this is of a game that has barely moved.
 */
const SLOW = 0.5

/** Wall milliseconds between repeats of the slow-loop report. */
const REPORT_EVERY = 10_000

/** Separates the drawing stream from the simulation's at the same seed. */
const DRAWING_OFFSET = 0x9e3779b9

/**
 * The one clock, the fixed step, the random streams, the input record, the
 * timers and the run's holds.
 *
 * `onFixed(seconds, time)` runs the simulation at exactly 1/60 s a step and
 * `onFrame(seconds, time)` draws. `onStepStart` baselines places before a step
 * moves them, and `onError` catches a timer that threw. Nothing here reads the
 * wall clock except to measure how fast a frame is arriving, so the same level
 * replays to the same numbers.
 *
 * @param {Function} onFixed Runs one fixed step `(seconds, time)`.
 * @param {Function} onFrame Draws one frame `(seconds, time)`.
 * @param {Function} [onError] Called when a timer throws `(error, timer)`.
 * @param {Function} [onStepStart] Baselines entity places before each step.
 * @returns {object} The loop: clock, `random`, `drawing`, `input`, timers, holds
 *   and `step`.
 */
export function makeLoop({ onFixed, onFrame, onError, onStepStart }) {
  let running = false
  // How far the wall clock is past the last fixed step, as a fraction of a step.
  // The renderer draws bodies this far between their last two steps, so motion
  // is smooth at any refresh rate. 1 means draw the current step exactly.
  let blend = 1
  let raf = 0
  let timer = 0
  let last = 0
  let acc = 0

  // The only clock game code ever sees. It advances by exactly STEP per fixed
  // step, never by wall time, so `context.time` reads the same on the tenth replay
  // as on the first — and the same in a backgrounded tab as in a visible one.
  //
  // Derived from an integer count rather than accumulated with `+= STEP`:
  // adding 1/60 six hundred times does not land on 10, and a timer set for
  // exactly 0.25s would then fire a step late.
  let steps = 0
  let fixed = 0

  /**
   * Fixed steps the world is being held still for — the pause a heavy hit lands
   * on, counted in steps rather than seconds so it cannot drift.
   *
   * The clock and the schedule keep running through it. Stopping those would
   * make `context.time` a second clock that disagrees with the first, and every
   * timer already in flight would come out late by however long the game paused.
   * What stops is the simulation: nothing moves, and the frame still draws, so a
   * hit reads as a punch rather than a stutter.
   */
  let held = 0

  const random = makeRandom(DEFAULT_SEED)

  /**
   * A second stream, for anything that only draws.
   *
   * Sharing one stream makes a visual change a gameplay change: adding a dot to
   * a burst shifts every later draw, so enemies spawn somewhere else. Seeded
   * from the same number, so a run still repeats; not resumed by `resume`,
   * because a resumed run has to play the same, not look the same.
   */
  const drawing = makeRandom(DEFAULT_SEED ^ DRAWING_OFFSET)

  const input = makeInputRecord({ step: () => steps })
  const timers = makeTimers({ onError })

  /**
   * Who is holding time still, by name.
   *
   * A survivor stops the world while you choose an upgrade, and a result screen
   * stops it again. Neither can use `stop()`: that kills the frame phase too, so
   * nothing draws and no key is read, and the screen doing the holding goes
   * blank. A held step still runs every system and every update — with a step of
   * zero seconds — so drawing and input carry on while nothing moves.
   *
   * Counted by name rather than a boolean, because two things can hold at once
   * and whichever releases first must not start the world under the other.
   */
  const holds = new Set()

  /**
   * What is driving the frames, and how fast the run is really going.
   *
   * A hidden tab gets no animation frames, so the loop falls back to a timer the
   * browser clamps to roughly one tick a second. MAX_CATCHUP plus `acc = 0` then
   * turn that low tick rate into slow motion rather than dropped frames, and
   * every other number the engine reports — the clock, entity positions,
   * renderer stats — stays healthy while the game runs at a twentieth of real
   * speed. Nothing else measures this, so it is measured here.
   */
  let driver = 'stopped'
  let windowStart = 0
  let windowTicks = 0
  let windowFixed = 0
  let measured = null
  let startedWall = 0
  let startedFixed = 0
  let reportedAt = -Infinity

  /** Start a fresh rate window at `now`; it closes when a full window has passed. */
  const openWindow = now => { windowStart = now; windowTicks = 0; windowFixed = fixed }

  /**
   * Baseline the rate measurement against the clock as it is now.
   *
   * Called wherever the clock is set rather than advanced. Without it, `reset`
   * would put the clock back to zero while the baseline stayed where it was, and
   * the loop would report itself hours behind a wall clock it had never run
   * against.
   */
  function restartMeasuring(now = performance.now()) {
    startedWall = now
    startedFixed = fixed
    measured = null
    reportedAt = -Infinity
    openWindow(now)
  }

  /** Wall seconds the engine clock has lost since play started. */
  const behindBy = () =>
    running ? Math.max(0, (performance.now() - startedWall) / 1000 - (fixed - startedFixed)) : 0

  /**
   * Ticks and engine seconds per wall second.
   *
   * The window still open wins once it has run longer than a full window: a
   * driver that has stopped firing altogether closes no window, and the last
   * closed one would go on reporting the speed the game used to run at. Null
   * before there is anything to divide by.
   */
  function measure() {
    const openSeconds = (performance.now() - windowStart) / 1000
    const sample = openSeconds * 1000 >= RATE_WINDOW
      ? { seconds: openSeconds, ticks: windowTicks, advanced: fixed - windowFixed }
      : measured
    if (!sample || sample.seconds <= 0) return null
    return {
      ticksPerSecond: round3(sample.ticks / sample.seconds),
      gameSpeed: round3(sample.advanced / sample.seconds)
    }
  }

  /** One sentence naming the driver, the rate, and what it costs the reader. */
  const slowSentence = rate =>
    `[loop] the game is running at ${rate.gameSpeed}x real time — driver ${driver} is delivering ` +
    `${rate.ticksPerSecond} ticks a second, and the clock is ${round3(behindBy())}s behind the wall ` +
    `clock. Every reading taken while this holds is of a game that has barely moved.`

  /**
   * Say it once, then no more often than REPORT_EVERY while it holds.
   *
   * Through `console.error` because that is the channel `snapshot().errors`
   * reads, and a loop this slow makes every other number in the snapshot wrong.
   */
  function reportIfSlow(now) {
    const rate = measure()
    if (!rate || rate.gameSpeed >= SLOW) { reportedAt = -Infinity; return }
    if (now - reportedAt < REPORT_EVERY) return
    reportedAt = now
    console.error(slowSentence(rate))
  }

  /**
   * One fixed step: baseline places, advance the clock, run due timers, and run
   * the simulation unless something is holding it.
   *
   * A named hold still calls `onFixed(0)`, so a paused game draws and reads
   * input while nothing moves; hit stop skips the simulation for a few steps
   * while the clock keeps running underneath it.
   */
  function fixedStep() {
    // Every step, held or not, so a frozen body has no gap to draw across.
    onStepStart?.()
    // Before the step runs, and on every path: a held step is exactly where a
    // choice screen reads a key.
    input.applyAt()
    // Held: the clock does not move, so no timer comes due and `context.time`
    // reads the same on the far side of a pause. The step still runs, because a
    // paused game is still a game being looked at.
    try {
      if (holds.size) { onFixed(0, fixed); return }
      fixed = ++steps * STEP
      timers.run(fixed)
      if (held > 0) { held--; return }
      onFixed(STEP, fixed)
    } finally {
      // A key that went down since the last step reads as pressed for this step
      // and not for the next. Cleared on every path out, because a held step is
      // exactly where a choice screen reads the key that picks.
      input.clearPressed()
    }
  }

  // Animation frames only exist in a browser. Outside one there is no screen to
  // be in step with, so the timer drives every frame — and step() below, the
  // path that matters for headless work, touches none of this.
  const canAnimate = typeof requestAnimationFrame === 'function'
  /** Whether animation frames are the driver: a browser, and a visible tab. */
  const onScreen = () => canAnimate && !document.hidden

  /** Animation frames while visible, a timer while not. */
  function schedule() {
    if (canAnimate) cancelAnimationFrame(raf)
    clearInterval(timer)
    timer = 0
    if (!running) { driver = 'stopped'; return }
    if (onScreen()) {
      driver = 'requestAnimationFrame'
      raf = requestAnimationFrame(tick)
    } else {
      // Named for the cause. "The tab is hidden" is the one fact an agent cannot
      // see, and every symptom of it points at the renderer instead.
      driver = canAnimate ? 'setInterval (tab hidden)' : 'setInterval (no animation frames)'
      timer = setInterval(() => tick(performance.now()), 16)
    }
  }

  // Switching tabs mid-play swaps drivers rather than stalling.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (running) schedule() })
  }

  /**
   * A tab whose dev server is gone stops simulating.
   *
   * The page cannot reload and cannot be driven any more, but the world kept
   * stepping and drawing behind the disconnection notice. A dream run leaves
   * many such tabs, and each one holds a whole scene on the graphics card.
   */
  if (import.meta.hot) {
    import.meta.hot.on('vite:ws:disconnect', () => {
      running = false
      driver = 'stopped (the dev server is gone)'
      if (canAnimate) cancelAnimationFrame(raf)
      clearInterval(timer)
      timer = 0
    })
  }

  /**
   * One animation frame or timer tick: run the fixed steps the elapsed wall
   * time has earned, up to MAX_CATCHUP, then draw.
   *
   * Past MAX_CATCHUP the backlog is dropped rather than replayed, so a stall
   * becomes slow motion instead of a spiral of catch-up steps.
   */
  function tick(now) {
    if (!running) return
    if (onScreen()) raf = requestAnimationFrame(tick)
    windowTicks++

    const seconds = Math.min((now - last) / 1000, 0.25)
    last = now
    acc += seconds

    // Named `catchup`, not `steps`: the outer `steps` is the run's total step
    // count and the clock is derived from it, so shadowing it here would be a
    // very quiet way to break time.
    let catchup = 0
    while (acc >= STEP && catchup < MAX_CATCHUP) {
      fixedStep()
      acc -= STEP
      catchup++
    }
    if (catchup === MAX_CATCHUP) acc = 0
    blend = catchup === MAX_CATCHUP ? 1 : acc / STEP

    onFrame(seconds, fixed)

    if (now - windowStart >= RATE_WINDOW) {
      measured = { seconds: (now - windowStart) / 1000, ticks: windowTicks, advanced: fixed - windowFixed }
      openWindow(now)
      reportIfSlow(now)
    }
  }

  return {
    get running() { return running },

    /** Engine time in seconds. Not the wall clock, on purpose. */
    get time() { return fixed },
    get elapsed() { return fixed },

    /**
     * Fixed steps run. The clock is derived from this, so this is the honest
     * form of "where the clock is" — a time in seconds is a rounding of it and
     * would not survive a round trip.
     */
    get steps() { return steps },

    /** The fraction of a step the frame being drawn is past the last one. See `blend` above. */
    get blend() { return blend },

    random,
    drawing,

    // ---- input, recorded against the step it counts for ----

    /**
     * The input record.
     *
     * Its own object rather than methods on the loop, because the loop already
     * has a `release` — the one that lets go of a hold on time — and a second
     * `release` would have silently replaced it.
     */
    input,

    /** Stop time under this name. Naming it is what lets two holders overlap. */
    hold(reason = 'paused') { holds.add(reason); return reason },
    release(reason = 'paused') { return holds.delete(reason) },
    get paused() { return holds.size > 0 },
    /** Who is holding, so "why is nothing moving" is answerable from a snapshot. */
    get holds() { return [...holds] },

    /**
     * What is driving the frames and how fast the run is really going.
     *
     * `gameSpeed` is engine seconds per wall second, so 1 is real time and 0.05
     * is the hidden-tab case. `warning` is present only when the run is under
     * SLOW; the same sentence goes to `console.error`, which puts it in
     * `snapshot().errors`.
     *
     * The rate fields are absent until a window has closed, and while stopped,
     * because a made-up zero reads as a stalled game.
     */
    get state() {
      if (!running) return { driver: 'stopped' }
      const rate = measure()
      const out = { driver, ...(rate || {}), behindSeconds: round3(behindBy()) }
      if (rate && rate.gameSpeed < SLOW) out.warning = slowSentence(rate)
      return out
    },

    /**
     * Start playing.
     *
     * A hidden tab gets no animation frames, so play mode would report itself
     * as running while nothing moved — the most confusing possible state to
     * hand an agent. A timer takes over when the tab is not visible. Browsers
     * clamp background timers to about a second, and MAX_CATCHUP turns that into
     * slow motion rather than dropped frames, so read `state` for the driver and
     * the measured speed. The deterministic answer for headless work is still
     * `step()`.
     */
    start() {
      if (running) return
      running = true
      last = performance.now()
      acc = 0
      restartMeasuring(last)
      schedule()
    },

    /** Stop the loop and its driver. The clock and both streams keep their values. */
    stop() {
      running = false
      blend = 1
      driver = 'stopped'
      if (canAnimate) cancelAnimationFrame(raf)
      clearInterval(timer)
      timer = 0
    },

    /**
     * Back to zero: clock, schedule, input and random stream together.
     *
     * Called when a level loads. Resetting only some of them is the subtle
     * version of the bug this module exists to prevent.
     */
    reset(seed = DEFAULT_SEED) {
      steps = 0
      fixed = 0
      acc = 0
      held = 0
      timers.clear()
      // A hold left over from the last run would open the next level frozen,
      // with nothing on screen saying why.
      holds.clear()
      // Input goes back to nothing with the clock. A level that opened with a key
      // already down would not start the same way twice, and reset exists so that
      // two runs of one level begin alike.
      input.clear()
      random.reset(seed)
      drawing.reset((seed ?? random.seed) ^ DRAWING_OFFSET)
      restartMeasuring()
    },

    /**
     * Pick a run up where it was, without having run it.
     *
     * Deliberately not part of `reset`. Resetting means "this is the beginning",
     * and it has to go on meaning only that — a clock that could be set by
     * accident is a clock nothing can be reasoned from. This is the other thing:
     * a world was captured mid-run and rebuilt somewhere else, and the clock and
     * the random stream have to arrive at the same place the entities did or
     * every reading taken afterwards is quietly wrong.
     *
     * The step count is what is restored, not a time in seconds, because the
     * clock is derived from the count — restoring a rounded time would leave the
     * two disagreeing from the next step onwards.
     *
     * Timers already in flight were scheduled against the old clock, so they
     * move with it: one due in half a second is still due in half a second.
     *
     * A named hold and hit stop come back too, because both are why the run was
     * where it was: a moment taken while a choice screen held the world would
     * otherwise be put back as a world that runs on. Both are optional, so a
     * caller that only has a clock and a stream — the reload path — says what it
     * has and nothing else is touched.
     *
     * @param {object} [where]
     * @param {number} [where.steps] The step count to resume to.
     * @param {number} [where.seed] The seed the stream was on.
     * @param {number} [where.draws] How many draws had been taken from it.
     * @param {Array} [where.input] Input events as `{ at, code, down }`.
     * @param {string[]} [where.holds] The names time was being held under.
     * @param {number} [where.hitStop] Fixed steps of hit stop left.
     * @param {number} [where.scheduled] Captured callback count; clears the schedule when present.
     */
    resume({ steps: to = 0, seed, draws = 0, input: inputRecords, holds: holdNames, hitStop, scheduled } = {}) {
      const target = Math.max(0, Math.round(to))
      const shift = (target - steps) * STEP
      steps = target
      fixed = steps * STEP
      acc = 0
      // Full checkpoints cannot carry closures. A clock-only reload retains
      // its rebuilt schedule; a checkpoint discards the abandoned schedule.
      if (scheduled !== undefined) timers.clear()
      else timers.shiftBy(shift)
      random.resume(seed ?? random.seed, draws)
      if (holdNames) { holds.clear(); for (const reason of holdNames) holds.add(reason) }
      if (hitStop !== undefined) held = Math.max(0, Math.round(hitStop))
      // A world picked up mid-run was played with a key held, and the step about
      // to run sees whatever was pressed on it. Carried rather than re-pressed,
      // because the person who pressed it is not here to do it again.
      if (inputRecords) input.restore(inputRecords, target)
      restartMeasuring()
      return { time: fixed, steps, seed: random.seed, draws: random.draws }
    },

    /**
     * Everything about the loop a checkpoint has to carry.
     *
     * The step count, not a time in seconds, because the clock is derived from the
     * count. The seed and the draw count, not the stream's position, because that
     * pair is what `resume` rejoins the stream from. The input record, because the
     * keys held at a step are what the next step reads.
     *
     * `scheduled` is a count, not the timers: a scheduled callback is a closure and
     * cannot be written down, so a checkpoint holding one can only say how many it
     * could not keep.
     *
     * The drawing stream is not here. It decides what a run looks like and not
     * what it does, and a resumed run has to play the same rather than look the
     * same. Neither is whether frames are arriving: the driver does not change
     * what a step does, and starting one is `start()`.
     */
    capture() {
      return {
        steps,
        seed: random.seed,
        draws: random.draws,
        holds: [...holds],
        // In fixed steps, because that is what the loop counts it in, and hit
        // stop is a whole number of steps by construction.
        hitStop: held,
        scheduled: timers.count(),
        input: input.events
      }
    },

    /**
     * Hold the world still for `seconds`, then carry on where it left off.
     *
     * This is hit stop: the two or three frames a game freezes on so a heavy
     * blow lands as a blow. It is deliberately not a general time scale — a
     * fraction of a fixed step is not a fixed step, and the determinism this
     * module exists to protect rests on every step being the same size.
     *
     * The longest hold wins rather than the newest, so two hits in one step do
     * not shorten each other.
     *
     * Named apart from `hold(reason)` above because the two are different
     * things wearing one word. A pause stops the clock; hit stop lets it run,
     * so a cooldown started before the punch still comes due on time. Both
     * arrived in the same week from different lanes, and as one `hold` the
     * later definition silently won and the pause never happened.
     */
    holdFor(seconds = 0) {
      held = Math.max(held, Math.round(Math.max(0, seconds) / STEP))
      return held * STEP
    },

    /** Seconds of hold left. Zero when the world is running normally. */
    get holding() { return held * STEP },

    // ---- scheduling, on the fixed clock ----

    /** Run `fn` once, `seconds` of engine time from now. */
    after(seconds, fn) { return timers.after(seconds, fixed, fn) },

    /** Run `fn` every `seconds` of engine time, starting one interval from now. */
    every(seconds, fn) { return timers.every(seconds, fixed, fn) },

    /** Cancel one scheduled timer. Returns whether it was still pending. */
    cancel(id) { return timers.cancel(id) },

    get timers() { return timers.list(fixed) },

    /**
     * Advance by N fixed steps, ignoring wall clock and requestAnimationFrame
     * entirely.
     *
     * This is how the game is tested without watching it: deterministic, runs
     * in a backgrounded tab, and gives an agent a way to say "play for two
     * seconds and tell me where the player ended up".
     */
    step(count = 1) {
      for (let i = 0; i < count; i++) fixedStep()
      // A stepped world is read as it is, not between steps.
      blend = 1
      onFrame(STEP * count, fixed)
      return fixed
    }
  }
}


/** One fixed step, in engine seconds. */
export const FIXED_STEP = STEP
