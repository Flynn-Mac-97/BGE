/**
 * Browsers started by this engine: a headless lane, or the visible window a
 * person works in.
 *
 * A lane needs real pixels, and taking them from the person's browser is what
 * made five parallel lanes fight over one tab. Each lane gets its own headless
 * Chromium instead, attached to its own dev server under a name it chose.
 *
 * A browser with no window is invisible: it has no taskbar entry, and a
 * forgotten one is only findable by reading process command lines. So every one
 * is written down here, and the reader proves an entry by asking its debugging
 * port rather than trusting the file — the same rule the server registry
 * follows, for the same reason. A lane's reply must name the lane, because any
 * browser can answer a port; a visible window has no `?client=` page, so its
 * port answering is proof enough.
 *
 * Records belong to the main checkout, not to whichever worktree started the
 * browser, so a lane's browser can be listed and stopped from outside its
 * worktree.
 *
 * One client name is one browser. A start that overwrote a live record would
 * lose the only handle on a running process, so it is refused instead.
 */
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mainWorktree } from './agent-workspace-node.mjs'
import { findChrome } from './chrome-path.mjs'

export { findChrome }

const mainCheckouts = new Map()

/**
 * The main checkout a path belongs to.
 *
 * A lane works in a git worktree. A record written there is invisible to the
 * main checkout, which is where a person lists and stops lane browsers from, so
 * every lane resource is owned by the main checkout instead. A path git does not
 * report on is its own main checkout.
 *
 * Cached: a registry read must not spawn git every time.
 */
function mainCheckout(root) {
  if (!mainCheckouts.has(root)) {
    let main = root
    try {
      main = mainWorktree(root)
    } catch {
      /* not a git worktree */
    }
    mainCheckouts.set(root, main)
  }
  return mainCheckouts.get(root)
}

/** The lane browser registry's path in the main checkout. */
const registryFile = root =>
  path.join(process.env.ENGINE_STATE_ROOT || path.join(mainCheckout(root), '.engine'), 'lane-browsers.json')

/**
 * The recorded browsers for this checkout, or an empty list when the file is
 * missing or broken.
 *
 * A record written before the `headless` field existed was a lane, so a record
 * without the field reads as one. New records carry it either way.
 */
export function readLaneBrowsers(root) {
  try {
    const value = JSON.parse(fs.readFileSync(registryFile(root), 'utf8'))
    const browsers = Array.isArray(value.browsers) ? value.browsers : []
    return browsers.map(entry => ({ ...entry, headless: entry.headless !== false }))
  } catch {
    return []
  }
}

/** Replace the lane browser registry for this checkout. */
function writeLaneBrowsers(root, browsers) {
  const file = registryFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 1, browsers }, null, 2) + '\n', 'utf8')
}

/**
 * Add or replace the entry for a client name.
 *
 * `headless` defaults to true because a browser started without saying which
 * kind it is was a lane; a visible window passes false explicitly.
 */
export function recordLaneBrowser(root, entry) {
  const record = { headless: true, ...entry }
  const kept = readLaneBrowsers(root).filter(other => other.client !== record.client)
  writeLaneBrowsers(root, [...kept, record])
  return record
}

/** Remove one client's record from the registry. */
export function forgetLaneBrowser(root, client) {
  writeLaneBrowsers(
    root,
    readLaneBrowsers(root).filter(entry => entry.client !== client)
  )
}

/** The record for one client name, or undefined. */
const recordFor = (root, client) => readLaneBrowsers(root).find(entry => entry.client === client)

/**
 * Store what the page reports about its own frame.
 *
 * The window size asked of Chrome is not the size a frame comes out at —
 * editor chrome takes the difference — so the two are separate fields and
 * neither stands in for the other. Called once the page has attached, because
 * only the page knows the second number.
 */
export function recordLaneViewport(root, client, { viewport, pixelRatio } = {}) {
  const found = recordFor(root, client)
  if (!found) return null
  return recordLaneBrowser(root, {
    ...found,
    ...(viewport ? { viewportReported: viewport } : {}),
    ...(Number.isFinite(pixelRatio) ? { pixelRatio } : {})
  })
}

