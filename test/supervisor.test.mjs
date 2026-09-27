/**
 * The supervisor: the record it writes, the prover that asks the port, and the
 * two routes that start and stop what it owns.
 *
 * No Chrome runs here. A spawned headless session is node, kept alive by an
 * interval, so the tests exercise a real pid without a browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

import { devServerEnvironment, processIsAlive } from '../engine/project-servers.mjs'
import {
  startSupervisor, supervisorAddress, askSupervisor, spawnInstance, stopInstance, chooseDevServer
} from '../engine/supervisor.mjs'
import { formatSupervisorTable, formatEvents } from '../engine/supervisor-watch.mjs'
import { readLaneBrowsers } from '../engine/lane-browsers.mjs'

/** A harmless node process, used where a test needs a real pid. */
const LONG_LIVED = ['-e', 'setInterval(() => {}, 1000)']

function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-supervisor-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.engine'), { recursive: true })
  return root
}

/** A port nothing holds, for a record that must name a dead one. */
function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Poll until a condition holds, or fail saying it never did. */
async function waitUntil(predicate, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition did not become true in time')
}

/** A dev server that answers /api/server as `pid` serving `root`. */
async function fakeDevServer(root, t, pid) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/server') { response.statusCode = 404; return response.end('{}') }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ pid, serves: root, project: null, startedAt: new Date().toISOString() }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { port: server.address().port, pid }
}

/** Write one dev-server record per `{ port, pid }`, so the supervisor adopts each as running. */
function recordDevServers(root, servers) {
  fs.writeFileSync(path.join(root, '.engine/servers.json'), JSON.stringify({
    version: 1,
    servers: servers.map(({ port, pid }) => ({
      port, pid, serves: root, project: null, startedAt: new Date().toISOString()
    }))
  }))
}

/**
 * A debugging port that behaves like a visible browser: it lists pages and
 * forgets one when `/json/close/<id>` is asked, so a stop that closes the page
 * leaves no page behind.
 */
async function fakeBrowserPort(t, port, initialPages) {
  const pages = [...initialPages]
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push(request.url)
    response.setHeader('content-type', 'application/json')
    if (request.url.startsWith('/json/list')) return response.end(JSON.stringify(pages))
    const close = request.url.match(/^\/json\/close\/(.+)$/)
    if (close) {
      const at = pages.findIndex(page => page.id === decodeURIComponent(close[1]))
      if (at >= 0) pages.splice(at, 1)
    }
    response.end('{"ok":true}')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()) }))
  return { port: server.address().port, requests, pages }
}

test('the supervisor writes its record on listen and removes it on close', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const file = path.join(root, '.engine/supervisor.json')
  assert.equal(fs.existsSync(file), true, 'a listening supervisor leaves a record')
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(record.port, supervisor.port, 'the record names the bound port')
  assert.equal(record.pid, process.pid)

  await supervisor.close()
  assert.equal(fs.existsSync(file), false, 'closing removes the record')
})

test('supervisorAddress returns null when the record names a dead port', async t => {
  const root = checkout(t)
  assert.equal(await supervisorAddress(root), null, 'no record is no supervisor')

  const dead = await freePort()
  fs.writeFileSync(path.join(root, '.engine/supervisor.json'),
    JSON.stringify({ port: dead, pid: 999999, startedAt: new Date().toISOString() }))
  assert.equal(await supervisorAddress(root), null, 'a record with nothing behind it proves nothing')
})

test('GET /instances returns an empty list on a fresh supervisor', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const answer = await askSupervisor(root, 'GET', '/instances')
  assert.deepEqual(answer.instances, [])
})

test('a dev server bound to localhost is proved running, not killed', async t => {
  const root = checkout(t)
  // Vite binds `localhost`, which is this address first on Windows. On a host
  // with no IPv6 loopback there is nothing to prove, so the test is skipped.
  let port
  try { port = await freePort('::1') } catch { return t.skip('this host has no IPv6 loopback') }

  const server = http.createServer((request, response) => {
    if (request.url !== '/api/server') { response.statusCode = 404; return response.end('{}') }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ pid: process.pid, serves: root, startedAt: new Date().toISOString() }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '::1', resolve)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))

  fs.writeFileSync(path.join(root, '.engine/servers.json'), JSON.stringify({
    version: 1,
    servers: [{ port, pid: process.pid, serves: root, project: null, startedAt: new Date().toISOString() }]
  }))

  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const adopted = supervisor.instances.find(entry => entry.kind === 'dev-server')
  assert.equal(adopted?.state, 'running', 'the IPv6-bound server is proved running at adoption')

  // Three more proved rounds: two unresponsive proofs used to discard a healthy
  // server, so a fix that still asked 127.0.0.1 fails here.
  for (let round = 1; round <= 3; round++) {
    const listed = await askSupervisor(root, 'GET', '/instances')
    const proved = listed.instances.find(entry => entry.kind === 'dev-server')
    assert.equal(proved?.state, 'running', `round ${round} still proves the dev server running`)
  }
})

