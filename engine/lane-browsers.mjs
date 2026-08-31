/**
 * Headless browsers started to render for a lane.
 *
 * A lane needs real pixels, and taking them from the person's browser is what
 * made five parallel lanes fight over one tab. Each lane gets its own headless
 * Chromium instead, attached to its own dev server under a name it chose.
 *
 * A browser with no window is invisible: it has no taskbar entry, and a
 * forgotten one is only findable by reading process command lines. So every one
 * is written down here, and the reader proves an entry by asking its debugging
 * port rather than trusting the file — the same rule the server registry
 * follows, for the same reason.
 *
 * One client name is one browser. A start that overwrote a live record would
 * lose the only handle on a running process, so it is refused instead.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'

/** Where Chrome is, in the order worth trying. */
const CHROME_PLACES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean)

export function findChrome() {
  const found = CHROME_PLACES.find(place => fs.existsSync(place))
  if (!found) {
    throw new Error(`no Chrome found. Tried:\n  ${CHROME_PLACES.join('\n  ')}\nSet CHROME_PATH to point at one.`)
  }
  return found
}

const registryFile = root => path.join(root, 'project/.engine/lane-browsers.json')

export function readLaneBrowsers(root) {
  try {
    const value = JSON.parse(fs.readFileSync(registryFile(root), 'utf8'))
    return Array.isArray(value.browsers) ? value.browsers : []
  } catch { return [] }
}

function writeLaneBrowsers(root, browsers) {
  const file = registryFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: 1, browsers }, null, 2) + '\n', 'utf8')
}

/** Add or replace the entry for a client name. */
export function recordLaneBrowser(root, entry) {
  const kept = readLaneBrowsers(root).filter(other => other.client !== entry.client)
  writeLaneBrowsers(root, [...kept, entry])
  return entry
}

export function forgetLaneBrowser(root, client) {
  writeLaneBrowsers(root, readLaneBrowsers(root).filter(entry => entry.client !== client))
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
 * Ask a debugging port who it is, or null if it does not answer.
 *
 * The body is read even though only the status matters: an unread body holds
 * its socket open, and a socket still closing when the process exits trips a
 * libuv assertion on Windows that is printed after the command's own output.
 */
function ask(port) {
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1', port, path: '/json/version', agent: false, timeout: 1500
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.once('end', () => {
        request.destroy()
        if (response.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(body)) } catch { resolve(null) }
      })
    })
    const fail = () => { request.destroy(); resolve(null) }
    request.once('error', fail)
    request.once('timeout', fail)
  })
}

// node:http with `agent: false`, not fetch: fetch keeps its connection in a
// pool this code cannot close, and a socket still closing when the CLI exits
// aborts the process on Windows with a libuv assertion. Here the socket is this
// function's to destroy.
const answers = port => ask(port).then(said => said !== null)

const alive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * Every recorded lane browser, each proved against its own port.
 *
 * A record says what was true when it was written. A browser killed outright
 * gets no chance to remove its entry, so the port is asked before an entry is
 * reported alive.
 */
export async function listLaneBrowsers(root) {
  const browsers = readLaneBrowsers(root)
  return Promise.all(browsers.map(async entry => {
    const running = alive(entry.pid)
    const reachable = running ? await answers(entry.port) : false
    return {
      ...entry,
      alive: reachable,
      state: reachable ? 'running' : running ? 'not answering' : 'gone',
      ...(reachable ? {} : { why: running ? `process ${entry.pid} does not answer on ${entry.port}` : `process ${entry.pid} is gone` })
    }
  }))
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
    const port = await answers(found.port)
      ? `answering on port ${found.port}`
      : `not answering on port ${found.port}`
    throw new Error(
      `a lane browser is already called "${client}": process ${found.pid}, ${port}`
      + (found.startedAt ? `, started ${found.startedAt}` : '')
      + `.\nStop it first:  node bin/engine.mjs lanes.stop ${client}`)
  }
  forgetLaneBrowser(root, client)
  if (found.profile) {
    try { fs.rmSync(found.profile, { recursive: true, force: true }) } catch { /* held; harmless */ }
  }
  return found
}

