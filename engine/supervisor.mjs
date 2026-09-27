/**
 * One long-lived process that owns every engine instance on this checkout.
 *
 * Four spawn sites start processes nothing records, so a force-kill leaves a
 * live Chrome, a temp profile and a corpse record behind. The supervisor is the
 * single place that starts them, writes them down, and proves them by asking
 * their port. Every other engine part asks it to start things.
 *
 * The prover runs on a timer and on every listing. A record is a note; a reply
 * from the port is the evidence, so a dead port is never reported running.
 *
 * Node only: `node:http`, `node:child_process`, `node:fs`, and the helpers the
 * server and lane registries already export.
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { endProcess, processIsAlive, readServerRegistry, recordServer, forgetServer } from './project-servers.mjs'
import { devServerEnvironment } from './project-servers.mjs'
import {
  activatePage,
  closePage,
  findFreeDebuggingPort,
  freeLaneName,
  laneBrowserArguments,
  pagesOnPort,
  readLaneBrowsers,
  recordLaneBrowser,
  forgetLaneBrowser,
  showWindow
} from './lane-browsers.mjs'
import { openPage, pageOnUrl } from './open-page.mjs'
import { findChrome } from './chrome-path.mjs'
import { mainWorktree } from './agent-workspace-node.mjs'
import {
  badRequest,
  closeServer,
  listen,
  parseJson,
  readBody,
  readSupervisorRecord,
  removeSupervisorRecord,
  requestOnPort,
  sendJson,
  spawnDetached,
  writeSupervisorRecord
} from './supervisor-transport.mjs'

const DEFAULT_SUPERVISOR_PORT = 5179
const FIRST_DEV_SERVER_PORT = 5180
const FIRST_DEBUGGING_PORT = 9400
const PROVER_INTERVAL_MILLISECONDS = 5_000
// A dev server reads the checkout and optimises its dependencies before it
// binds, which takes tens of seconds on a cold start. The wait must outlast
// that and still end a process that never comes up.
const DEFAULT_START_TIMEOUT_MILLISECONDS = 180_000
// The feed is for a person watching the window, so it only needs to be long
// enough to cover the last few minutes. Old events are dropped, not archived.
const MAXIMUM_EVENTS = 200

const INSTANCE_KINDS = new Set(['dev-server', 'editor-browser', 'lane-browser', 'headless-session'])
const BROWSER_KINDS = new Set(['editor-browser', 'lane-browser'])

/**
 * Add one thing that happened to the feed the watch view draws.
 *
 * An event says what happened, to which instance, and why. The supervisor keeps
 * the list because it is the one that sees a start, a stop and a proof; the
 * view only draws what it is told.
 */
function recordEvent(state, event) {
  state.events.push({ sequence: ++state.sequence, at: new Date().toISOString(), ...event })
  if (state.events.length > MAXIMUM_EVENTS) state.events.splice(0, state.events.length - MAXIMUM_EVENTS)
}

/**
 * Add a managed instance — an Electron view or a terminal reporting its own
 * lifecycle — to the instance list, and return the entry.
 *
 * Electron views and terminals report lifecycle events directly. They share
 * the instance list without pretending to be independently listening servers.
 */
export function registerManaged(state, fields, stop) {
  const entry = {
    id: nextId(state, fields.kind),
    startedAt: new Date().toISOString(),
    state: 'running',
    owned: true,
    ...fields
  }
  state.managed.set(entry.id, stop)
  state.instances.push(entry)
  recordEvent(state, { event: 'opened', id: entry.id, detail: entry.label || entry.kind })
  return entry
}

/** Merge `fields` into a managed instance's entry. */
export function updateManaged(state, entry, fields) {
  Object.assign(entry, fields)
}

/** Remove a managed instance from the instance list and record its close. */
export function finishManaged(state, entry, detail = 'closed') {
  state.managed.delete(entry.id)
  state.instances = state.instances.filter(other => other !== entry)
  recordEvent(state, { event: 'closed', id: entry.id, detail })
}

