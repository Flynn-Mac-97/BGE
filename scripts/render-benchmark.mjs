/**
 * Measure what one real frame costs, stage by stage, in a real browser.
 *
 * The headline question is whether anything on the kernel side is a render
 * bottleneck. The kernel is the pass graph's executor and the frame's setup; a
 * pass is everything a draw does, and the entity walk is one of them. This starts a dev server and
 * a hidden Chrome with a real GPU, builds three scenes through the engine's own
 * world surface, reads the kernel's own per-pass costs, drives fixed frames on
 * a stopped clock, and writes the numbers to `agent-runs/benchmark-results.json`
 * and `agent-runs/benchmark-report.md`.
 *
 * It measures; it asserts nothing. `check-render-benchmark.mjs` is the guard.
 *
 * Run it with `npm run bench:render`. It needs Chrome under `.browsers`, which
 * `findChrome` locates. Nothing here is part of `npm run check`, because it
 * needs a browser.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome } from '../engine/chrome-path.mjs'
import { recordServer, forgetServer } from '../engine/project-servers.mjs'
import { recordLaneBrowser, forgetLaneBrowser } from '../engine/lane-browsers.mjs'
import { renderReport } from './render-benchmark-report.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const checkout = path.join(here, '..')
const resultsFile = path.join(checkout, 'agent-runs', 'benchmark-results.json')
const reportFile = path.join(checkout, 'agent-runs', 'benchmark-report.md')
const baselineFile = path.join(here, 'render-benchmark-baseline.json')
const driverFile = path.join(here, 'render-benchmark-driver.js')

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** A port nothing is listening on. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Vite's script, found by walking up from the checkout as Node resolves a package. */
function viteScript(from) {
  for (let directory = path.resolve(from); ; directory = path.dirname(directory)) {
    const script = path.join(directory, 'node_modules', 'vite', 'bin', 'vite.js')
    if (fs.existsSync(script)) return script
    if (path.dirname(directory) === directory) throw new Error(`no node_modules/vite above ${from}`)
  }
}

/** Stop a process and every process it started; Vite leaves esbuild behind. */
function stopTree(child) {
  if (!child) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else if (child.exitCode === null) child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

/**
 * Ask the browser to quit through its own debugging port.
 *
 * On Windows the spawned process is a launcher that exits once the browser is
 * up, so killing it leaves the browser holding the card.
 */
async function closeBrowser(port) {
  try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    const socket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await sleep(500)
    socket.close()
  } catch {
    /* already gone */
  }
}

async function waitFor(what, check, milliseconds) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    try {
      const answer = await check()
      if (answer) return answer
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** One DevTools connection to the first page, with `call` and `evaluate`. */
async function connect(port) {
  const page = await waitFor(
    'the browser page',
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      return list.find(target => target.type === 'page' && target.url.startsWith('http'))
    },
    30000
  )
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let nextId = 0
  const events = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method) events.push(message)
  })
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const listen = event => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        socket.removeEventListener('message', listen)
        message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)
      }
      socket.addEventListener('message', listen)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
  }
  return { call, evaluate, events, close: () => socket.close() }
}

/** The lines the page logged, for a failed run to explain itself. */
function pageConsole(events) {
  return events
    .filter(message => message.method === 'Runtime.consoleAPICalled' || message.method === 'Runtime.exceptionThrown')
    .map(message => {
      if (message.method === 'Runtime.exceptionThrown') {
        return `EXCEPTION ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`
      }
      return message.params.args.map(argument => argument.value ?? argument.description).join(' ')
    })
    .slice(-20)
}

