/**
 * Kernel: a moment of a run, taken and put back.
 *
 * `world.capture()` puts the entities back and nothing else. The clock, the random
 * stream and the input record belong to the loop, and a solver keeps its state
 * outside both — so a rewind carrying only the entities leaves a world that looks
 * right and runs wrong, which is the failure the whole of this is about.
 *
 * This is the one place that knows what a whole moment is:
 *
 *   the world   entities, their fields, their behaviours' bags, the shared state
 *   the loop    the step count, the seed and its draw count, held keys, holds
 *   a plugin    whatever it keeps outside the world, asked for by name
 *
 * A plugin declares what it holds in `onLoad` through `checkpoints.add`, in both
 * directions: how to write its state down, and how to put it back. Rapier's solver
 * bytes are the case this exists for. A plugin holding nothing of its own declares
 * nothing and is charged nothing.
 *
 * What a moment cannot carry is named in `lost` rather than dropped, for the same
 * reason `world.capture` names it: a checkpoint that is not exact has to say so.
 *
 * The moment is in memory, not JSON. A solver's bytes are the reason: writing them
 * through JSON would turn a few kilobytes into a string several times the size, and
 * a rewind is a step back inside a run rather than something to store. The reload
 * path keeps its own capture for the other job — a moment that has to survive a page
 * going away — and pays for JSON there because there it is the only route.
 */

/** Bumped when the shape of a moment changes, so an older one is refused rather than misread. */
export const MOMENT_VERSION = 2

/**
 * What each plugin holds, by its own name.
 *
 * A registry rather than a shared object, so two plugins cannot collide over a key
 * and neither has to know the other exists. Mirrors the start-up registry beside it
 * in `start-world.js`: the kernel asks by name, and a plugin that never answers is
 * simply not in the moment.
 *
 * @param {object} bus The bus a refused put-back is announced on.
 * @returns {object} `add`, `names`, `take` and `put`.
 */
export function makeCheckpoints(bus) {
  const entries = new Map()

  const report = (name, error) => {
    const why = `${name} — ${error}`
    console.error(`[checkpoint] ${why}`)
    bus.emit('plugin:error', { name, error: why })
  }

  return {
    /**
     * Declare what this plugin holds.
     *
     * The first registration for a name wins, for the same reason the start-up
     * registry does: `onLoad` runs once per world, and a second call would replace
     * a closure that has been answering correctly with one built over a world that
     * is already gone.
     *
     * @param {string} name The plugin's name.
     * @param {object} entry `capture()` returns the state, or null when there is
     *   nothing to carry; `restore(state)` returns whether it went back.
     */
    add(name, entry) {
      if (entries.has(name)) return
      entries.set(name, entry)
    },

    /** The plugins holding something of their own. */
    get names() { return [...entries.keys()] },

    /**
     * Ask every plugin for what it holds.
     *
     * A plugin that cannot write itself down is named in `lost` and does not stop
     * the rest of the moment being taken: one broken plugin must not cost an agent
     * every checkpoint it takes.
     */
    take() {
      const held = {}
      const lost = []
      for (const [name, entry] of entries) {
        try {
          const state = entry.capture?.()
          // Absent and null both mean "nothing of mine". A solver that has not
          // stepped holds nothing, and that is not a loss.
          if (state === null || state === undefined) continue
          held[name] = state
        } catch (error) {
          lost.push(`${name} could not write down what it holds — ${error?.message || error}`)
        }
      }
      return { held, lost }
    },

    /**
     * Give every plugin back what it held.
     *
     * Every registered plugin is asked, including one the moment holds nothing for
     * — asked with null, which means "hold nothing again". A solver that had not
     * built its bodies when the moment was taken would otherwise keep the bodies of
     * the later run it is standing in, and a rewind would then replay a world with
     * the wrong velocities in it while every entity looked right.
     *
     * A plugin that answers false, or throws, is named rather than silently left
     * where it is: a solver standing at the wrong moment and a world restored
     * around it is the kind of half-restore nobody can debug from the outside.
     *
     * @param {object} [held] The `plugins` half of a moment.
     * @returns {object} `restored` and `refused`, both lists of names.
     */
    put(held = {}) {
      const restored = []
      const refused = []
      for (const [name, entry] of entries) {
        let wentBack = false
        try { wentBack = entry.restore?.(name in held ? held[name] : null) === true }
        catch (error) { report(name, `would not go back — ${error?.message || error}`); refused.push(name); continue }
        if (wentBack) restored.push(name)
        else {
          report(name, 'would not go back to the moment this checkpoint holds')
          refused.push(name)
        }
      }
      // A moment carrying state for a plugin this world does not have. Named, and
      // not a failure: enabling a plugin after a checkpoint was taken is ordinary.
      for (const name of Object.keys(held)) {
        if (entries.has(name)) continue
        report(name, 'holds state in this checkpoint and is not loaded in this world')
        refused.push(name)
      }
      return { restored, refused }
    }
  }
}