/**
 * What the browser on this port calls itself, or null if it does not answer.
 *
 * Recorded with every lane because Chrome updates itself. Frames are compared
 * across loops on different days, so a renderer change between two of them
 * would otherwise read as an art regression with nothing to point at.
 */
export function browserVersion(port) {
  return ask(port).then(said => said?.Browser || null)
}

/**
 * Read one DevTools HTTP resource, or null when the port does not answer.
 *
 * The body is read even though some callers only need the status: an unread
 * body holds its socket open, and a socket still closing when the process exits
 * trips a libuv assertion on Windows that is printed after the command's own
 * output. node:http with `agent: false`, not fetch, for the same reason.
 */
function debuggingPortGet(port, resource) {
  return new Promise(resolve => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: resource,
        agent: false,
        timeout: 1500
      },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          body += chunk
        })
        response.once('end', () => {
          request.destroy()
          resolve({ status: response.statusCode, text: body })
        })
      }
    )
    const fail = () => {
      request.destroy()
      resolve(null)
    }
    request.once('error', fail)
    request.once('timeout', fail)
  })
}

/** Ask a debugging port who it is, or null when it does not answer with JSON. */
async function ask(port, resource = '/json/version') {
  const answer = await debuggingPortGet(port, resource)
  if (!answer || answer.status !== 200) return null
  try {
    return JSON.parse(answer.text)
  } catch {
    return null
  }
}

/** Whether anything answers a debugging port at all. */
const answers = port => ask(port).then(said => said !== null)

/** Whether a process id still exists. */
const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The lane name a page URL carries, or null. */
function clientOf(url) {
  try {
    return new URL(url).searchParams.get('client')
  } catch {
    return null
  }
}

/**
 * The lane names the browser on this port has open, or null if it does not
 * answer.
 *
 * A port answering proves a browser, not which browser. A lane opens its page
 * with `?client=<name>`, so the pages a port lists say whose browser it is.
 */
export async function clientsOnPort(port) {
  const targets = await ask(port, '/json/list')
  if (!Array.isArray(targets)) return null
  return targets.map(target => clientOf(target.url)).filter(Boolean)
}

/**
 * The pages a debugging port has open, or null when it does not answer.
 *
 * Only `type: "page"` targets are windows a person sees. A service worker or a
 * browser-internal target is not a tab to reuse or close.
 */
export async function pagesOnPort(port) {
  const targets = await ask(port, '/json/list')
  if (!Array.isArray(targets)) return null
  return targets.filter(target => target.type === 'page')
}

/** Bring one page to the front. Reports whether the port took it. */
export async function activatePage(port, id) {
  const answer = await debuggingPortGet(port, `/json/activate/${encodeURIComponent(id)}`)
  return Boolean(answer && answer.status === 200)
}

/**
 * One command on the browser's own debugging socket, and its result.
 *
 * `/json` answers about pages only. Window position, size and state are
 * browser-level commands, which are reachable over the socket alone.
 */
