/**
 * Kernel: say a message once, then stay quiet.
 *
 * A report site that runs every frame would otherwise repeat the same complaint
 * sixty times a second, and a console that scrolls hides the next real error.
 * Each caller gets its own history, so one caller forgetting its own does not
 * silence another's.
 */

/**
 * Make a reporter holding its own history of said messages.
 *
 * `report(message)` prints the first time a message arrives and drops it after.
 * `clearSaid()` forgets the history, so a message can be said again when the
 * thing it was about has been rebuilt.
 */
export function makeOnceReporter() {
  const said = new Set()
  return {
    report(message) {
      if (said.has(message)) return
      said.add(message)
      console.error(message)
    },
    clearSaid() {
      said.clear()
    }
  }
}
