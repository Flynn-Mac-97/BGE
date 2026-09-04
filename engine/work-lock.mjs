/**
 * Whether agents are working, and so whether anybody else may write.
 *
 * Two writers in one checkout overwrite each other: a person editing the level
 * a lane is building, or a lane's render page saving the level back to disk.
 *
 * The lock is derived, never stored: an active run in the agent registry, or a
 * lane browser whose process is still alive. Nothing has to remember to unlock,
 * because there is no lock to forget.
 *
 * This module decides; it does not enforce. `vite.config.js` consults `permits`
 * at three doors: `POST /api/engine`, `POST /api/file` and
 * `POST /api/agent-file`. A route that reaches disk without asking is not
 * covered by anything here.
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

/** Ops that write a file, whoever asks. */
export const WRITES_A_FILE = new Set([
  'saveLevel', 'new.file', 'code.save', 'set', 'spawn', 'destroy',
  'place.at', 'scene.deleteSelected', 'edit.duplicate'
])

/**
 * The checkout's own `.engine`, whatever project is open. Agent runs and lane
 * browsers belong to the checkout, not to a game — a game may be any directory
 * on disk, and reading the open project's finds nothing and reports a checkout
 * with live lanes as free.
 */
const COORDINATION = '.engine'

/**
 * Whether a process id still exists.
 *
 * Synchronous, because every caller of this module is: the CLI answers "may I
 * edit this" with no server up, and the server asks on every request. A port
 * probe would make all of them async.
 *
 * EPERM means a process with that id exists and belongs to somebody else. A
 * reused id reads as alive, which can only hold the lock longer than it should;
 * `lanes` proves a browser properly by asking its debugging port.
 */
function processAlive(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return false
  try {
    process.kill(id, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Lane browser records split by whether their process still exists. */
function proveLaneBrowsers(browsers) {
  const live = []
  const stale = []
  for (const entry of browsers) {
    if (processAlive(entry.pid)) live.push(entry)
    else stale.push(entry)
  }
  return { live, stale }
}

const staleSentence = stale => {
  if (!stale.length) return ''
  const one = stale.length === 1
  return `Stale lane browser record${one ? '' : 's'}, process gone: ` +
    `${stale.map(entry => entry.id).join(', ')}. Run lanes.stop to clear ${one ? 'it' : 'them'}.`
}

export function workLock(root) {
  const engineDirectory = path.join(root, COORDINATION)
  const runs = readJson(path.join(engineDirectory, 'agents.json'))?.runs || []
  const browsers = readJson(path.join(engineDirectory, 'lane-browsers.json'))?.browsers || []
  const { live, stale } = proveLaneBrowsers(browsers)

  // An agent run records no process id, so there is nothing to prove it
  // against; it ends with agent.release.
  const working = runs.filter(run => run.status === 'active')
  const holders = [
    ...working.map(run => ({ kind: 'run', id: run.id, files: run.files || [], since: run.startedAt })),
    ...live.map(entry => ({ kind: 'browser', id: entry.client, pid: entry.pid, port: entry.port, since: entry.startedAt }))
  ]
  const staleRecords = stale.map(entry => ({
    kind: 'browser',
    id: entry.client,
    pid: entry.pid ?? null,
    port: entry.port,
    why: `process ${entry.pid ?? 'unrecorded'} is gone`
  }))
  const note = staleSentence(staleRecords)

  if (!holders.length) return { locked: false, holders: [], stale: staleRecords, ...(note ? { note } : {}) }
  const names = [...new Set(holders.map(holder => holder.id))]
  return {
    locked: true,
    holders,
    stale: staleRecords,
    why: `${names.length === 1 ? 'a lane is' : `${names.length} lanes are`} working: ${names.join(', ')}. ` +
      `Editing here would change files they are building against. ` +
      `They release with agent.release, and lanes.stop ends a lane browser.` +
      (note ? ` ${note}` : '')
  }
}

/**
 * Whether a client is a lane's render page or the person's editor.
 *
 * Read from the lane browser registry: the server started those browsers and
 * chose their names, so the caller cannot write this answer. What a page says
 * about itself — `navigator.webdriver`, the user agent — is set by whoever
 * launched it and decides nothing.
 *
 * A name with no live record is the person, so an unrecognised caller obeys the
 * work lock. Every real lane has a live record, and a live record holds the
 * lock, so this fallback exempts nobody by mistake.
 */
export function roleOfClient(root, clientId) {
  if (!clientId) return 'person'
  const browsers = readJson(path.join(root, COORDINATION, 'lane-browsers.json'))?.browsers || []
  const record = browsers.find(entry => entry.client === clientId)
  return record && processAlive(record.pid) ? 'lane' : 'person'
}

/**
 * Whether one op may run, for one caller.
 *
 * `role` comes from `roleOfClient`, never from the caller. A lane may play and
 * capture in its own page and may never write a file through this door.
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
