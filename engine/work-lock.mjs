/**
 * Whether agents are working, and so whether anybody else may write.
 *
 * Two writers in one checkout is the failure this prevents: a person editing
 * the level a lane is building, or a lane's own render page saving the level
 * back to disk. Both were possible, and both are silent until the file is
 * already wrong.
 *
 * The lock is derived, never stored: an active run in the agent registry, or a
 * recorded lane browser. Nothing has to remember to unlock, because there is
 * no lock to forget.
 */
import fs from 'node:fs'
import path from 'node:path'

const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** Ops that change the project. Everything else answers while locked. */
export const WRITING_OPS = new Set([
  'set', 'spawn', 'destroy', 'select', 'play', 'stop', 'simulate', 'seed',
  'saveLevel', 'place.at', 'new.file', 'code.save', 'scene.deleteSelected',
  'edit.duplicate', 'history.undo', 'history.redo', 'history.jump', 'history.clear'
])

/**
 * Ops a lane's own render page still needs.
 *
 * A lane drives its own page to play a run and take a frame, so those are not
 * writes as far as it is concerned — its world is its own. What it must never
 * do is put anything on disk in the shared checkout.
 */
export const LANE_MAY = new Set(['play', 'stop', 'simulate', 'seed', 'select'])

/** Ops that write a file, whoever asks. */
export const WRITES_A_FILE = new Set([
  'saveLevel', 'new.file', 'code.save', 'set', 'spawn', 'destroy',
  'place.at', 'scene.deleteSelected', 'edit.duplicate'
])

/**
 * `project/.engine` whatever project is being served: agent runs and lane
 * browsers belong to the checkout, not to one game inside it, and the agent
 * registry is written there too. Reading the served project's directory
 * instead finds nothing and reports a checkout with live lanes as free.
 */
const COORDINATION = 'project/.engine'

export function workLock(root) {
  const engineDirectory = path.join(root, COORDINATION)
  const runs = readJson(path.join(engineDirectory, 'agents.json'))?.runs || []
  const browsers = readJson(path.join(engineDirectory, 'lane-browsers.json'))?.browsers || []

  const working = runs.filter(run => run.status === 'active')
  const holders = [
    ...working.map(run => ({ kind: 'run', id: run.id, files: run.files || [], since: run.startedAt })),
    ...browsers.map(entry => ({ kind: 'browser', id: entry.client, port: entry.port, since: entry.startedAt }))
  ]

  if (!holders.length) return { locked: false, holders: [] }
  const names = [...new Set(holders.map(holder => holder.id))]
  return {
    locked: true,
    holders,
    why: `${names.length === 1 ? 'a lane is' : `${names.length} lanes are`} working: ${names.join(', ')}. ` +
      `Editing here would change files they are building against. ` +
      `They release with agent.release, and lanes.stop ends a lane browser.`
  }
}

/**
 * Whether one op may run, for one caller.
 *
 * `role` is 'person' for the editor somebody is looking at, and 'lane' for a
 * render page a lane drives. A lane may play and capture in its own page and
 * may never write a file.
 */
export function permits(lock, op, role = 'person') {
  if (role === 'lane') {
    if (WRITES_A_FILE.has(op)) {
      return { allowed: false, why: `"${op}" writes to the checkout, and a lane render page is a viewer. Its world is its own; the files are not.` }
    }
    return { allowed: true }
  }
  if (!lock.locked) return { allowed: true }
  if (!WRITING_OPS.has(op)) return { allowed: true }
  return { allowed: false, why: `"${op}" is held: ${lock.why}` }
}