/** Record one event against an instance by id, for the watch view's feed. */
export function supervisorEvent(state, id, event, detail) {
  recordEvent(state, { id, event, detail: String(detail).slice(0, 4000) })
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Where one instance's output goes, so a startup failure can be read. */
export const instanceLogFile = (checkout, id) =>
  path.join(process.env.ENGINE_STATE_ROOT || path.join(checkout, 'agent-runs'), 'supervisor', `${id}.log`)

/** The next stable id for a kind, unique for the supervisor's life. */
function nextId(state, kind) {
  state.counter += 1
  const id = `${kind}-${state.counter}`
  // Kept after the instance goes, so a repeat stop is answered as "already
  // stopped" rather than mistaken for an id nobody ever made.
  state.knownIds.add(id)
  return id
}

/** Append a lane name to a page URL, so the browser's pages say whose it is. */
function pageWithClient(url, client) {
  return url + (url.includes('?') ? '&' : '?') + `client=${encodeURIComponent(client)}`
}

/**
 * A port for a new instance: the one asked for, or a free one.
 *
 * A port an instance already holds is refused rather than shared, because the
 * second bind fails and the instance comes up without a port at all.
 */
async function allocatePort(state, asked, from) {
  const wanted = Number(asked)
  if (wanted) {
    if (state.instances.some(entry => entry.port === wanted)) {
      throw badRequest(
        `port ${wanted} is already used by another instance; list them with ` +
          'node bin/engine.mjs supervisor and stop one with supervisor.stop <id>, or leave the port unset to take a free one'
      )
    }
    return wanted
  }
  let port = await findFreeDebuggingPort(state.checkout, { from })
  while (state.instances.some(entry => entry.port === port)) {
    port = await findFreeDebuggingPort(state.checkout, { from: port + 1 })
  }
  return port
}

/**
 * Whether one path is another or a directory or file inside it.
 *
 * `path.relative` answers `..` for a sibling and an absolute path for another
 * drive, so both spellings are checked rather than a prefix compared.
 */
function insideDirectory(candidate, root) {
  const within = path.relative(root, candidate)
  return within === '' || (!within.startsWith('..') && !path.isAbsolute(within))
}

/**
 * The checkout a dev server should serve.
 *
 * A lane works in a git worktree beside the checkout this supervisor started
 * in. Serving that worktree is what gives the lane its own world without a
 * second supervisor, and the reply's `serves` is what proves which checkout a
 * `--port` command reached.
 *
 * Only this checkout's main worktree and directories inside it are accepted, so
 * a caller cannot point the supervisor's dev server at an unrelated directory.
 */
function servedCheckout(state, request) {
  if (request.checkout == null) return state.checkout
  const wanted = path.resolve(String(request.checkout))
  let main
  try {
    main = mainWorktree(state.checkout)
  } catch {
    main = path.resolve(state.checkout)
  }
  if (!insideDirectory(wanted, main)) {
    throw badRequest(
      `${wanted} is outside this checkout's main worktree ${main}; ` +
        'a dev server this supervisor starts serves this checkout or a worktree inside it'
    )
  }
  if (!fs.existsSync(wanted)) throw badRequest(`no directory at ${wanted}`)
  return wanted
}

/** The vite binary a checkout reaches, found by walking up so a lane reaches the main install. */
function findVite(checkout) {
  for (let directory = path.resolve(checkout); ; directory = path.dirname(directory)) {
    const script = path.join(directory, 'node_modules/vite/bin/vite.js')
    if (fs.existsSync(script)) return script
    if (path.dirname(directory) === directory) return null
  }
}

/** The vite process, with the port named, no editor window, and its own checkout. */
async function startDevServer(state, id, request, logPath) {
  const serves = servedCheckout(state, request)
  const port = await allocatePort(state, request.port, FIRST_DEV_SERVER_PORT)
  const vite = findVite(serves)
  if (!vite) throw badRequest(`the vite binary is not installed above ${serves}`)

  state.opening.add(`server:${port}`)
  const child = spawnDetached(process.execPath, [vite], {
    cwd: serves,
    env: devServerEnvironment(port, request.project),
    logPath
  })
  const entry = {
    id,
    kind: 'dev-server',
    pid: child.pid,
    port,
    url: `http://localhost:${port}/`,
    serves,
    project: request.project ?? null,
    startedAt: new Date().toISOString(),
    state: 'running',
    owned: true
  }
  // Recorded before the wait, so a server that never answers is still findable
  // by the next supervisor start.
  recordServer(state.checkout, {
    port,
    pid: child.pid,
    serves,
    project: entry.project,
    startedAt: entry.startedAt
  })
  return entry
}

/** Whether two paths name the same place. Windows ignores case in a path. */
function samePath(left, right) {
  const one = path.resolve(String(left || ''))
  const other = path.resolve(String(right || ''))
  return process.platform === 'win32' ? one.toLowerCase() === other.toLowerCase() : one === other
}

/** The article a browser kind takes: `an editor-browser`, `a lane-browser`. */
const articleFor = kind => (/^[aeiou]/i.test(kind) ? 'an' : 'a')

/**
 * The dev server a browser with no url opens on.
 *
 * One running server is the answer. Several are refused, each named with its
 * url, so the caller chooses. None names the verb that starts one.
 */
export function chooseDevServer(instances, kind) {
  const servers = instances.filter(entry => entry.kind === 'dev-server' && entry.state === 'running')
  if (servers.length === 0) {
    throw badRequest(
      `no dev server is running to open ${articleFor(kind)} ${kind} on; start one with ` +
        '`node bin/engine.mjs supervisor.open dev-server`'
    )
  }
  if (servers.length > 1) {
    const named = servers.map(entry => `${entry.id} (${entry.url})`).join(', ')
    throw badRequest(
      `several dev servers are running: ${named}; pass the url of the one to open ${articleFor(kind)} ${kind} on`
    )
  }
  return servers[0]
}

/**
 * Refuse a client name a live browser already holds.
 *
 * The registry is the evidence, not the in-memory list: a browser started
 * outside this supervisor writes the same file. A record whose process is gone
 * is litter, and `freeLaneName` clears it so the name is free to take.
 */
async function claimClientName(state, client) {
  try {
    await freeLaneName(state.checkout, client)
  } catch (error) {
    throw badRequest(error.message)
  }
}

/**
 * One browser: a headless lane with a temp profile, or a visible editor tab in
 * the profile a person keeps.
 *
 * Every editor instance is one tab, named by its own instance id in the page's
 * `?client=`, so several run side by side in one window and each is stopped on
 * its own. Opening the same client twice returns the tab that already holds it
 * rather than adding a second. The profile is shared and named separately, so
 * window size and zoom come back; the browser is recorded once under that
 * profile name, so a supervisor restart can still find and stop it.
 */
async function startBrowser(state, id, kind, request, logPath) {
  // An editor is matched against the browsers already running, so a record this
  // supervisor does not hold — vite's auto-open, another engine helper — is
  // adopted first. A lane with no url chooses its dev server the same way; a
  // lane with a url proves nothing, so a name a live window holds still refuses
  // before a prover round could clear it.
  const isEditor = kind === 'editor-browser'
  const running = request.url && !isEditor ? state.instances : await proveInstances(state)
  const server = request.url ? null : chooseDevServer(running, kind)
  const url = request.url || server.url
  const project = request.project ?? server?.project ?? null
  // The instance id is the bridge client name, so the table's ID column is
  // also what `--client` takes and what the page reports as itself.
  const client = request.client || id
  // A lane's size is a render target, so a tall narrow frame costs least. A
  // window a person works in needs a desktop shape, or it opens as a strip
  // behind their terminal and reads as nothing having happened.
  const width = Number(request.width) || (isEditor ? 1400 : 540)
  const height = Number(request.height) || (isEditor ? 900 : 960)
  const page = pageWithClient(url, client)

  if (isEditor) {
    // One visible browser holds every editor tab, so the profile is named for
    // the window, not for the instance.
    const browser = request.profile || 'editor'
    const runningEditor = await editorOnUrl(state, page)
    if (runningEditor) {
      runningEditor.bounds = await showWindow(runningEditor.port, runningEditor.pageId, { width, height })
      return runningEditor
    }
    state.opening.add(`browser:${browser}`)
    const opened = await openPage(page, { checkout: state.checkout, profile: browser, width, height })
    if (!opened.opened) throw badRequest(opened.problem)
    return {
      id,
      kind,
      pid: opened.pid,
      port: opened.port,
      url: page,
      client,
      browser,
      profile: opened.profile,
      chrome: opened.chrome,
      headless: false,
      project,
      pageId: opened.pageId,
      startedBrowser: opened.reused !== true,
      bounds: await showWindow(opened.port, opened.pageId, { width, height }),
      startedAt: new Date().toISOString(),
      state: 'running',
      owned: true
    }
  }

  // One client name is one browser. Claimed before the port and the profile so a
  // refused start writes nothing and spawns nothing.
  await claimClientName(state, client)
  const port = await allocatePort(state, request.port, FIRST_DEBUGGING_PORT)
  const chrome = request.chrome || findChrome(state.checkout)
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', `supervisor-${id}-`))
  state.opening.add(`browser:${client}`)
  const child = spawnDetached(chrome, laneBrowserArguments({ port, profile, page, width, height }), {
    cwd: state.checkout,
    env: process.env,
    logPath
  })
  const entry = {
    id,
    kind,
    pid: child.pid,
    port,
    url: page,
    client,
    browser: client,
    profile,
    chrome,
    headless: true,
    project,
    startedAt: new Date().toISOString(),
    state: 'running',
    owned: true
  }
  recordLaneBrowser(state.checkout, {
    client,
    port,
    url: page,
    pid: child.pid,
    profile,
    serves: state.checkout,
    chrome,
    headless: true,
    startedAt: entry.startedAt
  })
  return entry
}

/**
 * An editor instance already showing this url, brought to the front.
 *
 * The instance owns the browser as well as the page: returning it means the
 * caller's open adds no second tab and no second row. A page on another url in
 * the same browser is a different instance, opened as a window.
 */
async function editorOnUrl(state, url) {
  for (const entry of state.instances) {
    if (entry.kind !== 'editor-browser' || entry.port == null) continue
    const pages = await pagesOnPort(entry.port)
    if (!pages) continue
    const page = pageOnUrl(pages, url)
    if (!page) continue
    await activatePage(entry.port, page.id)
    entry.pageId = page.id
    return entry
  }
  return null
}

/** A node process the caller names, kept alive so the pid can be proved. */
async function startHeadlessSession(state, id, request, logPath) {
  const command = request.command || process.execPath
  const args = Array.isArray(request.args) ? request.args : ['-e', 'setInterval(() => {}, 1000)']
  const child = spawnDetached(command, args, {
    cwd: request.cwd || state.checkout,
    env: process.env,
    logPath
  })
  return {
    id,
    kind: 'headless-session',
    pid: child.pid,
    port: null,
    url: null,
    project: request.project ?? null,
    startedAt: new Date().toISOString(),
    state: 'running',
    owned: true
  }
}

/** Kill a process tree and remove a headless lane's temp profile, which is free only after the kill. */
async function killInstance(state, entry) {
  if (state.managed.has(entry.id)) {
    await state.managed.get(entry.id)()
    return
  }
  if (entry.kind === 'editor-browser') {
    // A browser another tab is still using is that tab's to close, so the wait
    // for an empty window is skipped rather than spent and given up on.
    const shared = state.instances.some(
      other => other !== entry && (other.browser || other.client) === (entry.browser || entry.client)
    )
    await closeEditorBrowser(entry, { shared })
    return
  }
  await endProcess(entry.pid)
  if (entry.profile && entry.headless !== false) {
    await sleep(200)
    try {
      fs.rmSync(entry.profile, { recursive: true, force: true })
    } catch {
      /* held; harmless */
    }
  }
}

/**
 * Stop one visible editor.
 *
 * Killing the recorded pid is not the stop: the browser is shared by every
 * page in its profile, so the instance's page is closed through the browser's
 * debugging port instead. The browser is killed only when this instance
 * started it and no page is left, so a browser another instance is using
 * survives.
 */
async function closeEditorBrowser(entry, { shared = false } = {}) {
  await closeInstancePage(entry)
  if (entry.startedBrowser !== true || shared) return
  await killWhenEmpty(entry)
}

/** Close the page this instance opened, if the browser still lists it. */
async function closeInstancePage(entry) {
  if (entry.port == null) return
  const pages = await pagesOnPort(entry.port)
  if (!pages) return
  const page = entry.pageId ? pages.find(one => one.id === entry.pageId) : pageOnUrl(pages, entry.url)
  if (page) await closePage(entry.port, page.id)
}

/**
 * Kill the browser once its last page is gone.
 *
 * Closing the last page ends the window, which Chrome reports a moment later.
 * Killing on the first read would race a close that is still in flight; killing
 * a browser that still holds a page would take a sibling's page with it, so the
 * kill waits for zero and gives up on any.
 */
async function killWhenEmpty(entry) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const remaining = entry.port == null ? [] : await pagesOnPort(entry.port)
    if (remaining === null || remaining.length === 0) {
      await endProcess(entry.pid)
      return
    }
    await sleep(100)
  }
}

