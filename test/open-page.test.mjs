/**
 * Opening a page in the engine's own browser.
 *
 * No browser runs here. The arguments and the profile path are read back, and
 * the one start that happens runs node, which exits on the browser arguments at
 * once. The point guarded is that the engine never uses the system opener: that
 * gives the page to the browser the person already has open.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { openPage, openPageArguments, pageOnUrl, profileDirectory } from '../engine/open-page.mjs'
import { readLaneBrowsers, recordLaneBrowser } from '../engine/lane-browsers.mjs'

/** An empty checkout that is removed when the test ends. */
function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-open-page-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

/** Set CHROME_PATH for one test and put back whatever was there. */
function withChromePath(t, value) {
  const had = process.env.CHROME_PATH
  if (value === undefined) delete process.env.CHROME_PATH
  else process.env.CHROME_PATH = value
  t.after(() => { if (had === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = had })
}

/**
 * A debugging port with the pages it is told to have, and the paths it was
 * asked for, so a test can prove the page was activated rather than opened.
 */
async function pagesDebuggingPort(t, port, pages) {
  const requests = []
  const commands = []
  const server = http.createServer((request, response) => {
    requests.push(request.url)
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/json/list')) return response.end(JSON.stringify(pages))
    if (request.url.startsWith('/json/version')) {
      return response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake` }))
    }
    response.end('{"ok":true}')
  })
  // A tab is opened over the browser's own socket, not `/json`, so the fake has
  // to answer there or the path under test is never reached.
  const sockets = answerDebuggingSocket(server, commands, pages)
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(() => {
    // An upgraded socket is no longer the http server's to close, so each one is
    // destroyed by hand. Without this the test run never exits.
    for (const open of sockets) open.destroy()
    server.closeAllConnections?.()
    server.close()
  })
  return { port, requests, commands, pages }
}

/**
 * Answer the browser's debugging socket with just enough of the protocol.
 *
 * `Target.createTarget` is the one command these tests drive, so the reply is
 * a target id and the page it stands for is added to the listing. Only one
 * masked text frame per message is read, which is all the client sends.
 * Returns the live sockets, which the caller destroys: an upgraded socket is
 * no longer the http server's to close.
 */
function answerDebuggingSocket(server, commands, pages) {
  const sockets = new Set()
  server.on('upgrade', (request, socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const key = request.headers['sec-websocket-key']
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    const lines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', ''
    ]
    socket.write(lines.join(CARRIAGE_RETURN_LINE_FEED))
    socket.on('data', buffer => {
      const message = readTextFrame(buffer)
      if (!message) return
      commands.push(message)
      const id = `target-${commands.length}`
      if (message.method === 'Target.createTarget') {
        pages.push({ id, type: 'page', url: message.params?.url })
      }
      socket.write(textFrame(JSON.stringify({ id: message.id, result: { targetId: id } })))
    })
    socket.on('error', () => { /* the client closes when it has its answer */ })
  })
  return sockets
}

/** The line ending the HTTP upgrade handshake is written with. */
const CARRIAGE_RETURN_LINE_FEED = '\r\n'

/** One masked client text frame as JSON, or null when it is not one. */
function readTextFrame(buffer) {
  if ((buffer[0] & 0x0f) !== 1) return null
  let length = buffer[1] & 0x7f
  let at = 2
  if (length === 126) { length = buffer.readUInt16BE(2); at = 4 }
  const mask = buffer.subarray(at, at + 4)
  const body = Buffer.from(buffer.subarray(at + 4, at + 4 + length))
  for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4]
  try { return JSON.parse(body.toString('utf8')) } catch { return null }
}

/** One unmasked server text frame. The replies here are always short. */
function textFrame(text) {
  const body = Buffer.from(text, 'utf8')
  const header = body.length < 126
    ? Buffer.from([0x81, body.length])
    : Buffer.concat([Buffer.from([0x81, 126]), (() => {
      const two = Buffer.alloc(2); two.writeUInt16BE(body.length); return two
    })()])
  return Buffer.concat([header, body])
}

/**
 * A debugging port whose page appears only after a few empty answers.
 *
 * A browser answers its debugging port before the page it was given has
 * settled. The empty answers stand for that gap, so a test can prove the reader
 * waits for the page instead of opening a second window in the same browser.
 */
async function delayedPagesDebuggingPort(t, port, pages, emptyAnswers) {
  let lists = 0
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/json/list')) {
      lists += 1
      return response.end(JSON.stringify(lists <= emptyAnswers ? [] : pages))
    }
    response.end('{"ok":true}')
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections?.(); server.close() })
  return { port, listCount: () => lists }
}

test('the profile is kept beside the browser, under its name', t => {
  const root = checkout(t)
  assert.equal(profileDirectory(root, 'editor'), path.join(root, '.browsers', 'profiles', 'editor'))
  // Two names are two windows with two profiles, not one shared one.
  assert.notEqual(profileDirectory(root, 'editor'), profileDirectory(root, 'inspect'))
})

test('the window is visible: nothing asks for headless', t => {
  const said = openPageArguments({ profile: 'P', url: 'http://localhost:5180/' })
  assert.ok(!said.some(argument => argument.includes('headless')))
  assert.ok(said.includes('--new-window'))
  assert.equal(said.at(-1), 'http://localhost:5180/')
})

test('a profile of its own keeps the window out of the person\'s browser', t => {
  const said = openPageArguments({ profile: 'C:/checkout/.browsers/profiles/editor', url: 'http://x/' })
  assert.ok(said.includes('--user-data-dir=C:/checkout/.browsers/profiles/editor'))
})

test('a tab behind another one keeps running and keeps answering', t => {
  const said = openPageArguments({ profile: 'P', url: 'http://localhost:5180/' })
  // Several engines as tabs is the normal case, and only the front tab is
  // visible to Chrome. Without these the others stop stepping and time out on
  // every call, which reads as a broken bridge rather than a throttled tab.
  for (const flag of [
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding'
  ]) assert.ok(said.includes(flag), `${flag} is passed`)
})

test('a size is asked for only when one is given', t => {
  assert.ok(!openPageArguments({ profile: 'P', url: 'http://x/' }).some(a => a.startsWith('--window-size')))
  assert.ok(openPageArguments({ profile: 'P', url: 'http://x/', width: 1280, height: 800 })
    .includes('--window-size=1280,800'))
})

test('a debugging port is passed only when one is given', t => {
  assert.ok(openPageArguments({ profile: 'P', url: 'http://x/', port: 9411 })
    .includes('--remote-debugging-port=9411'), 'a given port makes the window findable')
  assert.ok(!openPageArguments({ profile: 'P', url: 'http://x/' })
    .some(a => a.startsWith('--remote-debugging-port')), 'no port, no argument')
})

test('no browser to open is reported, not thrown', async t => {
  const root = checkout(t)
  withChromePath(t, path.join(root, 'no-such-chrome'))
  const opened = await openPage('http://localhost:5180/', { checkout: root })
  assert.equal(opened.opened, false)
  assert.match(opened.problem, /no-such-chrome/)
})

test('a started window reports which browser it used, and makes its profile', async t => {
  const root = checkout(t)
  // node, not chrome: it rejects the browser arguments and exits at once.
  withChromePath(t, process.execPath)
  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })
  assert.equal(opened.opened, true)
  assert.equal(opened.chrome, process.execPath)
  assert.equal(opened.profile, profileDirectory(root, 'editor'))
  assert.ok(fs.existsSync(opened.profile))
  assert.equal(typeof opened.port, 'number', 'the window is given a debugging port')
  assert.equal(opened.reused, false, 'nothing was running, so a new browser starts')
})

test('a second open reaches the running browser and keeps its record', async t => {
  const root = checkout(t)
  withChromePath(t, process.execPath)
  const live = await pagesDebuggingPort(t, 39710, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/' }
  ])
  recordLaneBrowser(root, {
    client: 'editor', port: live.port, url: 'http://localhost:5180/', pid: process.pid,
    profile: profileDirectory(root, 'editor'), headless: false
  })

  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })

  assert.equal(opened.opened, true)
  assert.equal(opened.reused, true, 'a window in the running browser, not a new browser')
  assert.equal(opened.port, live.port, 'the live port is reported, not a new one')
  assert.equal(opened.pid, process.pid, 'the running browser keeps its pid')
  const recorded = readLaneBrowsers(root)
  assert.equal(recorded.length, 1, 'the running browser keeps its one record')
  assert.equal(recorded[0].port, live.port)
  assert.equal(recorded[0].pid, process.pid)
})

test('a page already on the url is brought to the front, not opened again', async t => {
  const root = checkout(t)
  withChromePath(t, process.execPath)
  const live = await pagesDebuggingPort(t, 39720, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/' }
  ])
  recordLaneBrowser(root, {
    client: 'editor', port: live.port, url: 'http://localhost:5180/', pid: process.pid,
    profile: profileDirectory(root, 'editor'), headless: false
  })

  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })

  assert.equal(opened.opened, true)
  assert.equal(opened.reused, true, 'the browser is reused, not started')
  assert.equal(opened.activated, true, 'the existing page is brought to the front')
  assert.equal(opened.pageId, 'page-1')
  assert.equal(opened.port, live.port, 'the live port is reported')
  assert.equal(opened.pid, process.pid, 'the running browser keeps its pid')
  assert.ok(live.requests.some(path => path === '/json/activate/page-1'), 'the page is activated')
  assert.equal(readLaneBrowsers(root).length, 1, 'one browser keeps one record')
})

test('a live browser with no page on the url adds a tab and keeps its record', async t => {
  const root = checkout(t)
  withChromePath(t, process.execPath)
  const live = await pagesDebuggingPort(t, 39721, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5199/' }
  ])
  recordLaneBrowser(root, {
    client: 'editor', port: live.port, url: 'http://localhost:5199/', pid: process.pid,
    profile: profileDirectory(root, 'editor'), headless: false
  })

  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })

  assert.equal(opened.reused, true, 'the running browser is reached')
  assert.equal(opened.port, live.port, 'the tab is added to the running browser')
  assert.ok(opened.pageId, 'the new tab is reported, so it can be counted and closed')
  const made = live.commands.find(command => command.method === 'Target.createTarget')
  assert.equal(made?.params?.url, 'http://localhost:5180/', 'the tab is opened on the url asked for')
  const recorded = readLaneBrowsers(root)
  assert.equal(recorded.length, 1, 'the running browser keeps its one record')
  assert.equal(recorded[0].port, live.port)
})

test('a page still starting is waited for, not opened a second time', async t => {
  const root = checkout(t)
  withChromePath(t, process.execPath)
  // Three empty answers: the port is up while the page is still on its way.
  const live = await delayedPagesDebuggingPort(t, 39730, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/' }
  ], 3)
  recordLaneBrowser(root, {
    client: 'editor', port: live.port, url: 'http://localhost:5180/', pid: process.pid,
    profile: profileDirectory(root, 'editor'), headless: false
  })

  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })

  assert.equal(opened.opened, true)
  assert.equal(opened.reused, true, 'the running browser is reached')
  assert.equal(opened.activated, true, 'the page that appeared is brought to the front')
  assert.equal(opened.pageId, 'page-1', 'the page the open asked for is returned')
  assert.ok(live.listCount() > 3, 'the reader waited past the empty answers')
})

test('a fresh profile starts with no restored session', async t => {
  const root = checkout(t)
  withChromePath(t, process.execPath)
  const chromium = path.join(profileDirectory(root, 'editor'), 'Default')
  fs.mkdirSync(path.join(chromium, 'Sessions'), { recursive: true })
  for (const name of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    fs.writeFileSync(path.join(chromium, name), 'a tab that would come back')
  }
  fs.writeFileSync(path.join(chromium, 'Sessions', 'Session_1'), 'a tab that would come back')

  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })

  assert.equal(opened.reused, false, 'nothing running, so a fresh browser starts')
  for (const name of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    assert.equal(fs.existsSync(path.join(chromium, name)), false, `${name} would be restored`)
  }
  assert.equal(fs.existsSync(path.join(chromium, 'Sessions')), false, 'the session directory would restore tabs')
})

test('pageOnUrl treats a trailing slash as the same page', () => {
  const pages = [{ id: 'p', type: 'page', url: 'http://localhost:5180/' }]
  assert.equal(pageOnUrl(pages, 'http://localhost:5180')?.id, 'p')
  assert.equal(pageOnUrl(pages, 'http://localhost:5180/other'), null)
  assert.equal(pageOnUrl([{ id: 'q', type: 'page', url: 'http://x/?client=lane' }], 'http://x/'), null)
})

test('a second open when the recorded port is dead writes a fresh record', async t => {
  const root = checkout(t)
  withChromePath(t, process.execPath)
  const deadPort = 39711
  recordLaneBrowser(root, {
    client: 'editor', port: deadPort, url: 'http://localhost:5180/', pid: 999999,
    profile: profileDirectory(root, 'editor'), headless: false
  })

  const opened = await openPage('http://localhost:5180/', { checkout: root, profile: 'editor' })

  assert.equal(opened.opened, true)
  assert.equal(opened.reused, false, 'nothing answers, so a fresh browser is started')
  assert.notEqual(opened.port, deadPort, 'the dead port is not reused')
  const recorded = readLaneBrowsers(root)
  assert.equal(recorded.length, 1, 'the record is replaced, not added to')
  assert.equal(recorded[0].client, 'editor')
  assert.notEqual(recorded[0].port, deadPort, 'the fresh record names the new port')
})
