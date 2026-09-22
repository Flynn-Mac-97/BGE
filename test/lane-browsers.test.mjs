/**
 * The lane browser registry: one name is one browser, and the sizes it records.
 *
 * No Chrome runs here. A refusal happens before the spawn, and the one start
 * that gets past it runs node, which exits on the browser arguments at once.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import {
  readLaneBrowsers, recordLaneBrowser, recordLaneViewport, forgetLaneBrowser, freeLaneName,
  findFreeDebuggingPort, clientsOnPort, listLaneBrowsers, startLaneBrowser,
  stopLaneBrowsers, laneBrowserArguments
} from '../engine/lane-browsers.mjs'

function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-lane-browsers-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.engine'), { recursive: true })
  return root
}

/** Bind a port, as a running browser does. Returns a release. */
async function holdPort(t, port, host = '127.0.0.1') {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  let open = true
  const release = () => new Promise(resolve => {
    if (!open) return resolve()
    open = false
    server.close(resolve)
  })
  t.after(release)
  return release
}

/** A debugging port that answers for the lanes named, as Chrome does. */
async function fakeBrowser(t, port, clients) {
  const targets = clients.map(client => ({ type: 'page', url: `http://localhost:5180/?client=${client}` }))
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(request.url.startsWith('/json/list')
      ? JSON.stringify(targets)
      : '{"Browser":"fake/1"}')
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections?.(); server.close() })
  return port
}

/** A profile directory with a file in it, so its removal is visible. */
function profileDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-lane-profile-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'Preferences'), '{}')
  return directory
}