export async function browserCommand(port, method, parameters = {}, { timeoutMilliseconds = 4000, open } = {}) {
  const version = await ask(port, '/json/version')
  const address = version?.webSocketDebuggerUrl
  if (!address) return null
  const socket = (open ?? (url => new WebSocket(url)))(address)
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} did not answer`)), timeoutMilliseconds)
      const done = value => {
        clearTimeout(timer)
        resolve(value)
      }
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params: parameters }))
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`cannot reach the browser on port ${port}`))
      }
      socket.onmessage = event => {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
        if (message.id === 1) done(message.error ? null : message.result)
      }
    })
  } finally {
    try {
      socket.close()
    } catch {
      /* already closed */
    }
  }
}

/**
 * Open a url as a tab in a browser that is already running.
 *
 * Every engine belongs in one window, as tabs a person switches between: a
 * window each buries the rest and fills the desktop.
 *
 * `Target.createTarget` makes a window of its own even with `newWindow: false`,
 * so the tab is opened from a page already in the window instead — that is what
 * puts it in the same tab strip. A browser holding no page has no window to add
 * to, so the first page is made the other way. Returns the new page id, or null.
 */
export async function openTabOnPort(port, url, { milliseconds = 8000 } = {}) {
  const before = await pagesOnPort(port)
  const host = before?.find(page => page.webSocketDebuggerUrl)
  if (!host) {
    const made = await browserCommand(port, 'Target.createTarget', { url, newWindow: false })
    return made?.targetId ?? null
  }
  const known = new Set(before.map(page => page.id))
  // A script opens a tab only for a user action, so the evaluation says it is one.
  const opened = await evaluateOnPage(host, `String(!!window.open(${JSON.stringify(url)}, '_blank'))`, {
    userGesture: true
  })
  if (opened !== 'true') return null
  return waitForNewPage(port, known, { milliseconds })
}

/** The id of the first page the port gains, or null at the deadline. */
async function waitForNewPage(port, known, { milliseconds }) {
  const deadline = Date.now() + milliseconds
  for (;;) {
    const pages = await pagesOnPort(port)
    const made = pages?.find(page => !known.has(page.id))
    if (made) return made.id
    if (Date.now() >= deadline) return null
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** Evaluate one expression in one page, over that page's own socket. */
function evaluateOnPage(page, expression, { userGesture = false, timeoutMilliseconds = 5000, open } = {}) {
  const socket = (open ?? (url => new WebSocket(url)))(page.webSocketDebuggerUrl)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      resolve(null)
    }, timeoutMilliseconds)
    const done = value => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      resolve(value)
    }
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, userGesture, returnByValue: true }
        })
      )
    socket.onerror = () => done(null)
    socket.onmessage = event => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      if (message.id === 1) done(message.result?.result?.value ?? null)
    }
  })
}

/** Where one page's window is, and how big. Null when the browser will not say. */
export async function windowOfPage(port, pageId) {
  const found = await browserCommand(port, 'Browser.getWindowForTarget', { targetId: pageId })
  return found ? { windowId: found.windowId, bounds: found.bounds } : null
}

/** What one page says about itself, evaluated in the page. Null when it will not answer. */
export async function pageReports(port, pageId, expression, { timeoutMilliseconds = 4000, open } = {}) {
  const pages = await pagesOnPort(port)
  const page = pages?.find(target => target.id === pageId) ?? pages?.[0]
  if (!page?.webSocketDebuggerUrl) return null
  const socket = (open ?? (url => new WebSocket(url)))(page.webSocketDebuggerUrl)
  try {
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), timeoutMilliseconds)
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true }
          })
        )
      socket.onerror = () => {
        clearTimeout(timer)
        resolve(null)
      }
      socket.onmessage = event => {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
        if (message.id !== 1) return
        clearTimeout(timer)
        resolve(message.result?.result?.value ?? null)
      }
    })
  } finally {
    try {
      socket.close()
    } catch {
      /* already closed */
    }
  }
}

/** The window bounds to ask for: the caller's size, the window's, or a default. */
function requestedBounds(asked, width, height) {
  return {
    windowState: 'normal',
    left: asked.left ?? 20,
    top: asked.top ?? 20,
    width: width ?? asked.width ?? 1400,
    height: height ?? asked.height ?? 900
  }
}

/**
 * Put one page's window on screen, and report whether it is really there.
 *
 * Chrome stores a window's last state in its profile, so a window killed while
 * minimised opens minimised again — with `windowState: "normal"` reported all
 * the same. The bounds are therefore always set, and the page itself is asked
 * whether it is visible, because only the page knows.
 */
export async function showWindow(port, pageId, { width, height } = {}) {
  await activatePage(port, pageId)
  const found = await windowOfPage(port, pageId)
  if (!found) return null
  const asked = found.bounds ?? {}
  await browserCommand(port, 'Browser.setWindowBounds', {
    windowId: found.windowId,
    bounds: requestedBounds(asked, width, height)
  })
  const settled = await windowOfPage(port, pageId)
  const visibility = await pageReports(port, pageId, 'document.visibilityState')
  return { ...(settled?.bounds ?? asked), visible: visibility === 'visible' }
}

/** Close one page. Reports whether the port took it. */
export async function closePage(port, id) {
  const answer = await debuggingPortGet(port, `/json/close/${encodeURIComponent(id)}`)
  return Boolean(answer && answer.status === 200)
}

/** Whether one loopback address can be bound now. An address this host lacks cannot be held. */
function hostIsFree(port, host) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', error => resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
}

/**
 * Whether a port can be bound now.
 *
 * Both loopback addresses are tested: a dev server binds `localhost`, which is
 * the IPv6 address first on Windows, while a browser binds `127.0.0.1`. A port
 * held on either one is not free, and the second binder loses silently.
 */
async function portIsFree(port) {
  for (const host of ['127.0.0.1', '::1']) {
    if (!(await hostIsFree(port, host))) return false
  }
  return true
}

/**
 * A debugging port nothing holds.
 *
 * Counting records gives the same number twice as soon as one lane stops, and
 * the second browser to ask for it loses the bind and gets no debugging port at
 * all. Each candidate is bind-tested, and ports other records name are skipped
 * so two starts at once do not pick the same free one.
 */
export async function findFreeDebuggingPort(root, { from = 9400, tries = 200 } = {}) {
  const taken = new Set(readLaneBrowsers(root).map(entry => Number(entry.port)))
  for (let port = from; port < from + tries; port++) {
    if (taken.has(port)) continue
    if (await portIsFree(port)) return port
  }
  throw new Error(
    `no free debugging port between ${from} and ${from + tries - 1}; ` +
      'see what holds them with: node bin/engine.mjs supervisor, then stop browsers with: supervisor.stop all'
  )
}

/** Why an entry is not proved alive, in the reader's terms. */
function whyNotAlive(entry, running, clients) {
  if (clients) {
    return (
      `port ${entry.port} answers a browser without "${entry.client}"; it has ` +
      (clients.length ? clients.join(', ') : 'no named lane')
    )
  }
  return running ? `process ${entry.pid} does not answer on ${entry.port}` : `process ${entry.pid} is gone`
}

/**
 * Every recorded browser, each proved against its own port.
 *
 * A record says what was true when it was written. A browser killed outright
 * gets no chance to remove its entry, so the port is asked before an entry is
 * reported alive. A headless lane's reply must name this lane, because any
 * browser can answer a port; a visible window has no lane page, so a port that
 * answers at all is the proof.
 */
/** What a recorded browser is doing, from what answered on its port. */
function browserState(mine, clients, running) {
  if (mine) return 'running'
  if (clients) return 'wrong browser'
  if (running) return 'not answering'
  return 'gone'
}

/** Every recorded lane browser under `root`, each with its live state. */
export async function listLaneBrowsers(root) {
  const browsers = readLaneBrowsers(root)
  return Promise.all(
    browsers.map(async entry => {
      const running = alive(entry.pid)
      const clients = running ? await clientsOnPort(entry.port) : null
      const mine = entry.headless ? Boolean(clients?.includes(entry.client)) : clients !== null
      return {
        ...entry,
        alive: mine,
        state: browserState(mine, clients, running),
        ...(mine ? {} : { why: whyNotAlive(entry, running, clients) })
      }
    })
  )
}

/**
 * Make a client name available, or refuse because a browser still holds it.
 *
 * One name is one browser. Replacing the record would leave the running
 * Chromium and its profile directory with nothing pointing at them, so no later
 * stop could reach either. A record whose process is gone is litter: it and its
 * profile directory are removed and the name is free again.
 *
 * Returns the record it removed, or null when the name was already free.
 */
export async function freeLaneName(root, client) {
  const found = recordFor(root, client)
  if (!found) return null
  if (alive(found.pid)) {
    const port = (await answers(found.port)) ? `answering on port ${found.port}` : `not answering on port ${found.port}`
    throw new Error(
      `a browser is already called "${client}": process ${found.pid}, ${port}` +
        (found.startedAt ? `, started ${found.startedAt}` : '') +
        `; stop it with: node bin/engine.mjs supervisor.stop <id> (list ids with: node bin/engine.mjs supervisor) or: node bin/engine.mjs lanes.stop ${client}, or open with another client name`
    )
  }
  forgetLaneBrowser(root, client)
  // A lane's profile is temporary. A visible window keeps its profile so window
  // size, zoom and open tabs return; a dead record does not discard it.
  if (found.headless !== false && found.profile) {
    try {
      fs.rmSync(found.profile, { recursive: true, force: true })
    } catch {
      /* held; harmless */
    }
  }
  return found
}

/**
 * The port to start on: the one asked for, unless it cannot be had.
 *
 * A port another record names is never used, whoever asked for it — the second
 * browser to bind loses, and Chrome that lost the bind opens no debugging port
 * at all. A port bound by something this registry does not describe is refused
 * instead, because a caller that named it needs to know why.
 */
async function pickDebuggingPort(root, asked) {
  const wanted = Number(asked)
  if (!wanted) return findFreeDebuggingPort(root)
  if (readLaneBrowsers(root).some(entry => Number(entry.port) === wanted)) {
    return findFreeDebuggingPort(root)
  }
  if (!(await portIsFree(wanted))) {
    throw new Error(
      `port ${wanted} is already bound, so a browser started on it would have no debugging port. ` +
        `Stop the holder with: node bin/engine.mjs supervisor.stop <id> ` +
        `(node bin/engine.mjs supervisor lists ids), or leave the port unset to take a free one.`
    )
  }
  return wanted
}

/**
 * What Chrome is told to open. Separate from the start so a test can read it
 * without running a browser.
 */
export const laneBrowserArguments = ({ port, profile, width, height, page }) => [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--window-size=${width},${height}`,
  // One CSS pixel is one device pixel, so a frame's file dimensions are the
  // profile that was asked for. Without it a HiDPI host writes the same profile
  // at twice the size and two machines disagree about one frame.
  '--force-device-scale-factor=1',
  page
]

