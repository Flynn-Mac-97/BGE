/**
 * Hold a headless Chromium on the editor so the CLI can drive it.
 *
 * Proves the real path: a lane's renderer with no window and no shared tab.
 * Exits when killed; prints the renderer string and the debugging port first.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.argv[2] || 'http://localhost:5180/'
const PORT = Number(process.argv[3] || 9333)
const [WIDTH, HEIGHT] = (process.argv[4] || '540x960').split('x').map(Number)
// The page takes this as its bridge name, so the caller targets it with
// `--client <name>` without first reading a value the browser chose.
const NAME = process.argv[5] || `headless-${PORT}`
const URL = BASE + (BASE.includes('?') ? '&' : '?') + `client=${encodeURIComponent(NAME)}`

const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'lane-chrome-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  `--window-size=${WIDTH},${HEIGHT}`,
  URL
], { stdio: ['ignore', 'pipe', 'pipe'] })

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

const stop = () => { chrome.kill(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
await new Promise(() => {})