test('a dev server answer from another process is not this instance', async t => {
  const root = checkout(t)
  let port
  try { port = await freePort('::1') } catch { return t.skip('this host has no IPv6 loopback') }

  // A stranger on the port answers /api/server as itself, while the record
  // names a pid that is gone. The reply alone must not prove our server alive.
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ pid: process.pid, serves: root, startedAt: new Date().toISOString() }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '::1', resolve)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))

  fs.writeFileSync(path.join(root, '.engine/servers.json'), JSON.stringify({
    version: 1,
    servers: [{ port, pid: 999999, serves: root, project: null, startedAt: new Date().toISOString() }]
  }))

  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const listed = await askSupervisor(root, 'GET', '/instances')
  assert.deepEqual(listed.instances, [], 'a stranger answering the port does not prove the server')
})

test('a browser recorded after the supervisor started is adopted on the next proof', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  // A browser this supervisor never started: a probe tool, an open editor
  // window, or `lanes.start`. It writes the same lane registry, and the running
  // supervisor must see it rather than wait for a restart.
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end('[]')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'lane-late', port, pid: process.pid, url: `http://localhost:${port}/?client=lane-late`,
      profile: 'P', serves: root, headless: true, startedAt: new Date().toISOString()
    }]
  }))

  const listed = await askSupervisor(root, 'GET', '/instances')
  const adopted = listed.instances.find(entry => entry.client === 'lane-late')
  assert.equal(adopted?.kind, 'lane-browser', 'the running supervisor adopted it')
  assert.equal(adopted?.state, 'running', 'and proved it by its debugging port')
  assert.equal(adopted?.owned, false, 'an adopted instance is not killed on this supervisor exit')
})

test('a browser with no url and several dev servers refuses and names each', async t => {
  const root = checkout(t)
  // Two distinct pids, because the supervisor adopts one record per process.
  const servers = [await fakeDevServer(root, t, 910001), await fakeDevServer(root, t, 910002)]
  recordDevServers(root, servers)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const adopted = supervisor.instances.filter(entry => entry.kind === 'dev-server')
  assert.equal(adopted.length, 2, 'both dev servers are adopted')
  await assert.rejects(() => spawnInstance(supervisor, { kind: 'editor-browser' }), error => {
    assert.match(error.message, /several dev servers are running/)
    for (const server of adopted) {
      assert.match(error.message, new RegExp(server.id), `the refusal names ${server.id}`)
      assert.match(error.message, new RegExp(`localhost:${server.port}`), `the refusal names the url on ${server.port}`)
    }
    return true
  })
})

test('a browser with no url and no dev server names the verb that starts one', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  for (const kind of ['editor-browser', 'lane-browser']) {
    await assert.rejects(() => spawnInstance(supervisor, { kind }),
      /no dev server is running to open .* on; start one with `node bin\/engine\.mjs supervisor\.open dev-server`/)
  }
})

test('chooseDevServer picks the one running server and refuses none or many', () => {
  const one = { kind: 'dev-server', id: 'dev-server-1', url: 'http://localhost:5180/', state: 'running' }
  assert.equal(chooseDevServer([one], 'editor-browser'), one, 'the one running server is the answer')
  assert.equal(chooseDevServer([one], 'lane-browser'), one, 'the browser kind does not change the choice')
  assert.throws(() => chooseDevServer([], 'editor-browser'), /an editor-browser/)
  assert.throws(() => chooseDevServer([], 'lane-browser'), /a lane-browser/)
  assert.throws(
    () => chooseDevServer([one, { ...one, id: 'dev-server-2', url: 'http://localhost:5181/' }], 'editor-browser'),
    error => {
      assert.match(error.message, /dev-server-1/)
      assert.match(error.message, /dev-server-2/)
      return true
    })
})

