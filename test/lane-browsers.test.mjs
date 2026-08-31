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
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  readLaneBrowsers, recordLaneBrowser, recordLaneViewport, freeLaneName, startLaneBrowser,
  stopLaneBrowsers, laneBrowserArguments
} from '../engine/lane-browsers.mjs'

function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-lane-browsers-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'project/.engine'), { recursive: true })
  return root
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

test('a page that reports nothing adds no size', t => {
  const root = checkout(t)
  recordLaneBrowser(root, { client: 'alpha', port: 39400, pid: process.pid, windowAsked: '540x960' })

  const entry = recordLaneViewport(root, 'alpha', {})
  assert.equal(entry.viewportReported, undefined, 'an unknown frame size is absent, not guessed')
  assert.equal(recordLaneViewport(root, 'nobody', { viewport: '1x1' }), null)
  assert.equal(readLaneBrowsers(root).length, 1)
})
