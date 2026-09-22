/**
 * What a level costs to draw in a real browser, for a dream task.
 *
 * The headless helpers price the engine's own JavaScript. A heavy scene's cost
 * is also on the graphics card: pixels, shaders, shadow passes and draw calls.
 * Only a browser with a GPU measures that, so this helper starts one from the
 * candidate's own checkout, measures, and stops everything it started.
 *
 * It starts its own dev server and its own hidden Chrome on free ports, so a
 * score never depends on a server or a tab someone else has open. Candidates
 * are scored one at a time, so no two measurements share the card.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findChrome } from '../../engine/chrome-path.mjs'
import { recordServer, forgetServer } from '../../engine/project-servers.mjs'
import { recordLaneBrowser, forgetLaneBrowser } from '../../engine/lane-browsers.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** A port nothing is listening on. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, () => { const { port } = server.address(); server.close(() => resolve(port)) })
  })
}

/** The Vite script, found by walking up from the checkout, as Node resolves a package. */
function viteScript(checkout) {
  for (let directory = path.resolve(checkout); ; directory = path.dirname(directory)) {
    const script = path.join(directory, 'node_modules', 'vite', 'bin', 'vite.js')
    if (fs.existsSync(script)) return script
    if (path.dirname(directory) === directory) throw new Error(`no node_modules/vite above ${checkout}`)
  }
}

/** Stop a process and every process it started. Vite leaves esbuild running otherwise. */
function stopTree(child) {
  if (!child) return
  try {
    // The tree is killed even when the process this holds has already exited:
    // Chrome's launcher exits as soon as the browser it started is up, and the
    // browser itself is what holds a whole scene on the graphics card.
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else if (child.exitCode === null) child.kill('SIGKILL')
  } catch { /* already gone */ }
}

/**
 * Ask Chrome itself to quit, through the debugging port it was started with.
 *
 * Killing the process the helper spawned is not enough on Windows: that process
 * is a launcher which exits as soon as the browser is up, so the browser that
 * holds the scene is left behind with no parent to kill it. Browser.close ends
 * every process of that browser.
 */
async function closeBrowser(cdpPort) {
  try {
    const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()
    const socket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await sleep(500)
    socket.close()
  } catch { /* the browser is already gone, or never came up */ }
}

/** Poll until `check` answers something truthy, or throw after `ms`. */
async function waitFor(what, check, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const answer = await check(); if (answer) return answer } catch { /* not up yet */ }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** One DevTools connection to the first page, with `call` and `evaluate`. */
async function connect(cdpPort) {
  const page = await waitFor('the Chrome page', async () => {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    return list.find(target => target.type === 'page' && target.url.startsWith('http'))
  }, 30000)
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const call = (method, params = {}) => new Promise((resolve, reject) => {
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
  return { call, evaluate, close: () => socket.close() }
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[sorted.length >> 1] : null
}
const percentile = (values, share) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] : null
}
const round = value => value === null ? null : Math.round(value * 100) / 100

/** How long the drawn frame must stay the same before it counts as settled. */
const STEADY_MS = 6000

/**
 * Wait until the page draws a frame with no post chain compiling, and draws the
 * same calls, triangles and merged count for `STEADY_MS`.
 *
 * Models load after the level does, and merging takes 45 still frames after
 * that, so an earlier frame draws a different scene from the one that settles.
 */
async function waitForDrawing(page, what) {
  let last = null
  let steadySince = Date.now()
  await waitFor(what, async () => {
    const drawn = await page.evaluate(`(() => {
      const stats = window.engine?.renderStats?.()
      if (!stats || stats.error || stats.drawCalls === 0 || String(stats.post).includes('compiling')) return null
      return [stats.drawCalls, stats.triangles, stats.merged, stats.batches].join(' ')
    })()`)
    if (drawn !== last) { last = drawn; steadySince = Date.now() }
    return drawn !== null && Date.now() - steadySince >= STEADY_MS
  }, 300000)
}

/** Mean colour difference between two PNG data URLs, 0 to 1, measured in the page. */
const COMPARE = `async (first, second) => {
  const pixels = async url => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = new OffscreenCanvas(320, 180)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, 320, 180)
    return context.getImageData(0, 0, 320, 180).data
  }
  const a = await pixels(first)
  const b = await pixels(second)
  let total = 0
  let changed = 0
  for (let index = 0; index < a.length; index += 4) {
    const difference = (Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2])) / 765
    total += difference
    if (difference > 0.1) changed++
  }
  const count = a.length / 4
  return { meanDifference: total / count, changedShare: changed / count }
}`

