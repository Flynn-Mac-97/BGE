/**
 * Kernel: hold the world until a plugin has finished starting.
 *
 * A plugin cannot finish synchronously what it has to fetch. The world is not
 * handed to a caller who can step it until that work settles, and the wait is
 * bounded so one plugin that hangs cannot stop a world from starting.
 */

/**
 * Wall milliseconds a plugin's declared start-up work may take before the world
 * is handed over without it.
 *
 * A bound rather than a promise that may never settle: one plugin that hangs
 * must not stop a world from starting. What is still pending is named, and the
 * loop holds the world for it, so a run that cannot be exact says so instead of
 * answering anyway.
 */
export const STARTUP_TIMEOUT = 10_000

/**
 * Work a plugin started that has not finished, by name.
 *
 * A plugin cannot finish synchronously what it has to fetch. Rapier compiles two
 * megabytes of WebAssembly, and before this existed the first step ran while it
 * was still loading — so a simulation advanced a world with no physics in it and
 * answered as though it had, and the same level at the same step count produced
 * two different worlds.
 *
 * A plugin calls `add` in `onLoad`, and the world is not handed to a caller who
 * can step it until that promise settles.
 *
 * @param {object} bus The bus a failed start is announced on.
 * @returns {object} `add(name, promise)`, `pending`, and `settled(timeoutMs)`.
 */
export function makeStartup(bus) {
  const starts = new Map()
  const finished = new Set()

  const report = (name, error) => {
    const why = `${name} failed to start — ${error?.message || error}`
    console.error(`[startup] ${why}`)
    bus.emit('plugin:error', { name, error: why })
  }

  return {
    /**
     * Declare one plugin's start-up work.
     *
     * The first promise for a name wins. A module behind a plugin is shared
     * while `onLoad` runs once per world, so a second world must not start a
     * second load, and the wait must not follow the later one.
     */
    add(name, promise) {
      if (starts.has(name)) return starts.get(name)
      // Caught here so a failed start cannot arrive as an unhandled rejection,
      // and so the failure is reported by the name the reader knows.
      const settled = Promise.resolve(promise).then(
        () => {
          finished.add(name)
        },
        error => {
          finished.add(name)
          report(name, error)
        }
      )
      starts.set(name, settled)
      return settled
    },

    /** The names still starting. Empty means the world is ready to step. */
    get pending() {
      return [...starts.keys()].filter(name => !finished.has(name))
    },

    /**
     * Wait for every declared start, bounded.
     *
     * @param {number} [timeoutMs] How long to wait before giving up.
     * @returns {Promise<object>} `ready` and `pending`, both lists of names.
     */
    async settled(timeoutMs = STARTUP_TIMEOUT) {
      const names = [...starts.keys()]
      if (!names.length) return { ready: [], pending: [] }
      let timer = 0
      const expired = new Promise(resolve => {
        timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      })
      await Promise.race([Promise.all([...starts.values()]), expired])
      clearTimeout(timer)
      return {
        ready: names.filter(name => finished.has(name)),
        pending: names.filter(name => !finished.has(name))
      }
    }
  }
}
