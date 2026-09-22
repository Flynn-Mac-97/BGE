/**
 * The opt-in switch for Jev.
 *
 * Default off. The switch is one project-relative file, so a person turns it on
 * for a game and every agent working in that game gets the assistance, while a
 * checkout that never turns it on makes no network call. A missing or broken
 * file means off.
 */
export const MODE_FILE = '.engine/jev.json'

/** Whether the stored text switches Jev on. */
export function modeFrom(text) {
  try { return JSON.parse(String(text)).enabled === true } catch { return false }
}

/** The one file body for a mode. */
export const modeText = enabled => JSON.stringify({ enabled: enabled === true }, null, 2) + '\n'

/** The stored mode, read through a project-relative reader. */
export async function readMode(read) {
  try { return modeFrom(await read(MODE_FILE)) } catch { return false }
}
