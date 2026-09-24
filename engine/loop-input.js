/**
 * Kernel: the input record and its replay.
 *
 * Input is the one way a run can fail to repeat that arrives from outside. A key
 * is pressed between two steps, so the step it counts for is written down with
 * it: playing a run again means feeding the same events back at the same step
 * counts, not pressing keys again by hand.
 */

/**
 * The record of input events and the keys they leave down.
 *
 * @param {object} options
 * @param {Function} options.step The step count the clock is on now.
 * @returns {object} The record: `press`/`release`/`releaseAll`, `isDown`/`pressed`/
 *   `events`, and the replay calls the loop drives — `applyAt`, `clearPressed`,
 *   `restore` and `clear`.
 */
export function makeInputRecord({ step }) {
  /**
   * Every input event, oldest first, and the keys it leaves down.
   *
   * Stamped with the step count it arrived at rather than a time, so replaying is
   * arithmetic on the step count and survives a rewind. Everything else about
   * input — which keys are down, which were pressed on the step about to run — is
   * derived from this list, so there is one record to carry and no second copy to
   * fall out of step with it.
   */
  let events = []
  let keysDown = new Set()
  let pressedNow = new Set()

  /**
   * How many of the recorded events have reached the keys.
   *
   * A live press is applied where it arrives, so it counts as applied the moment it
   * is written down. A record put back by `resume` is applied up to the step being
   * resumed to, and everything after that step is left for the steps that reach it
   * — which is what makes a run rewound and replayed press the same keys at the
   * same counts instead of running on with a keyboard nobody is touching.
   */
  let applied = 0

  /**
   * Drop recorded events stamped after the step the clock is on.
   *
   * After a rewind the record still holds the old future, and a key pressed now
   * means that future never happened: leaving those events in place would apply
   * them out of order, or apply a run that was abandoned.
   */
  function forgetAfter() {
    const now = step()
    if (!events.length || events[events.length - 1].at <= now) return
    events = events.filter(record => record.at <= now)
    applied = Math.min(applied, events.length)
  }

  /**
   * Apply every recorded event stamped for the step about to run.
   *
   * The record is the run's input as it was played, so replaying it is what makes a
   * rewind a rewind of the same run rather than of a world nobody touched. A live
   * press has already been applied by `press`, which is why the cursor is moved
   * there too: setting a key twice is setting it once, and applying it twice at two
   * different steps is not.
   */
  function applyAt() {
    const now = step()
    while (applied < events.length && events[applied].at <= now) {
      const record = events[applied++]
      if (!record.down) {
        keysDown.delete(record.code)
        continue
      }
      keysDown.add(record.code)
      // Pressed means the step it was stamped for, which is this one.
      if (record.at === now) pressedNow.add(record.code)
    }
  }

  /**
   * Put a recorded input timeline back.
   *
   * @param {Array} records Events as `{ at, code, down }`, oldest first.
   * @param {number} resumeStep The step count being resumed to.
   */
  function restore(records, resumeStep) {
    events = records.map(record => ({ at: record.at, code: record.code, down: record.down }))
    keysDown = new Set()
    pressedNow = new Set()
    applied = 0
    for (const record of events) {
      if (record.at > resumeStep) break
      if (record.down) keysDown.add(record.code)
      else keysDown.delete(record.code)
      applied++
    }
    // Whatever was pressed on the step being resumed to is about to run.
    for (const record of events) if (record.down && record.at === resumeStep) pressedNow.add(record.code)
  }

  return {
    /**
     * Record a key — or a mouse button, or anything else naming an input —
     * going down. Returns whether anything changed, so a caller can tell a
     * fresh press from a repeat.
     */
    press(code) {
      if (keysDown.has(code)) return false
      forgetAfter()
      keysDown.add(code)
      pressedNow.add(code)
      events.push({ at: step(), code, down: true })
      applied = events.length
      return true
    },

    /** Record it coming up, and whether it was down. */
    release(code) {
      if (!keysDown.delete(code)) return false
      forgetAfter()
      events.push({ at: step(), code, down: false })
      applied = events.length
      return true
    },

    /**
     * Let go of everything.
     *
     * A page that loses the window never gets the keyup, and a key stuck down is
     * worse than one dropped — it is the difference between a game that stops
     * and one that walks into a wall for ever.
     */
    releaseAll() {
      const held = [...keysDown]
      if (held.length) forgetAfter()
      for (const code of held) {
        keysDown.delete(code)
        events.push({ at: step(), code, down: false })
      }
      applied = events.length
      pressedNow.clear()
      return held.length
    },

    /** Whether `code` is down now. */
    isDown: code => keysDown.has(code),

    /**
     * Whether `code` went down since the last step — true for exactly one step.
     *
     * A frame is not a step. Clearing this on the frame phase left it true for
     * every one of the six hundred steps a headless `step(600)` runs, while the
     * browser cleared it sixty times a second: one run, two answers.
     */
    pressed: code => pressedNow.has(code),

    /** Every input event, oldest first, stamped with the step it arrived at. */
    get events() {
      return events.map(record => ({ at: record.at, code: record.code, down: record.down }))
    },

    /** Apply every recorded event stamped for the step about to run. */
    applyAt,

    /** A key that went down since the last step is pressed for this one only. */
    clearPressed() {
      pressedNow.clear()
    },

    restore,

    /** Back to nothing, with the clock. */
    clear() {
      events = []
      keysDown = new Set()
      pressedNow = new Set()
      applied = 0
    }
  }
}