const tableSample = {
  port: 5179,
  pid: 100,
  startedAt: '2026-01-01T00:09:30.000Z',
  instances: [
    { kind: 'dev-server', id: 'dev-server-1', port: 5180, pid: 200, project: 'my game', startedAt: '2026-01-01T00:09:00.000Z', state: 'running' },
    { kind: 'editor-browser', id: 'editor-browser-2', port: 9400, pid: 300, project: null, startedAt: '2026-01-01T00:05:00.000Z', state: 'unresponsive' }
  ]
}

test('the watch table names every field the prover keeps', () => {
  const now = Date.parse('2026-01-01T00:10:00.000Z')
  const table = formatSupervisorTable(tableSample, now, 120)

  assert.match(table, /engine supervisor 127\.0\.0\.1:5179\s+pid 100\s+up 30s\s+2 instances/)
  assert.match(table, /KIND\s+ID\s+PORT\s+PID\s+PROJECT\s+AGE\s+STATE/)
  assert.match(table, /dev-server\s+dev-server-1\s+5180\s+200\s+my game\s+1m00s\s+running/)
  assert.match(table, /editor-browser\s+editor-browser-2\s+9400\s+300\s+-\s+5m00s\s+unresponsive/)
})

test('the watch table fits the window it is in', () => {
  const now = Date.parse('2026-01-01T00:10:00.000Z')
  // 60 shows the fields a narrow window needs; 80 gives project up for pid and
  // age; 120 has room for all of them. No line is ever wider than the window,
  // because a wrapped row reads as a broken table.
  const narrow = formatSupervisorTable(tableSample, now, 60)
  assert.match(narrow, /KIND\s+ID\s+PORT\s+STATE/)
  assert.doesNotMatch(narrow, /PROJECT|PID|AGE/)
  const middle = formatSupervisorTable(tableSample, now, 80)
  assert.match(middle, /KIND\s+ID\s+PORT\s+PID\s+AGE\s+STATE/)
  assert.doesNotMatch(middle, /PROJECT/)
  for (const width of [60, 80, 120]) {
    const table = formatSupervisorTable(tableSample, now, width)
    for (const line of table.split('\n')) {
      assert.ok(line.length <= width, `at ${width} columns this line is ${line.length}: ${line}`)
    }
  }
})

test('the event feed says what opened, what closed and why', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const entry = await spawnInstance(supervisor, {
    kind: 'headless-session', command: process.execPath, args: LONG_LIVED
  })
  t.after(() => { try { process.kill(entry.pid, 'SIGKILL') } catch { /* already gone */ } })

  let events = (await askSupervisor(root, 'GET', '/events')).events
  assert.deepEqual(events.map(next => [next.event, next.id]), [['opened', entry.id]])
  assert.match(events[0].detail, /^pid \d+$/, 'an opened event names the port or the pid')

  await askSupervisor(root, 'DELETE', `/instances/${entry.id}`)
  events = (await askSupervisor(root, 'GET', '/events')).events
  assert.deepEqual(events.map(next => [next.event, next.id, next.detail]), [
    ['opened', entry.id, events[0].detail],
    ['closed', entry.id, 'asked']
  ])
})

test('the prover records an instance it finds gone as killed outside', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const entry = await spawnInstance(supervisor, {
    kind: 'headless-session', command: process.execPath, args: LONG_LIVED
  })
  process.kill(entry.pid, 'SIGKILL')
  await waitUntil(() => !processIsAlive(entry.pid))
  await askSupervisor(root, 'GET', '/instances')

  const gone = (await askSupervisor(root, 'GET', '/events')).events.find(next => next.event === 'gone')
  assert.equal(gone?.id, entry.id, 'the gone event names the instance')
  assert.equal(gone?.detail, 'killed outside', 'the why says nobody asked')
})

test('the watch feed draws newest last, with a clock and a reason', () => {
  const feed = formatEvents([
    { at: '2026-01-01T00:31:04.000Z', event: 'opened', id: 'dev-server-3', detail: 'port 5183' },
    { at: '2026-01-01T00:31:22.000Z', event: 'gone', id: 'editor-browser-2', detail: 'killed outside' },
    { at: '2026-01-01T00:31:40.000Z', event: 'closed', id: 'dev-server-1', detail: 'asked' }
  ])
  const lines = feed.split('\n')
  assert.equal(lines.length, 3, 'one line per event')
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2}  opened\s+dev-server-3\s+port 5183$/)
  assert.match(lines[1], /^\d{2}:\d{2}:\d{2}  gone\s+editor-browser-2\s+killed outside$/)
  assert.match(lines[2], /^\d{2}:\d{2}:\d{2}  closed\s+dev-server-1\s+asked$/)
  assert.equal(formatEvents([]), 'no events yet')
})

