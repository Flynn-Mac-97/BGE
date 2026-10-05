/**
 * See's node half for a GIF: record part of the person's editor window as it
 * plays, and write it as `agent-runs/see/<name>.gif`. Node only: it reaches
 * the window through the debugging port the supervisor recorded for it, which
 * a page cannot open on itself.
 *
 *   recordGif(checkout, { panel: 'kimodo', seconds: 3 })   the canvas in one panel
 *   recordGif(checkout, { selector: '#viewport' })          any element; the game view when neither is given
 *   recordGif(checkout, { lane: 'sight', selector: 'main' }) a lane browser's page instead of the editor window
 *
 * `seconds` (3), `fps` (12) and `width` (480 pixels at most) set the length,
 * the frames a second asked for and the size. `play` runs one page command
 * first, `{ command, args }`, so the recording starts as the thing starts:
 * `{ play: { command: 'kimodo.view', args: { clip } } }`. A frame takes some milliseconds
 * to capture, so each frame's delay is the time it really showed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readSupervisorRecord } from '../../../engine/supervisor-transport.mjs'
import { readLaneBrowsers } from '../../../engine/lane-browsers.mjs'
import { decodePng } from '../art-direction/image.js'
import { encodeGif } from './gif-encoding.js'

const DEFAULTS = { seconds: 3, fps: 12, width: 480 }

/** JSON from a local port. */
const localJson = async (port, route) => (await fetch(`http://127.0.0.1:${port}${route}`)).json()

/** The editor window's page, as its debugging port lists it. */
async function editorPage(checkout) {
  const record = readSupervisorRecord(checkout)
  if (!record) throw new Error('no supervisor: node bin/engine.mjs supervisor.start, then supervisor.open editor-browser')
  const { instances } = await localJson(record.port, '/instances')
  const browser = instances.find(one => one.kind === 'editor-browser' && one.state === 'running')
  if (!browser) throw new Error('no editor window is open: node bin/engine.mjs supervisor.open editor-browser')
  const origin = new URL(browser.url).origin
  const page = (await localJson(browser.port, '/json/list')).find(one => one.type === 'page' && one.url.startsWith(origin))
  if (!page) throw new Error(`the editor window has no page on ${origin}`)
  return page
}

/**
 * The recorded browser for a lane name, from `lanes`' records. A container has
 * no display for the editor window, so a lane is the only page there is.
 */
export function laneBrowserOf(browsers, lane) {
  const browser = browsers.find(one => one.client === lane)
  if (!browser) throw new Error(`no lane browser named ${lane}: node bin/engine.mjs lanes.start ${lane}`)
  return browser
}

/** The page of one lane browser, as its debugging port lists it. */
async function lanePage(checkout, lane) {
  const browser = laneBrowserOf(readLaneBrowsers(checkout), lane)
  const origin = new URL(browser.url).origin
  const page = (await localJson(browser.port, '/json/list')).find(one => one.type === 'page' && one.url.startsWith(origin))
  if (!page) throw new Error(`lane ${lane} has no page on ${origin}`)
  return page
}

/** A session on one page: `send(method, params)` answers the result; `close()` ends it. */
function sessionOn(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const waiting = new Map()
  let lastId = 0
  socket.addEventListener('message', message => {
    const reply = JSON.parse(message.data)
    if (!waiting.has(reply.id)) return
    const { resolve, reject } = waiting.get(reply.id)
    waiting.delete(reply.id)
    if (reply.error) reject(new Error(reply.error.message))
    else resolve(reply.result)
  })
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('could not reach the editor window')), { once: true })
  })
  return {
    send: async (method, params = {}) => {
      await opened
      const id = ++lastId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
    },
    close: () => socket.close()
  }
}

/** The CSS selector an option set names: a panel's canvas, any element, or the game view. */
const selectorOf = options =>
  options.selector ?? (options.panel ? `[data-panel="${options.panel}"] canvas, [data-panel="${options.panel}"]` : '#viewport')

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** How long to wait for the area to be drawn: a panel a `play` command opens appears on a later frame. */
const AREA_WAIT_MILLISECONDS = 3000

/** The page area to record, in CSS pixels, or an error naming what matched nothing. */
async function areaOf(session, selector) {
  const expression = `(() => { const found = document.querySelector(${JSON.stringify(selector)}); if (!found) return null; const box = found.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height } })()`
  const started = Date.now()
  while (Date.now() - started < AREA_WAIT_MILLISECONDS) {
    const { result } = await session.send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.value?.width) return result.value
    await pause(100)
  }
  throw new Error(`nothing on the page matches ${selector}; is its panel open?`)
}

/** Run a command on the page and wait for it, so what it starts is recorded from its beginning. */
async function playOn(session, play) {
  const expression = `engine.run(${JSON.stringify(play.command)}, ${JSON.stringify(play.args ?? {})})`
  const { exceptionDetails } = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(`${play.command} failed on the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
}

/** Record the frames: `[{ rgba, width, height, at }]`, `at` in milliseconds from the first. */
async function framesOf(session, area, settings) {
  const clip = { ...area, scale: Math.min(1, settings.width / area.width) }
  const frames = []
  const started = Date.now()
  while (Date.now() - started < settings.seconds * 1000) {
    const shownAt = Date.now() - started
    const shot = await session.send('Page.captureScreenshot', { format: 'png', clip })
    const image = await decodePng(Buffer.from(shot.data, 'base64'))
    frames.push({ rgba: image.data, width: image.width, height: image.height, at: shownAt })
    await pause(Math.max(0, (frames.length * 1000) / settings.fps - (Date.now() - started)))
  }
  return frames
}

/**
 * Record `options` (see the top of this file) and write the GIF. Answers
 * `{ file, frames, seconds, width, height }`, `file` relative to the checkout.
 */
export async function recordGif(checkout, options = {}) {
  const settings = { ...DEFAULTS, ...options }
  const session = sessionOn(await (settings.lane ? lanePage(checkout, settings.lane) : editorPage(checkout)))
  try {
    if (settings.play) await playOn(session, settings.play)
    const frames = await framesOf(session, await areaOf(session, selectorOf(settings)), settings)
    const { width, height } = frames[0]
    const sameSize = frames.filter(frame => frame.width === width && frame.height === height)
    const timed = sameSize.map((frame, index) => ({
      rgba: frame.rgba,
      delay: ((sameSize[index + 1]?.at ?? frame.at + 1000 / settings.fps) - frame.at) / 10
    }))
    const name = String(settings.name ?? `gif-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-')
    const file = path.join('agent-runs', 'see', `${name}.gif`)
    fs.mkdirSync(path.join(checkout, 'agent-runs', 'see'), { recursive: true })
    fs.writeFileSync(path.join(checkout, file), encodeGif({ width, height, frames: timed }))
    return { file: file.split(path.sep).join('/'), frames: timed.length, seconds: settings.seconds, width, height }
  } finally {
    session.close()
  }
}
