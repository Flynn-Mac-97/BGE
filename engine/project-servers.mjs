/**
 * What this checkout has running, so cleanup is one command instead of a hunt.
 *
 * Split from `project-index.mjs` so a route that only builds the index never
 * loads the server registry. The dev server writes its record from
 * `vite.config.js` and the CLI reads and stops them from `bin/engine.mjs`.
 *
 * Node only: it reads the registry file and asks ports.
 */
import { mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * Where the record lives.
 *
 * Anchored to the MAIN worktree, exactly as the agent run registry is. A lane
 * runs in `.agent-worktrees/<id>`, so a record written there is deleted with the
 * worktree — and the servers most in need of stopping would be the ones nothing
 * remembered. The checkout's own `.engine/`, not a project's: a server belongs
 * to the checkout that started it, and the project may be any directory.
 */
export function serverRegistryFile(checkout) {
  return path.join(process.env.ENGINE_STATE_ROOT || path.join(mainWorktreeOf(checkout), '.engine'), 'servers.json')
}

/** The main worktree of a checkout, so a registry file survives its lane worktree being deleted. */
function mainWorktreeOf(checkout) {
  try {
    const line = execFileSync('git', ['-C', checkout, 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      .split(/\r?\n/).find(value => value.startsWith('worktree '))
    if (line) return path.resolve(line.slice('worktree '.length))
  } catch { /* not a git checkout — this checkout is the right answer */ }
  return path.resolve(checkout)
}

/** The server records for a checkout, or an empty registry when the file is missing or broken. */
export function readServerRegistry(checkout) {
  try {
    const value = JSON.parse(readFileSync(serverRegistryFile(checkout), 'utf8'))
    return { version: 1, servers: Array.isArray(value.servers) ? value.servers : [] }
  } catch { return { version: 1, servers: [] } }
}

/** A registry edit is one read and one rename; a lock older than this is a corpse. */
const STALE_LOCK_MILLISECONDS = 60_000

/**
 * Read, change, write — under a lock, because this file accumulates rather than
 * derives. Two servers starting in the same second would otherwise each write
 * the registry they read before the other existed, and one of them would vanish.
 */
function editServerRegistry(checkout, change) {
  const file = serverRegistryFile(checkout)
  const lock = file + '.lock'
  mkdirSync(path.dirname(file), { recursive: true })
  let handle
  try {
    handle = openSync(lock, 'wx')
  } catch {
    const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
    if (age < STALE_LOCK_MILLISECONDS) throw new Error('another process is updating the server registry; retry in a moment')
    try { unlinkSync(lock) } catch { /* already gone */ }
    handle = openSync(lock, 'wx')
  }
  try {
    const registry = readServerRegistry(checkout)
    const next = change(registry) || registry
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8')
    renameSync(temporary, file)
    return next
  } finally {
    if (handle != null) closeSync(handle)
    try { unlinkSync(lock) } catch { /* already gone */ }
  }
}

/**
 * Write down a server that has just begun listening.
 *
 * The port is the key: one process can hold it at a time, so an older record for
 * the same port is a corpse by definition. Records whose process no longer
 * exists are dropped in the same pass, or a month of crashed servers piles up in
 * a file whose whole value is being short enough to read.
 */
export function recordServer(checkout, server) {
  return editServerRegistry(checkout, registry => ({
    ...registry,
    servers: [
      ...registry.servers.filter(entry => entry.port !== server.port && processIsAlive(entry.pid)),
      server
    ]
  }))
}

/** Forget one server, by the two facts that identify it. */
export function forgetServer(checkout, port, pid) {
  return editServerRegistry(checkout, registry => ({
    ...registry,
    servers: registry.servers.filter(entry => !(entry.port === port && entry.pid === pid))
  }))
}

/**
 * Does this process id exist at all?
 *
 * Signal 0 asks the question without sending anything, on Windows as well as
 * elsewhere. Being refused permission is still an answer: something is there.
 */
export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * Which program owns a process id right now.
 *
 * The operating system hands a dead server's number to whatever starts next, so
 * "the process id in the record still exists" is not the same as "our server is
 * still there". Asking what the number belongs to is what keeps `stop` from
 * killing a stranger.
 */
function processImage(pid) {
  try {
    if (process.platform === 'win32') {
      const row = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim()
      if (!row || !row.startsWith('"')) return null
      return row.slice(1).split('"')[0]
    }
    return execFileSync('ps', ['-o', 'comm=', '-p', String(pid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim() || null
  } catch { return null }
}

/** Whether a process image name is node, the only program a dev server starts as. */
const isNodeProcess = image => /^node(\.exe)?$/i.test(path.basename(image || ''))

/**
 * Ask a port whether an engine dev server is behind it, and what it serves.
 *
 * This is the proof. A record is a note somebody left; a reply is the server
 * saying it is here, which checkout it serves, and which tabs are attached.
 *
 * By the same name every command drives it with. A dev server binds to
 * `localhost`, which resolves to the IPv6 address first on Windows, so asking
 * `127.0.0.1` is refused by a server that is running perfectly — and a running
 * server reported dead is the one answer this must never give.
 */
async function askServer(port, milliseconds = 1500) {
  const stop = AbortSignal.timeout(milliseconds)
  try {
    const response = await fetch(`http://localhost:${port}/api/server`, { signal: stop })
    if (!response.ok) return null
    const said = await response.json()
    return typeof said?.pid === 'number' ? said : null
  } catch { return null }
}

/** How long a recorded server has been up, in whole seconds. */
function uptimeSeconds(entry) {
  return Math.max(0, Math.round((Date.now() - Date.parse(entry.startedAt || 0)) / 1000)) || 0
}

/** Whether an answered server is this exact one: same process, same served directory. */
function isSameServer(answer, entry) {
  return answer.pid === entry.pid && path.resolve(answer.serves || '') === path.resolve(entry.serves || '')
}

function runningServer(seen, entry, answer) {
  return {
    ...seen, state: 'running', alive: true,
    project: answer.project ?? entry.project, tabs: describeTabs(answer.tabs)
  }
}

function replacedServer(seen, entry, answer) {
  return {
    ...seen, state: 'replaced', alive: false,
    answering: { pid: answer.pid, serves: answer.serves, project: answer.project },
    why: `port ${entry.port} answers, but as process ${answer.pid} serving ${answer.serves} — an op sent there would read a different project. `
      + `Nothing on this port is stopped for you; see every engine instance with: node bin/engine.mjs supervisor`
  }
}

function unresponsiveServer(seen, entry) {
  return {
    ...seen, state: 'unresponsive', alive: false,
    why: `process ${entry.pid} is still there but port ${entry.port} answers nothing; it is either still starting or wedged`
  }
}

function deadServer(seen, entry, image) {
  return {
    ...seen, state: 'dead', alive: false,
    why: image
      ? `process ${entry.pid} now belongs to ${image}, so this server is gone and its number has been reused`
      : `process ${entry.pid} is gone`
  }
}

/**
 * One server, as it really is rather than as the file remembers it.
 *
 * Four honest answers, and only the first one means "you can talk to this":
 *   running       the port answers as this exact server
 *   unresponsive  the process is there and is node, but the port says nothing
 *   replaced      something else holds the port; it is named, and never killed
 *   dead          the process is gone, or its number now belongs to another
 *                 program
 *
 * `processAlive` is the raw fact behind all four: whether the recorded pid
 * exists at all. A reader that prunes records needs it, because a server still
 * binding answers nothing while its process is very much there.
 */
async function inspectServer(entry) {
  const answer = await askServer(entry.port)
  const processAlive = processIsAlive(entry.pid)
  const image = processAlive ? processImage(entry.pid) : null
  const seen = { ...entry, processAlive, uptimeSeconds: uptimeSeconds(entry) }

  if (answer) return isSameServer(answer, entry) ? runningServer(seen, entry, answer) : replacedServer(seen, entry, answer)
  if (image && isNodeProcess(image)) return unresponsiveServer(seen, entry)
  return deadServer(seen, entry, image)
}

/**
 * A hidden tab renders nothing, so a capture taken through one comes back
 * blank. It is the single most confusing failure this listing exists to
 * explain, so it is spelled out rather than left as a flag to interpret.
 */
const describeTabs = tabs => (Array.isArray(tabs) ? tabs : []).map(tab => ({
  ...tab,
  ...(tab.hidden ? { why: 'hidden — a hidden tab does not draw, so a capture taken through it comes back blank' } : {})
}))

/**
 * Every server this checkout knows about, proved one by one.
 *
 * `alsoProbe` names ports to ask about even though no record mentions them. The
 * default port belongs on that list: a server nothing wrote down, sitting where
 * every command looks by default, is the exact situation an agent cannot see.
 */
export async function listServers(checkout, alsoProbe = []) {
  const registry = readServerRegistry(checkout)
  const servers = await Promise.all(registry.servers.map(inspectServer))

  const known = new Set(registry.servers.map(entry => entry.port))
  for (const port of alsoProbe) {
    if (!Number.isInteger(port) || known.has(port)) continue
    const answer = await askServer(port)
    if (!answer) continue
    servers.push({
      port, pid: answer.pid, serves: answer.serves, project: answer.project,
      url: `http://localhost:${port}`, startedAt: answer.startedAt,
      state: 'unregistered', alive: true, processAlive: true, tabs: describeTabs(answer.tabs),
      why: `an engine server nothing wrote down is listening on port ${port}, serving ${answer.serves}; `
        + `see and stop it through the supervisor: node bin/engine.mjs supervisor`
    })
  }

  servers.sort((left, right) => left.port - right.port)
  return {
    registry: serverRegistryFile(checkout),
    running: servers.filter(server => server.alive).length,
    servers
  }
}

/** Stop a process and the children it started, and wait for it to actually go. */
export async function endProcess(pid) {
  try {
    if (process.platform === 'win32') {
      // `npm run dev` is the parent of the vite process that holds the port, so
      // the tree is killed rather than the one process — otherwise the shell is
      // left behind holding the terminal.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch { /* it may have died between the check and the kill, which is a win */ }
  for (let attempt = 0; attempt < 20 && processIsAlive(pid); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return !processIsAlive(pid)
}

/** Whether an unregistered server serves inside this checkout. */
function servesThisCheckout(server, checkout) {
  return path.resolve(server.serves || '.').startsWith(mainWorktreeOf(checkout))
}

/**
 * Stop one server, or say why it is left alone.
 *
 * A server that is not ours is reported and left alone — killing whatever
 * happens to hold a port would be a worse bug than the one this fixes.
 */
async function stopOneServer(server, checkout) {
  const named = { port: server.port, pid: server.pid, serves: server.serves, project: server.project }
  if (server.state === 'dead') return { outcome: 'already-dead', named, why: server.why }
  if (server.state === 'replaced') return { outcome: 'refused', named, why: server.why }
  if (server.state === 'unregistered' && !servesThisCheckout(server, checkout)) {
    return { outcome: 'refused', named, why: `nothing here started it and it serves ${server.serves}, which is outside this checkout` }
  }
  const gone = await endProcess(server.pid)
  if (gone) return { outcome: 'stopped', named, was: server.state, tabsAttached: (server.tabs || []).length }
  return {
    outcome: 'refused', named,
    why: `process ${server.pid} would not stop; stop it with ` + 'node bin/engine.mjs supervisor.stop <id>, or by hand'
  }
}

/** Clear the records of every server proved dead, replaced or stopped. */
function forgetServers(checkout, forget) {
  if (!forget.length) return
  editServerRegistry(checkout, registry => ({
    ...registry,
    servers: registry.servers.filter(entry => !forget.some(done => done.port === entry.port && done.pid === entry.pid))
  }))
}

/**
 * Stop one server, or every one of them, and say what actually happened.
 *
 * Safe to run when nothing is running: an empty registry is an empty answer and
 * a clean exit. Records that are proved dead are cleared in the same pass, so
 * running this twice leaves nothing behind.
 */
export async function stopServers(checkout, port = null) {
  const listed = await listServers(checkout, port == null ? [] : [port])
  const targets = port == null ? listed.servers : listed.servers.filter(server => server.port === port)

  const stopped = []
  const alreadyDead = []
  const refused = []
  const forget = []

  for (const server of targets) {
    const outcome = await stopOneServer(server, checkout)
    if (outcome.outcome === 'stopped') stopped.push({ ...outcome.named, was: outcome.was, tabsAttached: outcome.tabsAttached })
    else if (outcome.outcome === 'already-dead') alreadyDead.push({ ...outcome.named, why: outcome.why })
    else refused.push({ ...outcome.named, why: outcome.why })
    if (outcome.outcome !== 'refused' || server.state === 'replaced') forget.push(server)
  }

  forgetServers(checkout, forget)
  return {
    registry: serverRegistryFile(checkout),
    stopped,
    alreadyDead,
    refused,
    ok: refused.length === 0
  }
}