/**
 * Wait until this lane's own browser answers and has opened the page.
 *
 * A version alone proves only that some browser holds the port, and a lane
 * declared ready on another browser's reply has no debugging port of its own.
 * `answered` says whether any browser was there at all, which decides the
 * failure sentence.
 */
async function waitForLanePage(debuggingPort, client, browser) {
  let answered = false
  for (let attempt = 0; attempt < 80; attempt++) {
    const version = await browserVersion(debuggingPort)
    if (version) {
      answered = true
      const clients = await clientsOnPort(debuggingPort)
      if (clients?.includes(client)) return { ready: true, answered, version }
    }
    if (browser.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return { ready: false, answered, version: null }
}

/**
 * Start a headless browser for one lane and wait until its page is up.
 *
 * `client` becomes the page's bridge name, passed in the URL, so the caller
 * targets it with `--client <name>` without first reading a value the browser
 * chose for itself.
 *
 * `port` is optional and only a request; `pickDebuggingPort` decides. Ready
 * means this lane's own browser answered, not that the port answered.
 */
export async function startLaneBrowser(
  root,
  { client, url, port, width = 540, height = 960, chrome = findChrome(root) }
) {
  if (!client) throw new Error('a lane browser needs a client name')
  await freeLaneName(root, client)
  const debuggingPort = await pickDebuggingPort(root, port)
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', `lane-${client}-`))
  const page = url + (url.includes('?') ? '&' : '?') + `client=${encodeURIComponent(client)}`

  // Detached with no pipes: the browser has to outlive the command that started
  // it, the way a dev server does. Inheriting stdio would end it when the
  // starting process exits and close the pipes.
  const browser = spawn(chrome, laneBrowserArguments({ port: debuggingPort, profile, width, height, page }), {
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  })
  browser.unref()

  const entry = {
    client,
    port: debuggingPort,
    url: page,
    pid: browser.pid,
    profile,
    serves: root,
    // A lane has no window; only the visible editor is not headless.
    headless: true,
    // Which binary rendered. A lane that fell back to an installed Chrome is
    // then visible in the registry rather than silent.
    chrome,
    // What Chrome was told, not what any frame measures. `recordLaneViewport`
    // adds what the page reports, under its own name.
    windowAsked: `${width}x${height}`,
    startedAt: new Date().toISOString()
  }
  // Written before the wait, so a browser that never comes up is still findable
  // and stoppable rather than an orphan nothing recorded.
  recordLaneBrowser(root, entry)

  const outcome = await waitForLanePage(debuggingPort, client, browser)
  if (outcome.ready) return { ...recordLaneBrowser(root, { ...entry, version: outcome.version }), ready: true, browser }

  try {
    browser.kill()
  } catch {
    /* already gone */
  }
  forgetLaneBrowser(root, client)
  // Windows holds the profile until the process is gone; a start that failed
  // must not leave a directory nothing records.
  await new Promise(resolve => setTimeout(resolve, 500))
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* held; harmless */
  }
  throw new Error(
    outcome.answered
      ? `port ${debuggingPort} answers a browser that never opened "${client}"; another browser holds it`
      : `the lane browser for "${client}" never opened its debugging port ${debuggingPort}`
  )
}

/** Stop one recorded browser and forget it. */
function stopLaneBrowser(root, entry) {
  const was = alive(entry.pid) ? 'running' : 'gone'
  try {
    if (was === 'running') process.kill(entry.pid)
  } catch {
    /* raced us */
  }
  forgetLaneBrowser(root, entry.client)
  return { client: entry.client, port: entry.port, pid: entry.pid, was }
}

/** Remove a profile directory, once Windows has released it. */
function removeLaneProfile(profile) {
  if (!profile) return
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* held; harmless */
  }
}