/** Remove an instance's record from the registry that outlives this process. */
function forgetInstanceRecord(state, entry) {
  if (entry.kind === 'dev-server') forgetServer(state.checkout, entry.port, entry.pid)
  // The registry is keyed by the browser, not by the tab: every editor
  // instance in one window shares one record. Forgetting it while a sibling
  // tab is still open would leave that browser unstoppable.
  const browser = entry.browser || entry.client
  if (BROWSER_KINDS.has(entry.kind) && browser) {
    const shared = state.instances.some(other => other !== entry && (other.browser || other.client) === browser)
    if (!shared) forgetLaneBrowser(state.checkout, browser)
  }
}

/**
 * Kill, forget and drop one instance, and say why in the event feed.
 *
 * The why is the caller's, because only the caller knows whether a person
 * asked, the prover found it gone, or the start never answered.
 */
async function discardInstance(state, entry, why) {
  await killInstance(state, entry)
  if (!state.instances.includes(entry)) return
  state.managed.delete(entry.id)
  forgetInstanceRecord(state, entry)
  state.unresponsive.delete(entry.id)
  state.instances = state.instances.filter(other => other !== entry)
  recordEvent(state, { event: why.event, id: entry.id, detail: why.detail })
}

/**
 * Close every page left pointing at a dev server that is gone.
 *
 * A page whose server died keeps its renderer, its worker and its world in
 * memory and answers nothing, and a person cannot tell it from a live editor.
 * A browser with no page left is ended too, but only when this supervisor
 * started it — another instance's browser is that instance's to close.
 */