/**
 * Open `project` in a browser served from `checkout`, and measure it.
 *
 * Options:
 * - `level` — open this level instead of the project's start level.
 * - `size` — the window, `[width, height]`.
 * - `camera` — editor 3D view `{ x, y, z, yaw, pitch, fov }` for the still picture.
 * - `picture` — write the still frame here as a PNG.
 * - `compareTo` — a PNG to compare the still frame with; answers `difference`.
 * - `warmSeconds` — seconds of play before sampling, so loading is not measured.
 * - `frames` — frames sampled while playing.
 * - `cycles` — play-and-stop rounds for the memory check; 0 skips it.
 * - `profileOut` — write a Chrome CPU profile of the sampled playing frames here.
 *
 * Answers `{ measures, difference, picture, problem }`. `measures` holds
 * `cpuMs` and `gpuMs` (medians over the sampled frames: the thread's time and the
 * card's time for one frame), `cpuMsP95`, `frameMs` (median time between
 * frames), `drawCalls`, `triangles`, `loadSeconds` (until the first drawn
 * frame), `heapMB` and `heapGrowthMB` (after `cycles`). `problem` is set, and
 * the other fields may be missing, when something did not start or draw.
 */
export async function browserFrames(checkout, project, options = {}) {
  const {
    level = null, size = [1280, 720], camera = null, picture = null, compareTo = null,
    warmSeconds = 15, frames = 120, cycles = 0, profileOut = null
  } = options
  const started = Date.now()
  const serverPort = await freePort()
  const cdpPort = await freePort()
  const profile = fs.mkdtempSync(path.join(tmpdir(), 'dream-browser-'))
  // The page carries this name, so `lanes` proves the browser is the one this
  // record describes rather than any browser holding the debugging port.
  const client = `dream-${serverPort}`
  let server = null
  let chrome = null
  let page = null
  try {
    server = spawn(process.execPath, [viteScript(checkout), '--port', String(serverPort), '--strictPort'], {
      cwd: checkout, env: { ...process.env, ENGINE_PROJECT: project }, stdio: 'ignore', windowsHide: true
    })
    // The dev server records itself once it listens; this is written first so a
    // server killed before it ever listened is still findable and stoppable.
    try {
      recordServer(checkout, {
        port: serverPort, pid: server.pid, serves: checkout, project,
        url: `http://localhost:${serverPort}`, startedAt: new Date().toISOString()
      })
    } catch { /* a measurement must not stop because the registry is busy */ }
    await waitFor('the dev server', async () => (await fetch(`http://localhost:${serverPort}/api/project`)).ok, 180000)

    // Named here so the record says which browser measured, and so a run that
    // fell back to the installed Chrome is visible rather than silent.
    const browser = findChrome(checkout)
    chrome = spawn(browser, [
      '--headless=new', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--disk-cache-size=1',
      `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run',
      '--no-default-browser-check', `--window-size=${size[0]},${size[1]}`,
      `http://localhost:${serverPort}/?client=${encodeURIComponent(client)}`
    ], { stdio: 'ignore', windowsHide: true })
    // Written before the wait, so a scoring run killed outright leaves the
    // browser findable by `lanes` or the supervisor instead of leaking it.
    try {
      recordLaneBrowser(checkout, {
        client, port: cdpPort, url: `http://localhost:${serverPort}/?client=${encodeURIComponent(client)}`,
        pid: chrome.pid, profile, serves: checkout, chrome: browser,
        headless: true, startedAt: new Date().toISOString()
      })
    } catch { /* the browser is still measured even when it cannot be recorded */ }
    page = await connect(cdpPort)

    if (level) {
      await waitFor('the editor', () => page.evaluate('!!window.engine?.editor?.loadLevel'), 240000)
      await page.evaluate(`window.engine.editor.loadLevel(${JSON.stringify(level)})`)
      // The stats still describe the last level until the new one draws.
      await sleep(3000)
    }
    await waitForDrawing(page, 'a drawn frame')
    const measures = { loadSeconds: round((Date.now() - started) / 1000), browser: path.basename(path.dirname(browser)) }

    const answer = { measures, difference: null, picture: null, problem: null }
    if (picture || compareTo) Object.assign(answer, await stillPicture(page, camera, picture, compareTo))

    Object.assign(measures, await playingFrames(page, warmSeconds, frames, profileOut))
    if (cycles > 0) Object.assign(measures, await memoryOverCycles(page, cycles))
    return answer
  } catch (error) {
    return { measures: {}, difference: null, picture: null, problem: String(error?.message || error) }
  } finally {
    page?.close()
    await closeBrowser(cdpPort)
    stopTree(chrome)
    stopTree(server)
    await sleep(1000)
    try { forgetLaneBrowser(checkout, client) } catch { /* the registry is already unreadable */ }
    try { forgetServer(checkout, serverPort, server?.pid) } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Windows may still hold it */ }
  }
}

