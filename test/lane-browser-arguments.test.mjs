/**
 * What a lane's Chrome is told to open.
 *
 * No Chrome runs here. A container runs as root, and Chrome started as root
 * with its sandbox on exits before it opens a debugging port, so a lane there
 * never comes up. Only root gets the flag that turns the sandbox off.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { laneBrowserArguments } from '../engine/lane-browsers.mjs'

const lane = { port: 9400, profile: '/tmp/lane-x', width: 540, height: 960, page: 'http://localhost:5180/?client=x' }

test('a lane started as root runs without the sandbox', () => {
  assert.ok(laneBrowserArguments({ ...lane, userId: 0 }).includes('--no-sandbox'))
})

test('a lane started by any other user keeps the sandbox', () => {
  assert.ok(!laneBrowserArguments({ ...lane, userId: 1000 }).includes('--no-sandbox'))
})

test('a platform with no user ids keeps the sandbox', () => {
  assert.ok(!laneBrowserArguments({ ...lane, userId: null }).includes('--no-sandbox'))
})

test('the page is the last argument and the port is the one asked for', () => {
  const asked = laneBrowserArguments({ ...lane, userId: 0 })
  assert.equal(asked.at(-1), lane.page)
  assert.ok(asked.includes('--remote-debugging-port=9400'))
})
