/**
 * Hold a headless Chromium on the editor so the CLI can drive it.
 *
 * Proves the real path: a lane's renderer with no window and no shared tab.
 * Prints the debugging port first. Exits, deleting its profile, when Chrome
 * stops.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findChrome } from '../engine/chrome-path.mjs'
import { recordLaneBrowser, forgetLaneBrowser } from '../engine/lane-browsers.mjs'

const CHROME = findChrome(process.cwd())
const BASE = process.argv[2] || 'http://localhost:5180/'
const PORT = Number(process.argv[3] || 9333)
const [WIDTH, HEIGHT] = (process.argv[4] || '540x960').split('x').map(Number)
// The page takes this as its bridge name, so the caller targets it with
// `--client <name>` without first reading a value the browser chose.
const NAME = process.argv[5] || `headless-${PORT}`
const URL = BASE + (BASE.includes('?') ? '&' : '?') + `client=${encodeURIComponent(NAME)}`

// In agent-runs, not the system temp directory: that is on the system drive,
// which is the first to fill, and `agent.sweep` clears agent-runs.
const profiles = path.resolve('agent-runs', 'chrome-profiles')
fs.mkdirSync(profiles, { recursive: true })
const profile = fs.mkdtempSync(path.join(profiles, 'lane-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disk-cache-size=1',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  `--window-size=${WIDTH},${HEIGHT}`,
  URL
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

// Written before the wait, so a browser that never comes up is still findable
// and stoppable by `lanes` or the supervisor, the same as a lane browser.
try {
  recordLaneBrowser(process.cwd(), {
    client: NAME, port: PORT, url: URL, pid: chrome.pid, profile,
    serves: process.cwd(), chrome: CHROME, headless: true, startedAt: new Date().toISOString()
  })
} catch (error) {
  process.stderr.write(`could not record the browser: ${error.message}\n`)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

for (let attempt = 0; attempt < 80; attempt++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find(target => target.type === 'page' && target.url.startsWith('http'))
    if (page) {
      console.log(JSON.stringify({
        ready: true, client: NAME, port: PORT, url: page.url, profile: `${WIDTH}x${HEIGHT}`,
        drive: `node bin/engine.mjs snapshot --client ${NAME}`
      }))
      break
    }
  } catch { /* not up yet */ }
  await sleep(250)
}

/**
 * Delete the throwaway profile once Chrome has gone.
 *
 * A profile is hundreds of megabytes of cache, and every run makes a new one.
 * Windows holds the files for a moment after the process ends, so removal is
 * retried. Stop this tool by stopping Chrome: a force-killed node process runs
 * no handler at all, and Chrome's exit is what triggers the clean-up.
 */
async function removeProfile() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); return } catch { await sleep(250) }
  }
}

chrome.on('exit', async () => {
  // The record is removed before the profile, so a listing that races this
  // exit sees the browser gone rather than a record pointing at a dead port.
  try { forgetLaneBrowser(process.cwd(), NAME) } catch { /* the registry is already unreadable */ }
  await removeProfile()
  process.exit(0)
})
const stop = () => chrome.kill()
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
await new Promise(() => {})