/** The measured numbers the check compares against, with their tolerance. */
function budgetsFrom(results) {
  const atEntity = count => results.entityCurve.find(entry => entry.entities === count)
  const atPass = count => results.passCurve.find(entry => entry.probePasses === count)
  return {
    // A share is an absolute difference because it is already a fraction. A time
    // is a multiple of the measured value plus a floor, because the page's clock
    // is quantised and a stage that measured near zero would otherwise trip on
    // the quantum alone.
    scenes: Object.fromEntries(
      results.scenes.map(scene => [
        scene.name,
        { sceneExtractShare: scene.sceneExtractShare, sceneExtractShareTolerance: 0.35 }
      ])
    ),
    entityCurve: {
      walkMsAt10000: atEntity(10000)?.walkMs ?? null,
      tolerance: 0.75,
      floorMs: 0.5,
      walkGrowthRatio: atEntity(1000)?.walkMs ? (atEntity(10000)?.walkMs ?? 0) / atEntity(1000).walkMs : null
    },
    passCurve: {
      executorOverheadMsAt50: atPass(50)?.executorOverheadMs ?? null,
      tolerance: 1,
      floorMs: 0.25
    }
  }
}

const argumentsFrom = process.argv.slice(2)
const flagValue = name => {
  const at = argumentsFrom.indexOf(name)
  return at >= 0 ? argumentsFrom[at + 1] : null
}
const wantsBaseline = argumentsFrom.includes('--write-baseline')

const config = {
  viewport: [1280, 720],
  // `--show <scene>` builds that scene and leaves it on screen instead of
  // measuring, and `--screenshot <file>` captures it and exits.
  show: flagValue('--show') || null,
  frames: Number(flagValue('--frames') || 90),
  warmupFrames: Number(flagValue('--warmup') || 60),
  scenes: [
    { name: 'retro-2d', kind: 'retro2d', entities: 400 },
    { name: 'mid', entities: 3000, material: 'lambert' },
    { name: 'aaa', entities: 2500, material: 'standard', unmergeable: true, shadows: true, post: 'cinematic', probePasses: 16, settle: 2000 }
  ],
  entityCurve: [1, 100, 1000, 10000],
  passCurve: [1, 10, 50],
  passCurveEntities: 300
}

const project = flagValue('--project') || path.join(checkout, 'test', 'fixture-project')
const serverPort = await freePort()
const debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(tmpdir(), 'render-benchmark-'))
const client = `render-benchmark-${serverPort}`

let server = null
let chrome = null
let page = null
let results = null
let failure = null

try {
  server = spawn(process.execPath, [viteScript(checkout), '--port', String(serverPort), '--strictPort'], {
    cwd: checkout,
    env: { ...process.env, ENGINE_PROJECT: project },
    stdio: 'ignore',
    windowsHide: true
  })
  try {
    recordServer(checkout, {
      port: serverPort,
      pid: server.pid,
      serves: checkout,
      project,
      url: `http://localhost:${serverPort}`,
      startedAt: new Date().toISOString()
    })
  } catch {
    /* a benchmark must not stop because the registry is busy */
  }
  await waitFor('the dev server', async () => (await fetch(`http://localhost:${serverPort}/api/project`)).ok, 180000)

  const browser = findChrome(checkout)
  chrome = spawn(
    browser,
    [
      // A visible window only when a caller asked to look at a scene; headless is
      // the default so a measurement never depends on a display.
      ...(config.show ? [] : ['--headless=new']),
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      // Exposes `window.gc`, so a reported heap is measured after a collection
      // rather than as whatever the collector has not yet reclaimed.
      '--js-flags=--expose-gc',
      '--disk-cache-size=1',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${config.viewport[0]},${config.viewport[1]}`,
      `http://localhost:${serverPort}/?client=${encodeURIComponent(client)}`
    ],
    // `windowsHide` maps to CREATE_NO_WINDOW, which hides a GUI app's window too.
    // That is fine for a measurement and fatal for `--show`, which exists to be
    // looked at, and a hidden tab does not draw either.
    { stdio: 'ignore', windowsHide: !config.show }
  )
  try {
    recordLaneBrowser(checkout, {
      client,
      port: debugPort,
      url: `http://localhost:${serverPort}/?client=${encodeURIComponent(client)}`,
      pid: chrome.pid,
      profile,
      serves: checkout,
      chrome: browser,
      headless: !config.show,
      startedAt: new Date().toISOString()
    })
  } catch {
    /* the benchmark still runs when the browser cannot record itself */
  }

  page = await connect(debugPort)
  await page.call('Runtime.enable')
  await page.call('Log.enable')

  // The renderer exists once the shell is attached; the materials arrive after
  // three's dynamic import resolves, which is the slowest half of boot.
  await waitFor(
    'the editor and its materials',
    () => page.evaluate("!!window.engine?.renderer && window.engine.renderer.materials.has('standard')"),
    240000
  )
  const driver = fs.readFileSync(driverFile, 'utf8')
  results = await page.evaluate(`(${driver})(${JSON.stringify(config)})`)
  results.problem = null

  if (config.show) {
    await page.call('Page.enable')
    const screenshot = flagValue('--screenshot')
    if (screenshot) {
      const shot = await page.call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.resolve(screenshot), Buffer.from(shot.data, 'base64'))
      console.log(`render-benchmark: wrote the ${config.show} scene to ${screenshot}`)
    } else {
      console.log(
        `render-benchmark: showing the ${config.show} scene (${results.entities} entities). ` +
          'Close the window or press Ctrl+C when you are done.'
      )
      // The window stays until the caller closes it, so the finally that would
      // stop the browser and the dev server is deliberately never reached.
      await new Promise(() => {})
    }
  }
} catch (error) {
  failure = error
} finally {
  if (results === null && failure) {
    results = {
      problem: String(failure?.message || failure),
      console: page ? pageConsole(page.events) : []
    }
  }
  page?.close()
  await closeBrowser(debugPort)
  stopTree(chrome)
  stopTree(server)
  await sleep(1000)
  try {
    forgetLaneBrowser(checkout, client)
  } catch {
    /* gone */
  }
  try {
    forgetServer(checkout, serverPort, server?.pid)
  } catch {
    /* gone */
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Windows holds the profile briefly */
  }
}