/**
 * Take a moment of a whole run.
 *
 * @param {object} parts `world`, `loop` and `checkpoints`.
 * @returns {object} The moment: `version`, `world`, `loop`, `plugins` and every
 *   `lost` entry from all three, in one list to read.
 */
export function captureMoment({ world, loop, checkpoints }) {
  const taken = checkpoints.take()
  const worldPart = world.capture()
  const loopPart = loop.capture()
  return {
    version: MOMENT_VERSION,
    world: worldPart,
    loop: loopPart,
    plugins: taken.held,
    lost: [...worldPart.lost, ...taken.lost, ...scheduledLosses(loopPart.scheduled)]
  }
}

/**
 * Put a whole run back to a moment.
 *
 * The order is the part that has to be right.
 *
 * Restore entities before plugins so a plugin can resolve captured entity ids,
 * including entities that were removed after capture. Plugin restores must not
 * overwrite the captured entity fields.
 *
 * The loop goes last, because everything above can draw from the random stream or
 * schedule a timer while it rebuilds — a body built at the moment of restoration
 * takes a random number, and that draw would leave the stream one past where the
 * captured run had it.
 *
 * @param {object} moment From `captureMoment`.
 * @param {object} parts `world`, `loop` and `checkpoints`.
 * @param {object} [options]
 * @param {Array} [options.input] The input record to resume with, when the caller
 *   holds more of it than the moment does. A moment taken at step sixty cannot
 *   hold the keys pressed at step seventy — they had not happened — so a rewind
 *   that means to replay past its own mark takes the timeline from whoever has it.
 * @returns {object} `entities`, the `plugins` that went back, the `refused`, the
 *   `lost` the moment was taken with, and the `holds` the world is now under.
 */
export function restoreMoment(moment, { world, loop, checkpoints }, { input } = {}) {
  if (moment?.version !== MOMENT_VERSION) {
    throw new Error(`checkpoint version ${moment?.version} is not ${MOMENT_VERSION}`)
  }
  const back = world.restore(moment.world)
  const put = checkpoints.put(moment.plugins)
  loop.resume(input ? { ...moment.loop, input } : moment.loop)
  return {
    entities: back.entities,
    plugins: put.restored,
    refused: put.refused,
    lost: moment.lost,
    // Holds come back with the moment, so a caller can see that the world it just
    // restored is held and by what. A hold whose owner has since finished is let
    // go of with `loop.release(name)`.
    holds: [...loop.holds]
  }
}

/**
 * What a checkpoint can say about a scheduled callback.
 *
 * It cannot keep one: a callback is a closure over whatever scheduled it, and
 * writing that down is not a thing. So the count is carried and reported, and a
 * caller that needs the schedule exact knows this moment is not.
 */
function scheduledLosses(scheduled) {
  if (!scheduled) return []
  const one = scheduled === 1
  return [`${scheduled} scheduled ${one ? 'callback' : 'callbacks'}, which ${one ? 'is a closure' : 'are closures'} and cannot be written down`]
}
