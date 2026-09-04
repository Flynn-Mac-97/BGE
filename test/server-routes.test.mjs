/**
 * The dev server's own doors, against the rules they consult.
 *
 * `engine/work-lock.mjs` and `engine/bridge-clients.mjs` decide; `vite.config.js`
 * enforces. Each module's own suite proves its rule, and neither can prove the
 * wiring — a route that forgets to ask passes both. This drives the real
 * handlers out of `vite.config.js` with a fake server, so no dev server and no
 * browser are needed.
 *
 * `ROOT` is `process.cwd()` when the config module loads, so the process moves
 * to a throwaway checkout before importing it. Node's test runner gives each
 * file its own process, so nothing else sees the move.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

const CHECKOUT = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-routes-'))
const ENGINE_DIRECTORY = path.join(CHECKOUT, '.engine')
fs.mkdirSync(path.join(CHECKOUT, 'project/levels'), { recursive: true })
fs.mkdirSync(ENGINE_DIRECTORY, { recursive: true })
fs.writeFileSync(path.join(CHECKOUT, 'project/levels/meadow.json'), '{"entities":[]}')

/** The lane registry this checkout answers with. Read fresh on every request. */
const lanes = browsers =>
  fs.writeFileSync(path.join(ENGINE_DIRECTORY, 'lane-browsers.json'), JSON.stringify({ browsers }))

/** This test process: a pid that is alive for as long as the checks run. */
const LIVE_PID = process.pid

lanes([])

const CONFIG = pathToFileURL(path.join(process.cwd(), 'vite.config.js')).href
const here = process.cwd()
process.chdir(CHECKOUT)
// Named, not defaulted: with no ENGINE_PROJECT the server opens the untitled
// project beside the checkout, and this fixture's files are in `project`.
process.env.ENGINE_PROJECT = 'project'
const config = (await import(CONFIG)).default
process.chdir(here)

process.on('exit', () => fs.rmSync(CHECKOUT, { recursive: true, force: true }))

const pluginNamed = name => config.plugins.find(plugin => plugin?.name === name)

/**
 * Run one plugin's `configureServer` and return the middleware it registered.
 *
 * Only what the handlers under test read is faked. `httpServer` is absent on
 * purpose: the server registry writes `servers.json` when one starts listening,
 * and this checkout is not a server.
 */
function serverFor(pluginName) {
  const middleware = []
  const sockets = new Map()
  const server = {
    middlewares: { use: handler => middleware.push(handler) },
    ws: { on: (event, handler) => sockets.set(event, handler), send: () => {} },
    watcher: { on: () => {} },
    config: { server: { port: 5173 } }
  }
  pluginNamed(pluginName).configureServer(server)
  return { middleware, sockets }
}

/** One request through every middleware, answered as `{ status, body }`. */
async function request(middleware, { method = 'GET', url, headers = {}, body }) {
  const incoming = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
  Object.assign(incoming, { method, url, headers })
  let answer = null
  const response = {
    statusCode: 200,
    setHeader: () => {},
    end: text => { answer = { status: response.statusCode, body: JSON.parse(text) } }
  }
  for (const handler of middleware) {
    let passed = false
    await handler(incoming, response, () => { passed = true })
    if (!passed) break
  }
  return answer
}

// ---- POST /api/file and POST /api/agent-file ----

const api = serverFor('engine-api')

const write = (headers = {}) => request(api.middleware, {
  method: 'POST',
  url: '/api/file',
  headers,
  body: { path: '../outside.json', text: '{}' }
})

test('a free checkout lets the person write, and the route judges the path', async () => {
  lanes([])
  const answer = await write()
  assert.equal(answer.status, 400, 'nothing holds the checkout, so the write is judged on its path alone')
  assert.match(answer.body.error, /outside/)
})

test('a lane render page is refused a file write, whatever the lock says', async () => {
  lanes([{ client: 'lane-a', port: 9400, pid: LIVE_PID }])
  const answer = await write({ 'x-engine-client': 'lane-a' })
  assert.equal(answer.status, 423)
  assert.equal(answer.body.code, 'held')
  assert.match(answer.body.error, /viewer|checkout/)
})

test('the person is refused a file write while a lane works, and told who holds it', async () => {
  lanes([{ client: 'lane-a', port: 9400, pid: LIVE_PID }])
  const answer = await write()
  assert.equal(answer.status, 423)
  assert.match(answer.body.error, /lane-a/, 'the refusal names the lane')
  assert.equal(answer.body.lock.locked, true)
})

test('a page claiming a lane name it has no record for is judged as the person', async () => {
  lanes([])
  const answer = await write({ 'x-engine-client': 'lane-a' })
  assert.equal(answer.status, 400, 'the role comes from the registry, so a claim buys nothing')
})

test('a dead lane record holds nothing, so the person may write again', async () => {
  lanes([{ client: 'lane-a', port: 9400, pid: 0 }])
  const answer = await write()
  assert.equal(answer.status, 400, 'a record whose process is gone is not a holder')
})