test('the watch feed prints UTC, the clock the table and the JSON share', () => {
  // The stored instant is UTC. On a machine east of it, a feed that formatted
  // with local time would print the hour after, and the same event would read
  // as two different instants in the feed and the table.
  const feed = formatEvents([
    { at: '2026-01-01T00:31:04.000Z', event: 'opened', id: 'dev-server-3', detail: 'port 5183' }
  ])
  assert.match(feed, /^00:31:04  opened\s+dev-server-3\s+port 5183$/, 'the feed shows the stored UTC instant')
})

test('the dev server config refuses to move off the port it was given', async () => {
  // The supervisor names one port and waits on it. Without strictPort, Vite
  // binds the next free port and the wait fails on a server that is running.
  const config = (await import('../vite.config.js')).default
  assert.equal(config.server.strictPort, true,
    'Vite must fail on a taken port, not bind another one the supervisor never learns')
})

test('a start that never binds names whether the process died or stayed up', async t => {
  const root = checkout(t)
  // A stub for the vite binary, so the test pays neither a real cold start nor
  // the timeout it proves is there. Its behaviour is rewritten between starts.
  const vite = path.join(root, 'node_modules/vite/bin/vite.js')
  fs.mkdirSync(path.dirname(vite), { recursive: true })
  const supervisor = await startSupervisor(root, { port: 0, startTimeoutMilliseconds: 400 })
  t.after(() => supervisor.close())

  // A live process that never answers its port. Vite is spawned, the wait runs
  // out with the process still there, and the failed start must say so.
  fs.writeFileSync(vite, 'setInterval(() => {}, 1000)\n')
  await assert.rejects(() => spawnInstance(supervisor, { kind: 'dev-server' }), /never came up/)
  const alive = (await askSupervisor(root, 'GET', '/events')).events.find(event => event.event === 'failed')
  assert.equal(alive?.detail, 'process alive but never bound',
    'a live process that never bound is not reported as if it had died')

  // A process that exits before it can bind.
  fs.writeFileSync(vite, 'process.exit(1)\n')
  await assert.rejects(() => spawnInstance(supervisor, { kind: 'dev-server' }), /never came up/)
  const died = (await askSupervisor(root, 'GET', '/events')).events.filter(event => event.event === 'failed').at(-1)
  assert.equal(died?.detail, 'process died', 'a process that is gone is named as gone')
})

test('a dev server serving a lane worktree is proved by its own serves', async t => {
  const root = checkout(t)
  const lane = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-lane-'))
  t.after(() => fs.rmSync(lane, { recursive: true, force: true }))
  let port
  try { port = await freePort('::1') } catch { return t.skip('this host has no IPv6 loopback') }

  // A lane server runs with its cwd in the worktree, so /api/server names the
  // worktree as the checkout it serves while its record lives in the main one.
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/server') { response.statusCode = 404; return response.end('{}') }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ pid: process.pid, serves: lane, startedAt: new Date().toISOString() }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '::1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))

  fs.writeFileSync(path.join(root, '.engine/servers.json'), JSON.stringify({
    version: 1,
    servers: [{ port, pid: process.pid, serves: lane, project: null, startedAt: new Date().toISOString() }]
  }))

  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const adopted = supervisor.instances.find(entry => entry.kind === 'dev-server')
  assert.equal(adopted.serves, lane, 'the adopted row carries the checkout the reply names')
  assert.equal(adopted.state, 'running', 'a lane server is proved by its own serves, not the main checkout')
  for (let round = 1; round <= 3; round++) {
    const listed = await askSupervisor(root, 'GET', '/instances')
    assert.equal(listed.instances.find(entry => entry.kind === 'dev-server')?.state, 'running',
      `round ${round} still proves the lane server running`)
  }
})