async function closeOrphanedPages(state, server) {
  // The instance goes with its page, so the table loses the row at the moment
  // the tab closes. A browser row left listed with no tab is what reads as an
  // editor that is still running.
  for (const browser of [...state.instances]) {
    if (!BROWSER_KINDS.has(browser.kind)) continue
    if (!servedBy(browser.url, server.url)) continue
    await discardInstance(state, browser, { event: 'closed', detail: `its server ${server.id} is gone` })
  }
  // A tab nothing holds a record for — opened by hand in the engine's window —
  // is closed too, for the same reason: it answers nothing and looks alive.
  const ports = new Set(
    state.instances.filter(entry => BROWSER_KINDS.has(entry.kind) && entry.port != null).map(entry => entry.port)
  )
  for (const port of ports) {
    const pages = await pagesOnPort(port)
    if (!pages) continue
    for (const page of pages.filter(one => servedBy(one.url, server.url))) {
      await closePage(port, page.id)
      recordEvent(state, {
        event: 'closed',
        id: `page ${page.id.slice(0, 8)}`,
        detail: `its server ${server.id} is gone`
      })
    }
  }
}

/**
 * Whether a page is served by this dev server.
 *
 * Matched on the origin, not the whole url: every page carries a `?client=`
 * naming its instance, and a path when a project is open, so comparing the
 * full url would call every page a stranger's and close none of them.
 */
const servedBy = (pageUrl, serverUrl) => {
  try {
    return new URL(pageUrl).origin === new URL(serverUrl).origin
  } catch {
    return String(pageUrl) === String(serverUrl)
  }
}

/**
 * Why a start that never answered failed: the process is gone, or it is up and
 * never bound. A reader acts differently on each, so the event says which.
 */
function startFailure(entry) {
  return processIsAlive(entry.pid)
    ? { event: 'failed', detail: 'process alive but never bound' }
    : { event: 'failed', detail: 'process died' }
}

/**
 * Spawn one instance and wait until its own port answers.
 *
 * The instance is written down before the wait so a start that never comes up
 * is still stoppable. A start that fails is killed and forgotten rather than
 * left as an orphan.
 */