// Show mode has no tables to write: it either held the window open above or
// wrote a screenshot, and the browser and dev server are already stopped.
if (config.show) process.exit(0)

results.measuredAt = new Date().toISOString()
results.checkout = checkout
fs.mkdirSync(path.dirname(resultsFile), { recursive: true })
if (results.problem) {
  fs.writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`)
  console.error(`render-benchmark: ${results.problem}`)
  for (const line of results.console || []) console.error(`  ${line}`)
  process.exit(1)
}

results.budgets = budgetsFrom(results)
fs.writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`)
// The measured tables are generated; the reading of them is a committed file,
// so a re-run refreshes the numbers without erasing the analysis.
const notesFile = path.join(here, 'render-benchmark-notes.md')
const notes = fs.existsSync(notesFile) ? `
${fs.readFileSync(notesFile, 'utf8').trim()}
` : ''
fs.writeFileSync(reportFile, renderReport(results) + notes)

if (wantsBaseline) {
  fs.writeFileSync(baselineFile, `${JSON.stringify({ measuredAt: results.measuredAt, budgets: results.budgets }, null, 2)}\n`)
  console.log(`render-benchmark: wrote the baseline to ${path.relative(checkout, baselineFile)}`)
}

console.log(`render-benchmark: ${config.frames} frames after ${config.warmupFrames} warmup, viewport ${config.viewport.join('x')}`)
console.log(`render-benchmark: backend ${results.environment.backend?.name}, gpu ${results.environment.gpu?.renderer}`)
for (const scene of results.scenes) {
  console.log(
    `  ${scene.name.padEnd(9)} entities ${String(scene.entities).padStart(5)}  frame ${scene.stepMs} ms  ` +
      `walk ${scene.walkMs} ms  setup ${scene.kernelSetupMs} ms  executor ${scene.executorMs} ms  ` +
      `walk share ${(scene.sceneExtractShare * 100).toFixed(1)}%`
  )
}
console.log(`render-benchmark: wrote ${path.relative(checkout, resultsFile)}`)
console.log(`render-benchmark: wrote ${path.relative(checkout, reportFile)}`)