/**
 * The editor's still frame through `camera`, saved and compared.
 *
 * Taken before play: engine time does not advance in the editor, so an animated
 * shader and a posed body look the same on every run.
 */
async function stillPicture(page, camera, file, compareTo) {
  const box = await page.evaluate(`(async () => {
    const camera = ${JSON.stringify(camera)}
    if (camera) { await window.engine.run('view.3d', true); Object.assign(window.engine.view, camera) }
    window.engine.editor.context?.redraw?.()
    await new Promise(resolve => setTimeout(resolve, 3000))
    const rectangle = document.querySelector('canvas').getBoundingClientRect()
    return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
  })()`)
  const shot = await page.call('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } })
  const url = `data:image/png;base64,${shot.data}`
  if (file) fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  let difference = null
  if (compareTo) {
    const reference = `data:image/png;base64,${fs.readFileSync(compareTo).toString('base64')}`
    difference = await page.evaluate(`(${COMPARE})(${JSON.stringify(url)}, ${JSON.stringify(reference)})`)
  }
  return { picture: file, difference }
}

/** Frame costs while the game plays, after `warmSeconds` of play. */
async function playingFrames(page, warmSeconds, frames, profileOut = null) {
  await page.evaluate('window.engine.play()')
  // Play draws through another camera, and nothing draws while its chain compiles.
  await sleep(1000)
  await waitForDrawing(page, 'a drawn playing frame')
  await sleep(warmSeconds * 1000)
  // Sampling starts with the same frames the costs come from, so a hotspot in
  // the profile is a hotspot in the priced frame rather than in loading.
  if (profileOut) {
    await page.call('Profiler.enable')
    await page.call('Profiler.setSamplingInterval', { interval: 100 })
    await page.call('Profiler.start')
  }
  const samples = await page.evaluate(`new Promise(resolve => {
    const cpu = [], gpu = [], gaps = []
    let last = performance.now()
    const tick = now => {
      const stats = window.engine.renderStats()
      cpu.push(stats.cpuMs)
      if (Number.isFinite(stats.gpuMs)) gpu.push(stats.gpuMs)
      gaps.push(now - last)
      last = now
      if (cpu.length < ${frames}) requestAnimationFrame(tick)
      else resolve({ cpu, gpu, gaps: gaps.slice(1), drawCalls: stats.drawCalls, triangles: stats.triangles })
    }
    requestAnimationFrame(tick)
  })`)
  if (profileOut) {
    const stopped = await page.call('Profiler.stop')
    fs.writeFileSync(profileOut, JSON.stringify(stopped.profile))
  }
  await page.evaluate('window.engine.stop()')
  return {
    cpuMs: round(median(samples.cpu)),
    cpuMsP95: round(percentile(samples.cpu, 0.95)),
    gpuMs: round(median(samples.gpu)),
    frameMs: round(median(samples.gaps)),
    drawCalls: samples.drawCalls,
    triangles: samples.triangles,
    ...(profileOut ? { profile: profileOut } : {})
  }
}

/** Heap after a forced collection, before and after `cycles` rounds of play and stop. */
async function memoryOverCycles(page, cycles) {
  const heap = async () => {
    await page.call('HeapProfiler.collectGarbage')
    await page.call('HeapProfiler.collectGarbage')
    return page.evaluate('performance.memory.usedJSHeapSize / 1e6')
  }
  await sleep(3000)
  const before = await heap()
  for (let cycle = 0; cycle < cycles; cycle++) {
    await page.evaluate('window.engine.play()')
    await sleep(2000)
    await page.evaluate('window.engine.stop()')
    await sleep(3000)
  }
  const after = await heap()
  return { heapMB: round(after), heapGrowthMB: round(after - before) }
}