/**
 * What Chrome is told to open. Separate from the start so a test can read it
 * without running a browser.
 */
export const laneBrowserArguments = ({ port, profile, width, height, page }) => [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  `--window-size=${width},${height}`,
  // One CSS pixel is one device pixel, so a frame's file dimensions are the
  // profile that was asked for. Without it a HiDPI host writes the same profile
  // at twice the size and two machines disagree about one frame.
  '--force-device-scale-factor=1',
  page
]

/**
 * Start a headless browser for one lane and wait until its page is up.
 *
 * `client` becomes the page's bridge name, passed in the URL, so the caller
 * targets it with `--client <name>` without first reading a value the browser
 * chose for itself.
 */
export async function startLaneBrowser(root, {
  client, url, port, width = 540, height = 960, chrome = findChrome()
}) {
  if (!client) throw new Error('a lane browser needs a client name')
  await freeLaneName(root, client)
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', `lane-${client}-`))
  const page = url + (url.includes('?') ? '&' : '?') + `client=${encodeURIComponent(client)}`

  // Detached with no pipes: the browser has to outlive the command that started
  // it, the way a dev server does. Inheriting stdio would end it when the
  // starting process exits and close the pipes.
  const browser = spawn(chrome, laneBrowserArguments({ port, profile, width, height, page }),
    { stdio: 'ignore', detached: true })
  browser.unref()

  const entry = {
    client, port, url: page, pid: browser.pid, profile, serves: root,
    // What Chrome was told, not what any frame measures. `recordLaneViewport`
    // adds what the page reports, under its own name.
    windowAsked: `${width}x${height}`, startedAt: new Date().toISOString()
  }
  // Written before the wait, so a browser that never comes up is still findable
  // and stoppable rather than an orphan nothing recorded.
  recordLaneBrowser(root, entry)

  for (let attempt = 0; attempt < 80; attempt++) {
    const version = await browserVersion(port)
    if (version) {
      return { ...recordLaneBrowser(root, { ...entry, version }), ready: true, browser }
    }
    if (browser.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  try { browser.kill() } catch { /* already gone */ }
  forgetLaneBrowser(root, client)
  // Windows holds the profile until the process is gone; a start that failed
  // must not leave a directory nothing records.
  await new Promise(resolve => setTimeout(resolve, 500))
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* held; harmless */ }
  throw new Error(`the lane browser for "${client}" never opened its debugging port ${port}`)
}

/**
 * Stop lane browsers and remove their records.
 *
 * With no name, stops every recorded one. A profile directory is removed only
 * after its browser is gone, because Windows holds the files while it runs.
 */
export async function stopLaneBrowsers(root, client = null) {
  const wanted = readLaneBrowsers(root).filter(entry => !client || entry.client === client)
  const stopped = []
  for (const entry of wanted) {
    const was = alive(entry.pid) ? 'running' : 'gone'
    try { if (was === 'running') process.kill(entry.pid) } catch { /* raced us */ }
    forgetLaneBrowser(root, entry.client)
    stopped.push({ client: entry.client, port: entry.port, pid: entry.pid, was })
  }
  // Give Windows a moment to release the profile before deleting it.
  if (stopped.length) await new Promise(resolve => setTimeout(resolve, 500))
  for (const entry of wanted) {
    if (entry.profile) {
      try { fs.rmSync(entry.profile, { recursive: true, force: true }) } catch { /* held; harmless */ }
    }
  }
  // A port that still answers is a browser this stop did not reach. Reporting
  // the records removed without saying so would call the checkout clear.
  for (const entry of stopped) {
    if (await answers(entry.port)) entry.stillAnswering = true
  }
  const missed = stopped.filter(entry => entry.stillAnswering)
  return {
    stopped,
    remaining: readLaneBrowsers(root).length,
    ...(missed.length ? {
      warning: `port ${missed.map(entry => entry.port).join(', ')} still answers after the stop. `
        + `A browser is attached that this registry does not describe.`
    } : {})
  }
}
