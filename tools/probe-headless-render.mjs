/**
 * U1: can headless Chromium render this engine's WebGL, and does it match?
 *
 * Drives Chrome over the DevTools Protocol with no dependency: node 24 has a
 * global WebSocket. Reports the WebGL renderer string, whether a context was
 * created at all, and writes a frame at a stated device profile.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findChrome } from '../engine/chrome-path.mjs'

const CHROME = findChrome(process.cwd())
const URL = process.argv[2] || 'http://localhost:5180/'
const OUT = process.argv[3] || 'agent-runs/u1-headless.png'
const PORT = Number(process.argv[4] || 9333)
const MODE = process.argv[5] || 'headless'
const [WIDTH, HEIGHT] = [540, 960]

const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'u1-chrome-'))
const flags = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  `--window-size=${WIDTH},${HEIGHT}`
]
// The whole question is whether a real GPU context is available with no head,
// so nothing here asks for software rendering.
if (MODE === 'headless') flags.push('--headless=new')

const chrome = spawn(CHROME, [...flags, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] })
const chromeErrors = []
chrome.stderr.on('data', d => chromeErrors.push(String(d)))

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const reply = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      return await reply.json()
    } catch { await sleep(250) }
  }
  throw new Error('Chrome never opened its debugging port')
}

function connect(url) {
  const socket = new WebSocket(url)
  const waiting = new Map()
  let next = 1
  const events = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)
      waiting.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    } else if (message.method) events.push(message)
  })
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', () => reject(new Error('could not connect to Chrome')))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = next++
    waiting.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  return { ready, send, events, close: () => socket.close() }
}

const report = { mode: MODE, url: URL, profile: `${WIDTH}x${HEIGHT}` }

try {
  const version = await endpoint()
  report.chrome = version.Browser
  const browser = connect(version.webSocketDebuggerUrl)
  await browser.ready

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => browser.send(method, params, sessionId)

  await call('Page.enable')
  await call('Runtime.enable')
  await call('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  })

  // Ask the page itself, before the engine loads, whether WebGL exists at all.
  await call('Page.navigate', { url: URL })
  for (let attempt = 0; attempt < 120; attempt++) {
    const { result } = await call('Runtime.evaluate', {
      expression: 'document.readyState === "complete" && !!window.engine',
      returnByValue: true
    })
    if (result.value) break
    await sleep(500)
  }

  const probe = await call('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (!gl) return { context: false, why: 'getContext returned null' }
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        context: true,
        version: gl.getParameter(gl.VERSION),
        vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
        renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        engineReady: !!window.engine,
        canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height)
      }
    })()`,
    returnByValue: true
  })
  Object.assign(report, probe.result.value || {})
  if (probe.exceptionDetails) report.evaluateError = probe.exceptionDetails.text

  // A frame drawn by the engine's own renderer, not an empty page.
  const level = await call('Runtime.evaluate', {
    expression: 'JSON.stringify({ level: window.engine?.level?.(), mode: window.engine?.snapshot?.()?.mode })',
    returnByValue: true, awaitPromise: true
  })
  report.engineLevel = level.result.value

  await sleep(1500)
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  const bytes = fs.readFileSync(OUT)
  report.frame = { file: OUT, bytes: bytes.length, size: `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` }

  browser.close()
} catch (error) {
  report.failed = String(error.message || error)
} finally {
  chrome.kill()
  await sleep(400)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Windows holds it briefly */ }
}

if (chromeErrors.length) {
  const noise = chromeErrors.join('').split('\n')
    .filter(line => /gl|gpu|angle|swiftshader|webgl|fallback/i.test(line))
  if (noise.length) report.chromeGpuLog = noise.slice(0, 6)
}

console.log(JSON.stringify(report, null, 2))