test('a dev server serves a directory inside this checkout but refuses one outside', async t => {
  const root = checkout(t)
  // A stub for the vite binary, so the accepted start pays no real cold start.
  const vite = path.join(root, 'node_modules/vite/bin/vite.js')
  fs.mkdirSync(path.dirname(vite), { recursive: true })
  fs.writeFileSync(vite, 'setInterval(() => {}, 1000)\n')
  const supervisor = await startSupervisor(root, { port: 0, startTimeoutMilliseconds: 300 })
  t.after(() => supervisor.close())

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-outside-'))
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  await assert.rejects(
    () => spawnInstance(supervisor, { kind: 'dev-server', checkout: outside }),
    /outside this checkout's main worktree/)

  // The stub never binds, so the start fails on its timeout. Reaching that
  // timeout is what proves a checkout inside the root was accepted.
  const lane = path.join(root, 'lane')
  fs.mkdirSync(lane, { recursive: true })
  await assert.rejects(
    () => spawnInstance(supervisor, { kind: 'dev-server', checkout: lane }),
    /never came up/)
})

test('an instance whose pid is dead is proved gone and dropped', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const entry = await spawnInstance(supervisor, {
    kind: 'headless-session', command: process.execPath, args: LONG_LIVED
  })
  t.after(() => { try { process.kill(entry.pid, 'SIGKILL') } catch { /* already gone */ } })
  assert.equal(entry.state, 'running')

  process.kill(entry.pid, 'SIGKILL')
  await waitUntil(() => !processIsAlive(entry.pid))

  const listed = await askSupervisor(root, 'GET', '/instances')
  assert.deepEqual(listed.instances, [], 'a dead pid is dropped, not listed')
})

test('an unresponsive instance never carries the internal round count', async t => {
  const root = checkout(t)
  const dead = await freePort()
  // A live process on a port that answers nothing: the first proof marks it
  // unresponsive, and it stays listed until a second proof discards it.
  const child = spawn(process.execPath, LONG_LIVED, { stdio: 'ignore' })
  t.after(() => { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } })
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{ client: 'ghost', port: dead, pid: child.pid, headless: true, startedAt: new Date().toISOString() }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const ghost = supervisor.instances.find(entry => entry.client === 'ghost')
  assert.equal(ghost.state, 'unresponsive', 'a live pid on a dead port is unresponsive once')
  assert.equal('unresponsiveRounds' in ghost, false, 'the count is not part of the instance')

  const listed = await askSupervisor(root, 'GET', '/instances')
  assert.equal(listed.instances.some(entry => 'unresponsiveRounds' in entry), false,
    'no HTTP reply carries the internal count')
})

test('POST /shutdown stops the owned process and takes the record down', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  const entry = await spawnInstance(supervisor, {
    kind: 'headless-session', command: process.execPath, args: LONG_LIVED
  })
  t.after(() => { try { process.kill(entry.pid, 'SIGKILL') } catch { /* already gone */ } })

  const answer = await askSupervisor(root, 'POST', '/shutdown')
  assert.equal(answer.ok, true)
  await waitUntil(() => !processIsAlive(entry.pid))
  assert.equal(processIsAlive(entry.pid), false, 'the owned process is stopped')

  await waitUntil(async () => (await supervisorAddress(root)) === null)
  assert.equal(await supervisorAddress(root), null, 'the supervisor is down')
  await assert.rejects(() => askSupervisor(root, 'GET', '/health'), /no supervisor is running/)
})

/** A pid that has certainly exited: a node process that ran and stopped. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid
}

test('a repeat stop is a success that says the instance is already stopped', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  const entry = await spawnInstance(supervisor, {
    kind: 'headless-session', command: process.execPath, args: LONG_LIVED
  })
  t.after(() => { try { process.kill(entry.pid, 'SIGKILL') } catch { /* already gone */ } })

  const first = await stopInstance(supervisor, entry.id)
  assert.deepEqual(first.stopped.map(one => one.id), [entry.id], 'the first stop stops it')
  assert.deepEqual(first.alreadyStopped, [], 'the first stop did not already find it stopped')

  const second = await stopInstance(supervisor, entry.id)
  assert.deepEqual(second.stopped, [], 'the second stop stops nothing')
  assert.deepEqual(second.alreadyStopped, [entry.id], 'the second stop names it as already stopped')
})