/** Open the kind of instance the request named. */
function openInstance(state, kind, id, request, logPath) {
  if (kind === 'dev-server') return startDevServer(state, id, request, logPath)
  if (BROWSER_KINDS.has(kind)) return startBrowser(state, id, kind, request, logPath)
  return startHeadlessSession(state, id, request, logPath)
}

async function startInstance(state, request) {
  if (!request || typeof request !== 'object') throw badRequest('an instance request must be a JSON object')
  const kind = request.kind
  if (!INSTANCE_KINDS.has(kind)) {
    throw badRequest(`"${kind}" is not an instance kind; expected ${[...INSTANCE_KINDS].join(', ')}`)
  }
  const id = nextId(state, kind)
  const logPath = instanceLogFile(state.checkout, id)
  let entry
  try {
    entry = await openInstance(state, kind, id, request, logPath)

    // An editor open that reused the running browser returns a row that is
    // already listed. Adding it again would report two instances for one page.
    if (state.instances.includes(entry)) return entry

    // A start is not a failure to answer. The prover leaves a starting instance
    // alone, so a slow server is not counted unresponsive while it binds.
    entry.state = 'starting'
    state.instances.push(entry)
  } finally {
    // The registry record is written before the row exists. A prover pass in
    // that gap would adopt the record as a second instance of the same process,
    // so adoption is held off by name until the row is listed. Clearing the
    // whole set is safe: starts are serialised, so only this one is in flight.
    state.opening.clear()
  }
  if (!(await waitUntilRunning(state, entry))) {
    const failure = startFailure(entry)
    await discardInstance(state, entry, failure)
    throw badRequest(`the ${kind} ${id} never came up (${failure.detail}); its output is in ${logPath}`)
  }
  entry.state = 'running'
  state.unresponsive.delete(entry.id)
  recordEvent(state, {
    event: 'opened',
    id: entry.id,
    detail: entry.port == null ? `pid ${entry.pid}` : `port ${entry.port}`
  })
  return entry
}

/**
 * Start an instance. Serialised, because two starts at once would each bind-test
 * the same free port before either wrote it down.
 */
export function spawnInstance(state, request) {
  const started = state.spawning.then(
    () => startInstance(state, request),
    () => startInstance(state, request)
  )
  state.spawning = started.catch(() => {})
  return started
}

/**
 * Stop one instance, or say it is already stopped.
 *
 * A repeat stop is a success: the caller's goal, that instance not running, is
 * met. An id this supervisor never made is a 404, and the reply names the ids
 * that do exist so the caller can correct the id.
 *
 * Serialised, so two callers stopping the same instance cannot both report
 * having stopped it: the second finds the first's work and says so.
 */
export function stopInstance(state, id) {
  const stopped = state.stopping.then(
    () => stopOneInstance(state, id),
    () => stopOneInstance(state, id)
  )
  state.stopping = stopped.catch(() => {})
  return stopped
}

async function stopOneInstance(state, id) {
  const entry = state.instances.find(other => other.id === id)
  if (entry) {
    await discardInstance(state, entry, { event: 'closed', detail: 'asked' })
    // A page whose server has just been stopped shows a dead editor and holds a
    // renderer and a world in memory, so it goes with the server it was serving.
    if (entry.kind === 'dev-server') await closeOrphanedPages(state, entry)
    return { stopped: [entry], alreadyStopped: [] }
  }
  if (state.knownIds.has(id)) return { stopped: [], alreadyStopped: [id] }
  const existing = state.instances.map(other => other.id)
  throw Object.assign(
    new Error(`no instance is called "${id}"; existing ids: ${existing.length ? existing.join(', ') : 'none'}`),
    { statusCode: 404 }
  )
}

/** Stop every instance this supervisor started. Adopted ones are left for their owner. */
async function stopOwnedInstances(state) {
  const stopped = []
  for (const entry of state.instances.filter(other => other.owned)) {
    await discardInstance(state, entry, { event: 'closed', detail: 'asked' })
    stopped.push(entry)
  }
  return stopped
}

/**
 * What a port says about one instance, asked rather than read from a record.
 *
 * A dev server's reply must come from this instance: the operating system hands
 * a dead server's port to whatever claims it next, and a stranger answering
 * there would otherwise read as our server still running.
 *
 * An editor instance is one tab, so its proof is that tab in the port's
 * listing. The browser answering proves only the window its siblings share,
 * and a tab closed by hand would read as running until the window itself went.
 */
async function proveInstance(state, entry) {
  if (entry.kind === 'headless-session') return processIsAlive(entry.pid) ? 'running' : 'gone'
  const answer = await requestOnPort(entry.port, 'GET', entry.kind === 'dev-server' ? '/api/server' : '/json/list')
  if (entry.kind === 'dev-server') {
    const mine =
      answer &&
      answer.status === 200 &&
      Number(answer.body?.pid) === entry.pid &&
      samePath(answer.body?.serves, entry.serves || state.checkout)
    if (mine) return 'running'
    return processIsAlive(entry.pid) ? 'unresponsive' : 'gone'
  }
  if (!answer || answer.status !== 200) return processIsAlive(entry.pid) ? 'unresponsive' : 'gone'
  if (entry.kind !== 'editor-browser') return 'running'
  return tabIsOpen(Array.isArray(answer.body) ? answer.body : [], entry) ? 'running' : 'gone'
}