/** A pid that is certainly gone: a process that has already exited. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid
}


test('a name a live browser holds is refused, and its record is left alone', async t => {
  const root = checkout(t)
  const profile = profileDirectory(t)
  recordLaneBrowser(root, {
    client: 'alpha', port: 39400, pid: process.pid, profile,
    windowAsked: '540x960', startedAt: '2026-08-31T07:00:00Z'
  })

  await assert.rejects(
    () => startLaneBrowser(root, {
      client: 'alpha', url: 'http://localhost:5180/', port: 39401, chrome: 'no-such-chrome'
    }),
    error => {
      assert.match(error.message, /already called "alpha"/)
      assert.match(error.message, new RegExp(`process ${process.pid}`), 'it names the live one')
      assert.match(error.message, /lanes\.stop alpha/, 'it says how to end it')
      return true
    })

  const recorded = readLaneBrowsers(root)
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].pid, process.pid, 'the live browser keeps its record')
  assert.ok(fs.existsSync(profile), 'a live browser keeps its profile directory')
})

test('freeLaneName refuses a live name and clears a dead one', async t => {
  const root = checkout(t)
  const profile = profileDirectory(t)

  recordLaneBrowser(root, { client: 'alpha', port: 39400, pid: process.pid, profile })
  await assert.rejects(() => freeLaneName(root, 'alpha'), /already called "alpha"/)

  recordLaneBrowser(root, { client: 'alpha', port: 39400, pid: deadPid(), profile })
  const removed = await freeLaneName(root, 'alpha')
  assert.equal(removed.client, 'alpha')
  assert.deepEqual(readLaneBrowsers(root), [], 'a dead record is litter')
  assert.equal(fs.existsSync(profile), false, 'its profile directory goes with it')
})

test('a dead visible record frees the name but keeps its profile', async t => {
  const root = checkout(t)
  const profile = profileDirectory(t)
  recordLaneBrowser(root, { client: 'editor', port: 39400, pid: deadPid(), profile, headless: false })

  const removed = await freeLaneName(root, 'editor')
  assert.equal(removed.client, 'editor')
  assert.deepEqual(readLaneBrowsers(root), [], 'the dead record is gone')
  assert.equal(fs.existsSync(profile), true, 'a visible window keeps its profile for the next open')
})

test('an unused name is free and removes nothing', async t => {
  const root = checkout(t)
  assert.equal(await freeLaneName(root, 'alpha'), null)
  assert.deepEqual(readLaneBrowsers(root), [])
})

test('a dead record does not block a start, and a failed start leaves none', async t => {
  const root = checkout(t)
  recordLaneBrowser(root, { client: 'alpha', port: 39400, pid: deadPid(), profile: profileDirectory(t) })

  // node, not chrome: it rejects the browser arguments and exits at once, so
  // the start gets past the refusal and fails where a real browser would.
  await assert.rejects(
    () => startLaneBrowser(root, {
      client: 'alpha', url: 'http://localhost:5180/', port: 39401, chrome: process.execPath
    }),
    /never opened its debugging port 39401/)
  assert.deepEqual(readLaneBrowsers(root), [], 'a start that never opened leaves no record')
})

test('a lane browser opens at the asked size, at one device pixel per CSS pixel', () => {
  const argv = laneBrowserArguments({
    port: 39403, profile: 'C:/temp/lane-alpha', width: 540, height: 960,
    page: 'http://localhost:5180/?client=alpha'
  })
  assert.ok(argv.includes('--window-size=540,960'), `no window size in ${argv.join(' ')}`)
  assert.ok(argv.includes('--force-device-scale-factor=1'),
    'without ratio 1 a HiDPI host writes the profile at twice the pixels')
  assert.ok(argv.includes('--headless=new'), 'a lane never opens a window')
  assert.ok(argv.includes('--user-data-dir=C:/temp/lane-alpha'), 'a lane never shares a profile')
  assert.equal(argv.at(-1), 'http://localhost:5180/?client=alpha', 'the page carries the lane name')
})

test('the size asked for and the size reported are separate fields', t => {
  const root = checkout(t)
  recordLaneBrowser(root, { client: 'alpha', port: 39400, pid: process.pid, windowAsked: '540x960' })

  const entry = recordLaneViewport(root, 'alpha', { viewport: '540x865', pixelRatio: 1 })
  assert.equal(entry.windowAsked, '540x960')
  assert.equal(entry.viewportReported, '540x865')
  assert.equal(entry.pixelRatio, 1)
  assert.equal(entry.profileSize, undefined, 'no field claims to be both')
  assert.equal(readLaneBrowsers(root).length, 1, 'the report updates the entry, not a second one')
})

test('a port still answering after a stop is named, not called clear', async t => {
  const root = checkout(t)
  const port = 39402
  const survivor = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end('{"Browser":"fake/1"}')
  })
  await new Promise(resolve => survivor.listen(port, '127.0.0.1', resolve))
  t.after(() => { survivor.closeAllConnections?.(); survivor.close() })

  recordLaneBrowser(root, { client: 'alpha', port, pid: deadPid() })
  const result = await stopLaneBrowsers(root)

  assert.equal(result.remaining, 0, 'the record is gone')
  assert.equal(result.stopped[0].stillAnswering, true, 'something is still attached')
  assert.match(result.warning, new RegExp(String(port)))
})

test('two lanes never share a port, whatever the record count says', async t => {
  const root = checkout(t)
  const from = 39500

  const alphaPort = await findFreeDebuggingPort(root, { from })
  const releaseAlpha = await holdPort(t, alphaPort)
  recordLaneBrowser(root, { client: 'alpha', port: alphaPort, pid: process.pid })

  const betaPort = await findFreeDebuggingPort(root, { from })
  assert.notEqual(betaPort, alphaPort, 'a bound port is not offered again')
  await holdPort(t, betaPort)
  recordLaneBrowser(root, { client: 'beta', port: betaPort, pid: process.pid })

  // Stop alpha. One record is left, so counting records names beta's port.
  forgetLaneBrowser(root, 'alpha')
  await releaseAlpha()

  const gammaPort = await findFreeDebuggingPort(root, { from })
  assert.notEqual(gammaPort, betaPort, 'the port beta holds is never handed out')
  assert.equal(gammaPort, alphaPort, 'the port alpha released is free again')
  await holdPort(t, gammaPort)
})

test('a port a record already names is skipped, even before its browser binds', async t => {
  const root = checkout(t)
  const from = 39540
  const first = await findFreeDebuggingPort(root, { from })
  recordLaneBrowser(root, { client: 'alpha', port: first, pid: process.pid })
  assert.notEqual(await findFreeDebuggingPort(root, { from }), first,
    'two starts at once must not pick the same free port')
})

test('a port held on the other loopback address is not free', async t => {
  const root = checkout(t)
  const from = 39550
  // A dev server binds `localhost`, which is ::1 first on Windows. A port held
  // there cannot be handed to a browser, however free it looks on 127.0.0.1.
  try { await holdPort(t, from, '::1') } catch { return t.skip('this host has no IPv6 loopback') }
  await assert.rejects(() => findFreeDebuggingPort(root, { from, tries: 1 }),
    /no free debugging port/, 'the IPv6 bind is seen, so no port is offered')
})

test('an entry is proved by its port naming the lane, not by any browser answering', async t => {
  const root = checkout(t)
  const port = await findFreeDebuggingPort(root, { from: 39560 })
  await fakeBrowser(t, port, ['beta'])
  recordLaneBrowser(root, { client: 'beta', port, pid: process.pid })
  recordLaneBrowser(root, { client: 'gamma', port, pid: process.pid })

  const listed = await listLaneBrowsers(root)
  const beta = listed.find(entry => entry.client === 'beta')
  const gamma = listed.find(entry => entry.client === 'gamma')

  assert.equal(beta.alive, true)
  assert.equal(beta.state, 'running')
  assert.equal(gamma.alive, false, 'beta must not answer the probe for gamma')
  assert.equal(gamma.state, 'wrong browser')
  assert.match(gamma.why, /beta/, 'it says whose browser holds the port')
})

test('a visible window is proved by its port answering, with no lane page', async t => {
  const root = checkout(t)
  const port = await findFreeDebuggingPort(root, { from: 39600 })
  // A visible window lists no page named for a client, the way an editor does not.
  await fakeBrowser(t, port, [])
  recordLaneBrowser(root, { client: 'editor', port, pid: process.pid, headless: false })

  const listed = await listLaneBrowsers(root)
  const editor = listed.find(entry => entry.client === 'editor')
  assert.equal(editor.alive, true, 'a window with no lane page is still alive')
  assert.equal(editor.state, 'running')
  assert.equal(editor.why, undefined)
})

test('a sweep with no name leaves the visible window alone', async t => {
  const root = checkout(t)
  const editorPort = await findFreeDebuggingPort(root, { from: 39620 })
  await fakeBrowser(t, editorPort, [])
  recordLaneBrowser(root, { client: 'editor', port: editorPort, pid: process.pid, headless: false })
  recordLaneBrowser(root, { client: 'alpha', port: 39621, pid: deadPid(), headless: true })

  const result = await stopLaneBrowsers(root)

  assert.deepEqual(result.stopped.map(entry => entry.client), ['alpha'], 'only the lane is stopped')
  const left = readLaneBrowsers(root)
  assert.equal(left.length, 1, 'the editor record stays')
  assert.equal(left[0].client, 'editor')
  assert.equal(left[0].headless, false)
})

test('an all sweep stops the visible window too', async t => {
  const root = checkout(t)
  const editorPort = await findFreeDebuggingPort(root, { from: 39660 })
  await fakeBrowser(t, editorPort, [])
  recordLaneBrowser(root, { client: 'editor', port: editorPort, pid: deadPid(), headless: false })
  recordLaneBrowser(root, { client: 'alpha', port: 39661, pid: deadPid(), headless: true })

  const result = await stopLaneBrowsers(root, null, { all: true })

  assert.deepEqual(result.stopped.map(entry => entry.client).sort(), ['alpha', 'editor'], 'both kinds are stopped')
  assert.deepEqual(readLaneBrowsers(root), [], 'the registry is left empty')
})

test('a record with no headless field is read as a lane', async t => {
  const root = checkout(t)
  // An old file, written before the field existed.
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{ client: 'alpha', port: 39640, pid: deadPid() }]
  }))

  assert.equal((await listLaneBrowsers(root))[0].headless, true, 'missing means lane')
  const result = await stopLaneBrowsers(root)
  assert.deepEqual(result.stopped.map(entry => entry.client), ['alpha'], 'a lane is swept')
})

test('a start on a port another browser holds is refused', async t => {
  const root = checkout(t)
  const port = await findFreeDebuggingPort(root, { from: 39580 })
  await fakeBrowser(t, port, ['beta'])

  await assert.rejects(
    () => startLaneBrowser(root, {
      client: 'gamma', url: 'http://localhost:5180/', port, chrome: process.execPath
    }),
    /already bound/)
  assert.deepEqual(readLaneBrowsers(root), [], 'a browser that never started leaves no record')
  assert.deepEqual(await clientsOnPort(port), ['beta'], 'the port still belongs to beta')
})

test('a start never takes the port another record names, even when asked to', async t => {
  const root = checkout(t)
  const taken = await findFreeDebuggingPort(root, { from: 39590 })
  recordLaneBrowser(root, { client: 'beta', port: taken, pid: process.pid })

  // A caller that works its port out from a count asks for one beta holds.
  await assert.rejects(
    () => startLaneBrowser(root, {
      client: 'gamma', url: 'http://localhost:5180/', port: taken, chrome: process.execPath
    }),
    error => {
      const started = Number(error.message.match(/debugging port (\d+)/)?.[1])
      assert.notEqual(started, taken, 'gamma must be given a port of its own')
      return true
    })
  assert.equal(readLaneBrowsers(root).length, 1, 'beta keeps its record')
})

test('a start with no port takes a free one', async t => {
  const root = checkout(t)
  await assert.rejects(
    () => startLaneBrowser(root, {
      client: 'alpha', url: 'http://localhost:5180/', chrome: process.execPath
    }),
    error => {
      assert.match(error.message, /never opened its debugging port \d+/, 'a port was allocated')
      return true
    })
})

test('an unreachable port names nobody', async () => {
  const port = 39599
  assert.equal(await clientsOnPort(port), null, 'nothing answering is not an empty browser')
})

test('a browser started in a worktree is owned by the main checkout', async t => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-lane-main-'))
  t.after(() => fs.rmSync(main, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', ['-C', main, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--quiet')
  git('config', 'user.email', 'lane@example.test')
  git('config', 'user.name', 'lane')
  git('commit', '--allow-empty', '--quiet', '-m', 'base')
  const lane = path.join(main, '.agent-worktrees', 'lane-a')
  git('worktree', 'add', '--quiet', '-b', 'agent/lane-a', lane)

  recordLaneBrowser(lane, { client: 'alpha', port: 39598, pid: deadPid() })

  assert.equal(fs.existsSync(path.join(lane, '.engine/lane-browsers.json')), false,
    'a worktree writes no registry of its own')
  assert.equal(readLaneBrowsers(main).length, 1, 'the main checkout lists a lane started in a worktree')

  const result = await stopLaneBrowsers(main, 'alpha')
  assert.equal(result.stopped.length, 1, 'and can stop it')
  assert.deepEqual(readLaneBrowsers(lane), [], 'the worktree reads the same registry')
})

test('a page that reports nothing adds no size', t => {
  const root = checkout(t)
  recordLaneBrowser(root, { client: 'alpha', port: 39400, pid: process.pid, windowAsked: '540x960' })

  const entry = recordLaneViewport(root, 'alpha', {})
  assert.equal(entry.viewportReported, undefined, 'an unknown frame size is absent, not guessed')
  assert.equal(recordLaneViewport(root, 'nobody', { viewport: '1x1' }), null)
  assert.equal(readLaneBrowsers(root).length, 1)
})