test('an id this supervisor never made is a 404 that names the ids that exist', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  const entry = await spawnInstance(supervisor, {
    kind: 'headless-session', command: process.execPath, args: LONG_LIVED
  })
  t.after(() => { try { process.kill(entry.pid, 'SIGKILL') } catch { /* already gone */ } })

  await assert.rejects(() => stopInstance(supervisor, 'headless-session-999'), error => {
    assert.equal(error.statusCode, 404, 'a never-made id is a 404')
    assert.match(error.message, /no instance is called "headless-session-999"/)
    assert.match(error.message, new RegExp(entry.id), 'the refusal names the ids that exist')
    return true
  })
  // Stop it here: a child left holding its log file blocks the checkout sweep.
  await stopInstance(supervisor, entry.id)
})

test('a lane cannot take a client name a live window holds', async t => {
  const root = checkout(t)
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor', port: 39400, pid: process.pid, profile: path.join(root, 'editor-profile'),
      headless: false, startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  await assert.rejects(
    () => spawnInstance(supervisor, {
      kind: 'lane-browser', url: 'http://127.0.0.1:1/', client: 'editor', chrome: process.execPath
    }),
    error => {
      assert.match(error.message, /already called "editor"/, 'the second claim is refused')
      assert.match(error.message, new RegExp(`process ${process.pid}`), 'the refusal names the holder')
      assert.match(error.message, /supervisor\.stop/, 'the refusal says how to stop the holder')
      assert.match(error.message, /another client name/, 'the refusal offers another name')
      return true
    })
})

test('a client name whose record process is gone is free to take', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  // Written after startup, as an outside tool would: the supervisor has not
  // adopted it, and its process is already gone.
  fs.mkdirSync(path.join(root, 'dead-profile'), { recursive: true })
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'reused', port: 39400, pid: deadPid(), profile: path.join(root, 'dead-profile'),
      headless: true, startedAt: new Date().toISOString()
    }]
  }))

  await assert.rejects(
    () => spawnInstance(supervisor, {
      kind: 'lane-browser', url: 'http://127.0.0.1:1/', client: 'reused', chrome: process.execPath
    }),
    error => {
      assert.doesNotMatch(error.message, /already called "reused"/, 'a dead record does not hold the name')
      return true
    })
  assert.equal(fs.existsSync(path.join(root, 'dead-profile')), false, 'the dead lane profile goes with the record')
})

test('opening an editor client already open reuses its one instance', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/?client=one' }
  ])
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor', port: browser.port, pid: process.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  const adopted = supervisor.instances.find(entry => entry.kind === 'editor-browser')
  assert.ok(adopted, 'the running browser is adopted')
  assert.equal(adopted.client, 'one', 'the adopted row takes its name from the page it holds')

  const opened = await spawnInstance(supervisor,
    { kind: 'editor-browser', url: 'http://localhost:5180/', client: 'one' })

  assert.equal(opened.id, adopted.id, 'the open returns the running instance, not a new one')
  assert.equal(opened.state, 'running')
  assert.equal(supervisor.instances.filter(entry => entry.kind === 'editor-browser').length, 1,
    'the open adds no second editor instance')
  assert.ok(browser.requests.includes('/json/activate/page-1'), 'the existing page is brought to the front')
})

test('every editor tab in one window is its own instance', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/?client=one' },
    { id: 'page-2', type: 'page', url: 'http://localhost:5180/?client=two' }
  ])
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor', port: browser.port, pid: process.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const editors = supervisor.instances.filter(entry => entry.kind === 'editor-browser')
  assert.deepEqual(editors.map(entry => entry.client), ['one', 'two'], 'one row per tab, each under its own name')
  assert.deepEqual(editors.map(entry => entry.pageId), ['page-1', 'page-2'], 'each row holds the page it can close')
  assert.deepEqual(new Set(editors.map(entry => entry.browser)), new Set(['editor']),
    'both rows name the one browser record they share')

  await stopInstance(supervisor, editors[0].id)

  assert.deepEqual(browser.pages.map(page => page.id), ['page-2'], 'stopping one instance closes only its tab')
  assert.equal(supervisor.instances.filter(entry => entry.kind === 'editor-browser').length, 1,
    'the other tab is still an instance')
  assert.equal(readLaneBrowsers(root).length, 1, 'the shared browser record stays while a tab is open')
})

