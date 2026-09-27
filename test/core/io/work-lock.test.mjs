/**
 * What this module decides, and nothing more.
 *
 * `workLock` and `roleOfClient` read two registry files; `permits` is a pure
 * rule over an op and a role. None of them enforce anything. The doors that
 * consult `permits` are `POST /api/engine`, `POST /api/file` and
 * `POST /api/agent-file` in `vite.config.js`, so a test here proves what the
 * rule says and never what a route does. That needs a wiring test against a
 * running server.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { workLock, permits, roleOfClient } from '../../../engine/work-lock.mjs'

function checkout(testContext, { runs = [], browsers = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-work-lock-'))
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const engine = path.join(root, '.engine')
  fs.mkdirSync(engine, { recursive: true })
  fs.writeFileSync(path.join(engine, 'agents.json'), JSON.stringify({ runs }))
  fs.writeFileSync(path.join(engine, 'lane-browsers.json'), JSON.stringify({ browsers }))
  return root
}

/** This test process: a pid that is certainly alive while the test runs. */
const LIVE_PID = process.pid

/**
 * A pid that certainly is not running: a real child, already exited.
 *
 * Run once, because each call costs a process start. The same pid could in
 * principle be handed to something new, which would make every test using it
 * fail rather than pass by accident.
 */
const DEAD_PID = spawnSync(process.execPath, ['-e', '0']).pid

test('nothing working means nothing is held', testContext => {
  const lock = workLock(checkout(testContext))
  assert.equal(lock.locked, false)
  assert.deepEqual(lock.holders, [])
  assert.deepEqual(lock.stale, [])
  assert.equal(permits(lock, 'set').allowed, true)
})

test('an active run holds the person out of every writing op', testContext => {
  const root = checkout(testContext, {
    runs: [
      { id: 'crowd', status: 'active', files: ['engine/render.js'], startedAt: '2026-08-31T07:00:00Z' },
      { id: 'old', status: 'merged', files: ['a.js'] }
    ]
  })
  const lock = workLock(root)
  assert.equal(lock.locked, true)
  assert.equal(lock.holders.length, 1, 'a merged run holds nothing')
  assert.match(lock.why, /crowd/)

  for (const operation of ['set', 'spawn', 'destroy', 'play', 'saveLevel', 'new.file']) {
    const { allowed, why } = permits(lock, operation)
    assert.equal(allowed, false, `${operation} must be held`)
    assert.match(why, /crowd/, `${operation} must say who holds it`)
  }
  // Reading is the whole point of watching lanes work.
  for (const operation of ['snapshot', 'entity', 'see.describe', 'clients']) {
    assert.equal(permits(lock, operation).allowed, true, `${operation} must still answer`)
  }
})

test('a lane browser holds the lock while its process runs', testContext => {
  const lock = workLock(
    checkout(testContext, {
      browsers: [{ client: 'lane-a', port: 9400, pid: LIVE_PID, startedAt: '2026-08-31T07:00:00Z' }]
    })
  )
  assert.equal(lock.locked, true)
  assert.equal(lock.holders[0].kind, 'browser')
  assert.equal(lock.holders[0].pid, LIVE_PID)
  assert.match(lock.why, /lane-a/)
})

test('a killed lane browser holds nothing, and the reply says to clear it', testContext => {
  const lock = workLock(
    checkout(testContext, {
      browsers: [{ client: 'charlie', port: 9401, pid: DEAD_PID, startedAt: '2026-08-31T07:00:00Z' }]
    })
  )
  assert.equal(lock.locked, false, 'a record whose process is gone holds nothing')
  assert.deepEqual(lock.holders, [])
  assert.equal(lock.stale.length, 1)
  assert.equal(lock.stale[0].id, 'charlie')
  assert.match(lock.stale[0].why, new RegExp(`${DEAD_PID}.*gone`))
  assert.match(lock.note, /charlie/)
  assert.match(lock.note, /lanes\.stop/, 'it says how to clear the record')
  assert.equal(permits(lock, 'set').allowed, true, 'the person may edit again')
})

test('a record with no pid cannot be proved, so it holds nothing', testContext => {
  const lock = workLock(checkout(testContext, { browsers: [{ client: 'nameless', port: 9402 }] }))
  assert.equal(lock.locked, false)
  assert.match(lock.stale[0].why, /unrecorded/)
})