test('the agent-file route is held by the same rule', async () => {
  lanes([{ client: 'lane-a', port: 9400, pid: LIVE_PID }])
  const answer = await request(api.middleware, {
    method: 'POST',
    url: '/api/agent-file',
    headers: {},
    body: { scope: 'engine', path: 'agents/core.md', text: 'x' }
  })
  assert.equal(answer.status, 423, 'the second write route asks too')
  assert.equal(answer.body.code, 'held')
})

test('reading still answers while a lane works', async () => {
  lanes([{ client: 'lane-a', port: 9400, pid: LIVE_PID }])
  const answer = await request(api.middleware, { url: '/api/file?path=levels/meadow.json' })
  assert.equal(answer.status, 200, 'the lock stops writes, not reads')
  assert.equal(answer.body.text, '{"entities":[]}')
})

// ---- the tab beacon, into mergeClient ----

const registry = serverFor('engine-server-registry')
const announce = (said, socket) => registry.sockets.get('engine:tab')(said, { socket, send: () => {} })
const openSocket = () => ({ readyState: 1, once: () => {} })
const tabs = async () => (await request(registry.middleware, { url: '/api/server' })).body.tabs

test('the server writes the project and checkout it serves, over anything the page says', async () => {
  announce({ id: 'editor', nonce: 'n1', project: 'somebody-else', serves: 'Z:\\elsewhere' }, openSocket())
  const [entry] = await tabs()
  assert.equal(entry.id, 'editor')
  assert.equal(entry.project, 'project')
  assert.equal(entry.serves, CHECKOUT)
})

test('a second page claiming a live name is refused, and the first keeps it', async () => {
  const first = openSocket()
  announce({ id: 'lane-a', nonce: 'first', url: 'http://localhost:5173/?client=lane-a' }, first)
  announce({ id: 'lane-a', nonce: 'impostor', url: 'http://localhost:5173/stolen' }, openSocket())
  const named = (await tabs()).filter(entry => entry.id === 'lane-a')
  assert.equal(named.length, 1, 'one name is one page')
  assert.match(named[0].url, /client=lane-a/, 'the page that had the name still has it')
})

test('a reload waits for its own old socket, then keeps the name', async () => {
  const first = openSocket()
  announce({ id: 'lane-b', nonce: 'same', url: 'http://first' }, first)

  // A reloading page announces before the socket it replaces has closed. The
  // server cannot tell that from a second page copying the nonce, so it refuses
  // and the original keeps the name. The page announces again every few
  // seconds, which is what makes the refusal recoverable rather than fatal.
  announce({ id: 'lane-b', nonce: 'same', url: 'http://reloaded' }, openSocket())
  let named = (await tabs()).filter(entry => entry.id === 'lane-b')
  assert.equal(named.length, 1, 'one name is one page, whoever is asking')
  assert.equal(named[0].url, 'http://first', 'a live page is never evicted by an announcement')

  // Once the old socket has gone the name is free, and the next announcement
  // takes it. This is the reload completing, one retry later.
  first.readyState = 3
  announce({ id: 'lane-b', nonce: 'same', url: 'http://reloaded' }, openSocket())
  named = (await tabs()).filter(entry => entry.id === 'lane-b')
  assert.equal(named.length, 1, 'the closed entry went with the name')
  assert.equal(named[0].url, 'http://reloaded')
})

test('no reply carries the nonce that would take a name', async () => {
  for (const entry of await tabs()) {
    assert.equal('nonce' in entry, false, `${entry.id} would hand out the value that proves it is itself`)
  }
})

// ---- POST /api/engine ----

const bridge = serverFor('engine-bridge')

/** A call to one named page. The short timeout is how a call with no page to
 *  answer it ends, and reaching that end proves the lock let it through. */
const drive = (op, client) => request(bridge.middleware, {
  method: 'POST',
  url: '/api/engine',
  headers: {},
  body: { op, args: [], client, timeout: 20 }
})

test('a page calling itself headless is not a lane, so it may not write', async () => {
  lanes([])
  announce({ id: 'claims-headless', nonce: 'n2', headless: true }, openSocket())
  const answer = await drive('set', 'claims-headless')
  assert.equal(answer.body.code, 'no-reply', 'the role comes from the registry, so the claim changed nothing')
  assert.equal(answer.status, 502)
})

test('a lane is refused a write op even when its page claims to be the editor', async () => {
  lanes([{ client: 'lane-c', port: 9402, pid: LIVE_PID }])
  announce({ id: 'lane-c', nonce: 'n3', headless: false }, openSocket())
  const answer = await drive('set', 'lane-c')
  assert.equal(answer.status, 423)
  assert.match(answer.body.error, /viewer|checkout/, 'the registry says lane, so the page is a viewer')
})

test('the person may not save a level while a lane works, and may still read', async () => {
  lanes([{ client: 'lane-c', port: 9402, pid: LIVE_PID }])
  const held = await drive('saveLevel', 'editor')
  assert.equal(held.status, 423)
  assert.match(held.body.error, /lane-c/)
  const read = await drive('snapshot', 'editor')
  assert.equal(read.body.code, 'no-reply', 'a read op is never held')
})
