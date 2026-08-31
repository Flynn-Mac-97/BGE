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

/**
 * Whether a debugging port still answers as the browser we started.
 *
 * The body is read even though only the status matters: an unread body holds
 * its socket open, and a socket still closing when the process exits trips a
 * libuv assertion on Windows that is printed after the command's own output.
 */
function answers(port) {
  // node:http with `agent: false`, not fetch: fetch keeps its connection in a
  // pool this code cannot close, and a socket still closing when the CLI exits
  // aborts the process on Windows with a libuv assertion. Here the socket is
  // this function's to destroy.
  return new Promise(resolve => {
    const request = http.get({
      host: '127.0.0.1', port, path: '/json/version', agent: false, timeout: 1500
    }, response => {
      const ok = response.statusCode === 200
      response.resume()
      response.once('end', () => { request.destroy(); resolve(ok) })
    })
    const fail = () => { request.destroy(); resolve(false) }
    request.once('error', fail)
    request.once('timeout', fail)
  })
}

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
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', `lane-${client}-`))
  const page = url + (url.includes('?') ? '&' : '?') + `client=${encodeURIComponent(client)}`

  // Detached with no pipes: the browser has to outlive the command that started
  // it, the way a dev server does. Inheriting stdio would end it when the
  // starting process exits and close the pipes.
  const browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    `--window-size=${width},${height}`,
    page
  ], { stdio: 'ignore', detached: true })
  browser.unref()

  const entry = {
    client, port, url: page, pid: browser.pid, profile, serves: root,
    profileSize: `${width}x${height}`, startedAt: new Date().toISOString()
  }
  // Written before the wait, so a browser that never comes up is still findable
  // and stoppable rather than an orphan nothing recorded.
  recordLaneBrowser(root, entry)

  for (let attempt = 0; attempt < 80; attempt++) {
    if (await answers(port)) return { ...entry, ready: true, browser }
    if (browser.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  try { browser.kill() } catch { /* already gone */ }
  forgetLaneBrowser(root, client)
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
    try { fs.rmSync(entry.profile, { recursive: true, force: true }) } catch { /* held; harmless */ }
  }
  return { stopped, remaining: readLaneBrowsers(root).length }
}