/** Mark every stopped entry whose port still answers. */
async function markStillAnswering(stopped) {
  for (const entry of stopped) {
    if (await answers(entry.port)) entry.stillAnswering = true
  }
}

/**
 * The warning for browsers this registry does not describe.
 *
 * A port that still answers is a browser this stop did not reach. Reporting the
 * records removed without saying so would call the checkout clear.
 */
function unansweredWarning(missed) {
  if (!missed.length) return {}
  return {
    warning:
      `port ${missed.map(entry => entry.port).join(', ')} still answers after the stop. ` +
      `A browser is attached that this registry does not describe. ` +
      'See every instance with: node bin/engine.mjs supervisor, then stop one with: supervisor.stop <id>.'
  }
}

/**
 * Stop recorded browsers and remove their records.
 *
 * With no name, stops only headless lanes: the person's visible editor window
 * must survive a lane sweep. A named client is stopped whatever kind it is, and
 * `all` stops every recorded browser.
 *
 * A profile directory is removed only after its browser is gone, because
 * Windows holds the files while it runs.
 */
export async function stopLaneBrowsers(root, client = null, { all = false } = {}) {
  const wanted = readLaneBrowsers(root).filter(
    entry => all || (client === null ? entry.headless !== false : entry.client === client)
  )
  const stopped = wanted.map(entry => stopLaneBrowser(root, entry))
  // Give Windows a moment to release the profile before deleting it.
  if (stopped.length) await new Promise(resolve => setTimeout(resolve, 500))
  for (const entry of wanted) removeLaneProfile(entry.profile)
  await markStillAnswering(stopped)
  const missed = stopped.filter(entry => entry.stillAnswering)
  return {
    stopped,
    remaining: readLaneBrowsers(root).length,
    ...unansweredWarning(missed)
  }
}