/**
 * Whether this instance's own tab is among the pages a port lists.
 *
 * The page id is the evidence. A row adopted before its id was read is matched
 * on its url instead, so an adopted tab is not proved gone for want of an id.
 */
function tabIsOpen(targets, entry) {
  const pages = targets.filter(target => target.type === 'page')
  if (entry.pageId) return pages.some(page => page.id === entry.pageId)
  return Boolean(pageOnUrl(pages, entry.url))
}

/**
 * Prove every instance and act on what the proofs say.
 *
 * Gone and owned, or unresponsive twice running, means drop the record and kill
 * the tree. Twice, because a dev server that is still binding answers nothing
 * for a moment and killing it there would abort a healthy start.
 */
async function runProver(state) {
  // A spawn site that asks the supervisor records nothing itself; one that
  // spawns directly — a tool, `npm run dev`, another engine helper — writes the
  // same two registries. Reading them on every pass is what keeps such an
  // instance in this table instead of invisible until the next supervisor start.
  await adoptNewRecords(state)
  for (const entry of [...state.instances]) {
    if (state.managed.has(entry.id)) continue
    if (entry.state === 'starting') continue
    // Closing a dead server's pages can end a browser mid-pass, and this list is
    // the one taken before that. Proving a dropped entry would report it killed
    // outside, when the supervisor closed it on purpose a moment earlier.
    if (!state.instances.includes(entry)) continue
    const now = await proveInstance(state, entry)
    if (now === 'running') {
      entry.state = 'running'
      state.unresponsive.delete(entry.id)
      continue
    }
    if (now === 'gone') {
      entry.state = 'gone'
      // An editor row is one tab, so the usual cause is a person closing it.
      // Naming the tab keeps the feed true about what a reader just did.
      await discardInstance(state, entry, {
        event: 'gone',
        detail: entry.kind === 'editor-browser' ? 'its tab was closed' : 'killed outside'
      })
      if (entry.kind === 'dev-server') await closeOrphanedPages(state, entry)
      continue
    }
    entry.state = 'unresponsive'
    // The count is stored beside the instances, not on them, so a reply cannot
    // carry supervisor bookkeeping the caller never asked for.
    const rounds = (state.unresponsive.get(entry.id) || 0) + 1
    if (rounds >= 2) await discardInstance(state, entry, { event: 'gone', detail: 'no answer' })
    else state.unresponsive.set(entry.id, rounds)
  }
  await stampShowing(state)
  return state.instances
}

/**
 * Say whether each browser instance can be seen, from the page's own report.
 *
 * A debugging port cannot answer this: a window hidden by the operating system,
 * a minimised one and a background tab all answer it the same way, and all three
 * still report their bounds as normal. The page knows, tells its dev server, and
 * the dev server carries it in the reply this prover already reads, so nothing
 * here asks the operating system and nothing costs a second request.
 *
 * A browser whose page is not attached gets `null`, not a guess.
 */
async function stampShowing(state) {
  const tabs = new Map()
  for (const server of state.instances) {
    if (server.kind !== 'dev-server' || server.state !== 'running') continue
    const answer = await requestOnPort(server.port, 'GET', '/api/server')
    for (const tab of answer?.body?.tabs || []) tabs.set(tab.id, tab)
  }
  for (const entry of state.instances) {
    if (!BROWSER_KINDS.has(entry.kind)) continue
    const tab = tabs.get(entry.client)
    if (!tab) entry.showing = null
    else entry.showing = tab.hidden ? 'hidden' : 'visible'
  }
}

/** Run the prover without letting two passes overlap. */
function proveInstances(state) {
  state.proving = state.proving.then(
    () => runProver(state),
    () => runProver(state)
  )
  return state.proving.then(() => state.instances)
}

/** Wait until an instance's own port answers, or its process is gone. */
async function waitUntilRunning(state, entry) {
  const deadline = Date.now() + state.startTimeoutMilliseconds
  while (Date.now() < deadline) {
    if ((await proveInstance(state, entry)) === 'running') return true
    if (!processIsAlive(entry.pid)) return false
    await sleep(250)
  }
  return false
}

/**
 * Adopt records left by an earlier supervisor and prove them at once.
 *
 * A force-killed supervisor cannot remove its records. Reading the two
 * registries on start is what makes the instance table true about things that
 * were started before this process existed.
 */
/**
 * Add every registry record this supervisor does not already hold.
 *
 * Matched on the process id, so a record whose process is already in the table
 * is not listed twice and a record for a fresh process is. The entry is adopted
 * (`owned: false`): the prover may drop it, but only its own owner kills it on
 * a clean exit.
 */