test('stopping an editor-browser closes its page and kills the browser it started', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/' }
  ])
  const child = spawn(process.execPath, LONG_LIVED, { stdio: 'ignore' })
  t.after(() => { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } })
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor-stop', port: browser.port, pid: child.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedBrowser: true,
      startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  const adopted = supervisor.instances.find(entry => entry.client === 'editor-stop')
  assert.equal(adopted.startedBrowser, true, 'the record says this browser was started by the editor')

  await stopInstance(supervisor, adopted.id)
  await waitUntil(() => !processIsAlive(child.pid))

  assert.ok(browser.requests.some(path => path.startsWith('/json/close/page-1')), 'the page is closed through the port')
  assert.equal(processIsAlive(child.pid), false, 'the browser this instance started is killed')
  assert.equal(readLaneBrowsers(root).length, 0, 'the browser record is forgotten')
})

test('stopping an editor-browser leaves a browser another instance started', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/' }
  ])
  const child = spawn(process.execPath, LONG_LIVED, { stdio: 'ignore' })
  t.after(() => { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } })
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor-reused', port: browser.port, pid: child.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedBrowser: false,
      startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  const adopted = supervisor.instances.find(entry => entry.client === 'editor-reused')

  await stopInstance(supervisor, adopted.id)

  assert.ok(browser.requests.some(path => path.startsWith('/json/close/page-1')), 'the page is closed through the port')
  assert.equal(processIsAlive(child.pid), true, 'the browser another instance started is left running')
})

/** A live pid that is safe to kill: a node process doing nothing. */
function throwawayProcess(t) {
  const child = spawn(process.execPath, LONG_LIVED, { stdio: 'ignore' })
  t.after(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } })
  return child.pid
}

test('stopping a dev server closes the pages left pointing at it', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-dead', type: 'page', url: 'http://localhost:5180/' },
    { id: 'page-other', type: 'page', url: 'http://localhost:5199/' }
  ])
  supervisor.instances.push(
    { id: 'dev-server-a', kind: 'dev-server', pid: throwawayProcess(t), port: 5180, url: 'http://localhost:5180/', state: 'running', owned: true },
    { id: 'editor-browser-b', kind: 'editor-browser', pid: throwawayProcess(t), port: browser.port, url: 'http://localhost:5180/', headless: false, state: 'running', owned: true, startedBrowser: false }
  )

  await stopInstance(supervisor, 'dev-server-a')

  assert.deepEqual(browser.pages.map(page => page.id), ['page-other'],
    'the page on the stopped server is closed and the unrelated one is kept')
  const events = await askSupervisor(root, 'GET', '/events')
  assert.ok(events.events.some(event => /its server dev-server-a is gone/.test(event.detail || '')),
    'the feed says why the page was closed')
})

test('a browser this supervisor started is ended when its last page goes', async t => {
  const root = checkout(t)
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const browser = await fakeBrowserPort(t, 0, [{ id: 'page-only', type: 'page', url: 'http://localhost:5180/' }])
  supervisor.instances.push(
    { id: 'dev-server-a', kind: 'dev-server', pid: throwawayProcess(t), port: 5180, url: 'http://localhost:5180/', state: 'running', owned: true },
    { id: 'editor-browser-b', kind: 'editor-browser', pid: throwawayProcess(t), port: browser.port, url: 'http://localhost:5180/', headless: false, state: 'running', owned: true, startedBrowser: true }
  )

  await stopInstance(supervisor, 'dev-server-a')

  assert.equal(browser.pages.length, 0, 'its only page is closed')
  assert.equal(supervisor.instances.some(entry => entry.id === 'editor-browser-b'), false,
    'a browser with no page left is not kept running')
})

test('a browser record the supervisor just wrote is not adopted as a second row', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/?client=one' }
  ])
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor', port: browser.port, pid: process.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  const before = supervisor.instances.filter(entry => entry.kind === 'editor-browser').length
  assert.equal(before, 1, 'the running browser is one row')

  // A listing proves and adopts. The record is the same one the row already
  // holds, under a pid no row of its own carries.
  await askSupervisor(root, 'GET', '/instances', null, 5000)
  await askSupervisor(root, 'GET', '/instances', null, 5000)

  assert.equal(supervisor.instances.filter(entry => entry.kind === 'editor-browser').length, 1,
    'proving again adds no second row for the same browser')
})