test('a dead record does not hide a live one', testContext => {
  const lock = workLock(
    checkout(testContext, {
      browsers: [
        { client: 'charlie', port: 9401, pid: DEAD_PID },
        { client: 'delta', port: 9402, pid: LIVE_PID }
      ]
    })
  )
  assert.equal(lock.locked, true)
  assert.deepEqual(
    lock.holders.map(holder => holder.id),
    ['delta']
  )
  assert.match(lock.why, /delta/)
  assert.match(lock.why, /charlie/, 'the stale record is reported in the same reply')
  assert.match(lock.why, /lanes\.stop/)
})

test('several holders are all named, once each', testContext => {
  const lock = workLock(
    checkout(testContext, {
      runs: [
        { id: 'crowd', status: 'active' },
        { id: 'hero', status: 'active' }
      ],
      browsers: [{ client: 'crowd', port: 9400, pid: LIVE_PID }]
    })
  )
  assert.match(lock.why, /2 lanes are working/, 'one lane with a browser is still one lane')
  assert.match(lock.why, /crowd/)
  assert.match(lock.why, /hero/)
  assert.match(lock.why, /agent\.release/, 'it says how to release')
})

test('role comes from the registry, not from the caller', testContext => {
  const root = checkout(testContext, {
    browsers: [
      { client: 'lane-a', port: 9400, pid: LIVE_PID },
      { client: 'charlie', port: 9401, pid: DEAD_PID }
    ]
  })
  assert.equal(roleOfClient(root, 'lane-a'), 'lane', 'a live record is the only proof of a lane')
  assert.equal(roleOfClient(root, 'charlie'), 'person', 'a killed lane leaves a name anyone may claim')
  assert.equal(roleOfClient(root, 'editor'), 'person', 'an unrecorded name is the person')
  assert.equal(roleOfClient(root, ''), 'person')
  assert.equal(roleOfClient(root, undefined), 'person')
  assert.equal(roleOfClient(root, 'LANE-A'), 'person', 'the name must match the record exactly')
})

test('a visible editor window holds nothing and may write', testContext => {
  const root = checkout(testContext, {
    browsers: [{ client: 'editor', port: 9400, pid: LIVE_PID, headless: false }]
  })
  const lock = workLock(root)
  assert.equal(lock.locked, false, "the person's own window is not a lane")
  assert.deepEqual(lock.holders, [])
  assert.deepEqual(lock.stale, [], 'and its live record is not stale litter')
  assert.equal(roleOfClient(root, 'editor'), 'person')
  assert.equal(permits(lock, 'set').allowed, true)
})

test('role is unaffected by what the page reports about itself', testContext => {
  // The page's headless flag and user agent reach the server as ordinary
  // strings. Neither is a client name, so neither can reach this function.
  const root = checkout(testContext, { browsers: [{ client: 'lane-a', port: 9400, pid: LIVE_PID }] })
  for (const claimed of ['HeadlessChrome/151.0.0.0', 'true', 'lane', 'headless']) {
    assert.equal(roleOfClient(root, claimed), 'person', `"${claimed}" is not a lane record`)
  }
})

test('the lane role may drive its own world and is refused every file write', testContext => {
  // This is the rule permits states. vite.config.js enforces it at
  // POST /api/engine and at both file routes; this proves the rule, not the
  // wiring.
  const lock = workLock(checkout(testContext, { browsers: [{ client: 'lane-a', port: 9400, pid: LIVE_PID }] }))

  // setLive poses the lane's own world and writes no file.
  for (const operation of ['play', 'stop', 'simulate', 'seed', 'setLive']) {
    assert.equal(permits(lock, operation, 'lane').allowed, true, `a lane must be able to ${operation}`)
  }
  for (const operation of ['saveLevel', 'new.file', 'code.save', 'set', 'spawn', 'destroy']) {
    const { allowed, why } = permits(lock, operation, 'lane')
    assert.equal(allowed, false, `permits must refuse ${operation} to a lane`)
    assert.match(why, /viewer|checkout/)
  }
  assert.equal(permits(lock, 'see.capture', 'lane').allowed, true, 'capturing is why the page exists')
})

test('a missing or unreadable registry is not a lock', testContext => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-work-lock-bare-'))
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.equal(workLock(root).locked, false, 'a checkout that has never run a lane is not held')
  assert.equal(roleOfClient(root, 'lane-a'), 'person', 'no registry means no lane')
})