async function adoptNewRecords(state) {
  // Matched within a kind: a row of another kind holding this process id says
  // nothing about whether this record is already listed.
  const known = (kind, pid) =>
    state.instances.some(
      entry =>
        entry.pid === pid && (kind === 'dev-server' ? entry.kind === 'dev-server' : BROWSER_KINDS.has(entry.kind))
    )
  for (const server of readServerRegistry(state.checkout).servers) {
    if (state.desktopCommand && server.pid === state.pid) continue
    if (known('dev-server', server.pid) || state.opening.has(`server:${server.port}`)) continue
    state.instances.push({
      id: nextId(state, 'dev-server'),
      kind: 'dev-server',
      pid: server.pid,
      port: server.port,
      url: `http://localhost:${server.port}/`,
      serves: server.serves || state.checkout,
      project: server.project ?? null,
      startedAt: server.startedAt,
      state: 'running',
      owned: false
    })
  }
  for (const browser of readLaneBrowsers(state.checkout)) {
    // Matched on the registry name as well as the process: one browser record
    // backs every editor tab, so its pid is not the only row that holds it.
    const held = state.instances.some(entry => (entry.browser || entry.client) === browser.client)
    if (known('browser', browser.pid) || held || state.opening.has(`browser:${browser.client}`)) continue
    const kind = browser.headless === false ? 'editor-browser' : 'lane-browser'
    const row = {
      pid: browser.pid,
      port: browser.port,
      browser: browser.client,
      profile: browser.profile,
      chrome: browser.chrome,
      headless: browser.headless,
      project: null,
      startedAt: browser.startedAt,
      state: 'running',
      owned: false,
      startedBrowser: browser.startedBrowser === true
    }
    // One record backs one browser, and a visible browser holds a tab per
    // instance. Asking the port is what turns that one record into the rows a
    // reader can stop one at a time.
    const pages = kind === 'editor-browser' ? await pagesOnPort(browser.port) : null
    if (pages && pages.length) {
      for (const page of pages) {
        state.instances.push({
          ...row,
          id: nextId(state, kind),
          kind,
          url: page.url,
          pageId: page.id,
          client: clientOfUrl(page.url) || browser.client
        })
      }
      continue
    }
    state.instances.push({ ...row, id: nextId(state, kind), kind, url: browser.url, client: browser.client })
  }
}

/** The bridge client name a page url carries, or null. */
function clientOfUrl(url) {
  try {
    return new URL(url).searchParams.get('client')
  } catch {
    return null
  }
}

/** Read the registries an earlier process left, then prove them at once. */
async function adoptInstances(state) {
  await adoptNewRecords(state)
  await runProver(state)
}

/** Kill what is owned before the process goes, and leave no record. */
function registerLifecycle(state) {
  state.onSignal = () => {
    shutdownSupervisor(state).finally(() => process.exit(0))
  }
  state.onExit = () => {
    removeSupervisorRecord(state.checkout)
    for (const entry of state.instances) if (entry.owned && !state.managed.has(entry.id)) endProcess(entry.pid)
  }
  process.once('SIGINT', state.onSignal)
  process.once('SIGTERM', state.onSignal)
  process.on('exit', state.onExit)
}

/** Stop listening to process signals, so a test can start and close many times. */
function unregisterLifecycle(state) {
  if (state.onSignal) {
    process.off('SIGINT', state.onSignal)
    process.off('SIGTERM', state.onSignal)
  }
  if (state.onExit) process.off('exit', state.onExit)
}

/** Remove the record, stop the timer, and close the door. Once. */
async function finishSupervisor(state) {
  if (state.finished) return
  state.finished = true
  removeSupervisorRecord(state.checkout)
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  unregisterLifecycle(state)
  await closeServer(state.server)
}

/** Stop everything owned, then take the supervisor down. */
async function shutdownSupervisor(state) {
  const stopped = await stopOwnedInstances(state)
  await finishSupervisor(state)
  return { stopped }
}

/** The supervisor's routes, tried in order against the method and path. */
const SUPERVISOR_ROUTES = [
  {
    method: 'POST',
    matches: routePath => routePath === '/handoff',
    handle: async ({ state, response }) => {
      if (state.managed.size) return sendJson(response, 409, { error: 'the desktop is already running' })
      sendJson(response, 200, { ok: true })
      void finishSupervisor(state)
      return undefined
    }
  },
  {
    method: 'GET',
    matches: routePath => routePath === '/snapshot',
    handle: async ({ state, response }) => sendJson(response, 200, { instances: state.instances, events: state.events })
  },
  {
    method: 'POST',
    matches: routePath => routePath === '/desktop',
    handle: async ({ state, request, response }) => {
      if (!state.desktopCommand) return sendJson(response, 404, { error: 'no desktop attached' })
      const body = parseJson(await readBody(request))
      return sendJson(response, 200, await state.desktopCommand(body))
    }
  },
  {
    method: 'GET',
    matches: routePath => routePath === '/health',
    handle: async ({ state, response }) =>
      sendJson(response, 200, { ok: true, pid: process.pid, port: state.port, startedAt: state.startedAt })
  },
  {
    method: 'GET',
    matches: routePath => routePath === '/instances',
    handle: async ({ state, response }) => sendJson(response, 200, { instances: await proveInstances(state) })
  },
  {
    method: 'GET',
    matches: routePath => routePath === '/events',
    handle: async ({ state, response }) => sendJson(response, 200, { events: state.events })
  },
  {
    method: 'POST',
    matches: routePath => routePath === '/instances',
    handle: async ({ state, request, response }) =>
      sendJson(response, 200, await spawnInstance(state, parseJson(await readBody(request))))
  },
  {
    method: 'DELETE',
    matches: routePath => routePath === '/instances',
    handle: async ({ state, response }) => sendJson(response, 200, { stopped: await stopOwnedInstances(state) })
  },
  {
    method: 'DELETE',
    matches: routePath => routePath.startsWith('/instances/'),
    handle: async ({ state, response, requestPath }) => {
      const id = decodeURIComponent(requestPath.slice('/instances/'.length))
      return sendJson(response, 200, await stopInstance(state, id))
    }
  },
  {
    method: 'POST',
    matches: routePath => routePath === '/shutdown',
    handle: async ({ state, response }) => {
      const stopped = await stopOwnedInstances(state)
      sendJson(response, 200, { ok: true, stopped })
      // Close after the reply is written, so the caller hears the answer.
      finishSupervisor(state)
      return undefined
    }
  }
]