test('a tab closed by hand is proved gone, and its siblings are not', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/?client=one' },
    { id: 'page-2', type: 'page', url: 'http://localhost:5180/?client=two' }
  ])
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor', port: browser.port, pid: process.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())
  assert.equal(supervisor.instances.filter(entry => entry.kind === 'editor-browser').length, 2)

  // What closing a tab in the window leaves behind: the browser still answers
  // its port, and one page is no longer listed.
  browser.pages.splice(browser.pages.findIndex(page => page.id === 'page-1'), 1)
  const listed = await askSupervisor(root, 'GET', '/instances', null, 5000)

  const editors = listed.instances.filter(entry => entry.kind === 'editor-browser')
  assert.deepEqual(editors.map(entry => entry.client), ['two'], 'only the tab that is still open is listed')
  const gone = supervisor.events.find(event => event.event === 'gone')
  assert.equal(gone?.detail, 'its tab was closed', 'the feed says the tab went without being asked')
})

test('the table says whether each browser can be seen, and says nothing for a dev server', () => {
  const now = Date.parse('2026-01-01T00:10:00.000Z')
  const table = formatSupervisorTable({
    ...tableSample,
    instances: [
      { ...tableSample.instances[0] },
      { ...tableSample.instances[1], state: 'running', showing: 'visible' },
      { kind: 'editor-browser', id: 'editor-browser-3', port: 9400, pid: 300, project: null, startedAt: '2026-01-01T00:05:00.000Z', state: 'running', showing: 'hidden' },
      { kind: 'editor-browser', id: 'editor-browser-4', port: 9400, pid: 300, project: null, startedAt: '2026-01-01T00:05:00.000Z', state: 'running', showing: null }
    ]
  }, now, 130)

  assert.match(table, /KIND\s+ID\s+PORT\s+PID\s+PROJECT\s+AGE\s+STATE\s+SHOWING/)
  assert.match(table, /dev-server-1.*running\s+-\s*$/m, 'a dev server has no page, so it claims nothing')
  assert.match(table, /editor-browser-2.*running\s+visible/)
  assert.match(table, /editor-browser-3.*running\s+hidden/)
  assert.match(table, /editor-browser-4.*running\s+-\s*$/m, 'a browser with no attached page is not guessed at')
})

test('the prover reads showing from the page, not from the port', async t => {
  const root = checkout(t)
  const browser = await fakeBrowserPort(t, 0, [
    { id: 'page-1', type: 'page', url: 'http://localhost:5180/?client=one' },
    { id: 'page-2', type: 'page', url: 'http://localhost:5180/?client=two' }
  ])
  // The dev server carries what each page says about itself, which is the one
  // place the answer exists: the debugging port reports a hidden window as
  // normal.
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url !== '/api/server') { response.statusCode = 404; return response.end('{}') }
    response.end(JSON.stringify({
      pid: process.pid, serves: root, project: null, startedAt: new Date().toISOString(),
      tabs: [{ id: 'one', hidden: false }, { id: 'two', hidden: true }]
    }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()) }))

  recordDevServers(root, [{ port: server.address().port, pid: process.pid }])
  fs.writeFileSync(path.join(root, '.engine/lane-browsers.json'), JSON.stringify({
    version: 1,
    browsers: [{
      client: 'editor', port: browser.port, pid: process.pid, url: 'http://localhost:5180/',
      profile: path.join(root, 'editor-profile'), headless: false, startedAt: new Date().toISOString()
    }]
  }))
  const supervisor = await startSupervisor(root, { port: 0 })
  t.after(() => supervisor.close())

  const listed = await askSupervisor(root, 'GET', '/instances', null, 5000)
  const byClient = new Map(listed.instances.filter(entry => entry.client).map(entry => [entry.client, entry]))
  assert.equal(byClient.get('one')?.showing, 'visible', 'the page in front says it can be seen')
  assert.equal(byClient.get('two')?.showing, 'hidden', 'the tab behind it says it cannot')
  assert.equal(listed.instances.find(entry => entry.kind === 'dev-server')?.showing, undefined,
    'a dev server has no page, so it claims nothing')
})

test('a dev server opened for a project is started with that project', () => {
  assert.equal(devServerEnvironment(5180, '../engine-projects/arena').ENGINE_PROJECT, '../engine-projects/arena')
  assert.equal(devServerEnvironment(5180, null).ENGINE_PROJECT, process.env.ENGINE_PROJECT)
  assert.equal(devServerEnvironment(5181, null).ENGINE_PORT, '5181')
})
