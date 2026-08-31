import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { workLock, permits } from '../engine/work-lock.mjs'

function checkout(t, { runs = [], browsers = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-work-lock-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const engine = path.join(root, 'project/.engine')
  fs.mkdirSync(engine, { recursive: true })
  fs.writeFileSync(path.join(engine, 'agents.json'), JSON.stringify({ runs }))
  fs.writeFileSync(path.join(engine, 'lane-browsers.json'), JSON.stringify({ browsers }))
  return root
}

test('nothing working means nothing is held', t => {
  const lock = workLock(checkout(t))
  assert.equal(lock.locked, false)
  assert.deepEqual(lock.holders, [])
  assert.equal(permits(lock, 'set').allowed, true)
})

test('an active run holds the person out of every writing op', t => {
  const root = checkout(t, {
    runs: [
      { id: 'crowd', status: 'active', files: ['engine/render.js'], startedAt: '2026-08-31T07:00:00Z' },
      { id: 'old', status: 'merged', files: ['a.js'] }
    ]
  })
  const lock = workLock(root)
  assert.equal(lock.locked, true)
  assert.equal(lock.holders.length, 1, 'a merged run holds nothing')
  assert.match(lock.why, /crowd/)

  for (const op of ['set', 'spawn', 'destroy', 'play', 'saveLevel', 'new.file']) {
    const { allowed, why } = permits(lock, op)
    assert.equal(allowed, false, `${op} must be held`)
    assert.match(why, /crowd/, `${op} must say who holds it`)
  }
  // Reading is the whole point of watching lanes work.
  for (const op of ['snapshot', 'entity', 'see.describe', 'clients']) {
    assert.equal(permits(lock, op).allowed, true, `${op} must still answer`)
  }
})

test('a lane browser holds the lock too', t => {
  const lock = workLock(checkout(t, {
    browsers: [{ client: 'lane-a', port: 9400, startedAt: '2026-08-31T07:00:00Z' }]
  }))
  assert.equal(lock.locked, true)
  assert.equal(lock.holders[0].kind, 'browser')
  assert.match(lock.why, /lane-a/)
})

test('several holders are all named, once each', t => {
  const lock = workLock(checkout(t, {
    runs: [{ id: 'crowd', status: 'active' }, { id: 'hero', status: 'active' }],
    browsers: [{ client: 'crowd', port: 9400 }]
  }))
  assert.match(lock.why, /2 lanes are working/, 'one lane with a browser is still one lane')
  assert.match(lock.why, /crowd/)
  assert.match(lock.why, /hero/)
  assert.match(lock.why, /agent\.release/, 'it says how to release')
})

test('a lane may drive its own world and may never write a file', t => {
  const lock = workLock(checkout(t, { browsers: [{ client: 'lane-a', port: 9400 }] }))

  // Its own world: this is what a lane exists to do, lock or no lock.
  for (const op of ['play', 'stop', 'simulate', 'seed']) {
    assert.equal(permits(lock, op, 'lane').allowed, true, `a lane must be able to ${op}`)
  }
  // The checkout is shared. This is what rewrote a generated level.
  for (const op of ['saveLevel', 'new.file', 'code.save', 'set', 'spawn', 'destroy']) {
    const { allowed, why } = permits(lock, op, 'lane')
    assert.equal(allowed, false, `a lane must not ${op}`)
    assert.match(why, /viewer|checkout/)
  }
  assert.equal(permits(lock, 'see.capture', 'lane').allowed, true, 'capturing is why the page exists')
})

test('a missing or unreadable registry is not a lock', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-work-lock-bare-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.equal(workLock(root).locked, false, 'a checkout that has never run a lane is not held')
})