/** Route one HTTP request. Every reply is JSON; an error is a sentence. */
async function handleSupervisorRequest(state, request, response) {
  const address = new URL(request.url || '/', 'http://127.0.0.1')
  const method = request.method || 'GET'
  const requestPath = address.pathname
  try {
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
      return sendJson(response, 403, { error: 'origin refused' })
    }
    const route = SUPERVISOR_ROUTES.find(entry => entry.method === method && entry.matches(requestPath))
    if (!route) return sendJson(response, 404, { error: `no route for ${method} ${requestPath}` })
    return await route.handle({ state, request, response, requestPath })
  } catch (error) {
    return sendJson(response, error.statusCode || 500, { error: error.message })
  }
}

/**
 * Start the supervisor and return its handle.
 *
 * The record is written after the bind, so a port in the file is a port that
 * answered at least the listen. The handle carries the live instance list as
 * well as `{ port, pid, close }`, so a caller can drive `spawnInstance` and
 * `stopInstance` without going through HTTP.
 */
export async function startSupervisor(checkout, { port, startTimeoutMilliseconds } = {}) {
  const wanted =
    port === undefined ? Number(process.env.ENGINE_SUPERVISOR_PORT || DEFAULT_SUPERVISOR_PORT) : Number(port)
  const state = {
    checkout,
    port: null,
    pid: process.pid,
    startTimeoutMilliseconds: startTimeoutMilliseconds ?? DEFAULT_START_TIMEOUT_MILLISECONDS,
    startedAt: new Date().toISOString(),
    instances: [],
    // The feed the watch view draws, newest last. The count is capped, so a
    // long-lived supervisor cannot grow it without bound.
    events: [],
    sequence: 0,
    managed: new Map(),
    // Consecutive unresponsive proofs per instance id, kept off the instance so
    // it never reaches an HTTP reply.
    unresponsive: new Map(),
    // Every id ever handed out here, so a stop after the instance goes is
    // answered honestly rather than as an unknown id.
    knownIds: new Set(),
    counter: 0,
    // Registry names a start has written down but has no row for yet, so the
    // prover does not adopt its own supervisor's work as a stranger's.
    opening: new Set(),
    spawning: Promise.resolve(),
    stopping: Promise.resolve(),
    proving: Promise.resolve(),
    timer: null,
    server: null,
    finished: false
  }
  state.server = http.createServer((request, response) => handleSupervisorRequest(state, request, response))
  try {
    await listen(state.server, wanted)
    state.port = state.server.address().port
    writeSupervisorRecord(checkout, { port: state.port, pid: state.pid, startedAt: state.startedAt })
    state.timer = setInterval(() => {
      proveInstances(state).catch(() => {})
    }, PROVER_INTERVAL_MILLISECONDS)
    state.timer.unref()
    registerLifecycle(state)
    await adoptInstances(state)
  } catch (error) {
    removeSupervisorRecord(checkout)
    await closeServer(state.server)
    throw error
  }
  state.close = () => shutdownSupervisor(state)
  return state
}

/**
 * Read the record and prove it with `GET /health`.
 *
 * A record is a note. It counts only when the port answers as this exact
 * process, so a stale file naming a reused port is not reported alive. Null
 * means no supervisor is up here.
 */
export async function supervisorAddress(checkout) {
  const record = readSupervisorRecord(checkout)
  if (!record || !Number.isInteger(record.port)) return null
  const answer = await requestOnPort(record.port, 'GET', '/health')
  if (!answer || answer.status !== 200 || answer.body?.ok !== true) return null
  if (Number(answer.body.pid) !== Number(record.pid)) return null
  return { port: record.port, pid: Number(answer.body.pid), alive: true }
}

/**
 * Make one HTTP call to a running supervisor and return its JSON answer.
 *
 * Throws a plain Error when the record is missing or the port does not answer,
 * so a caller can fall back to starting one without inspecting an error code.
 */
export async function askSupervisor(checkout, method, requestPath, body, milliseconds = 1500) {
  const record = readSupervisorRecord(checkout)
  if (!record || !Number.isInteger(record.port)) {
    throw new Error(`no supervisor is running in ${checkout}; start one with supervisor.start`)
  }
  const answer = await requestOnPort(record.port, method, requestPath, body, milliseconds)
  if (!answer) throw new Error(`the supervisor on port ${record.port} is not answering`)
  if (answer.status >= 400) throw new Error(answer.body?.error || `the supervisor answered ${answer.status}`)
  return answer.body
}
