/**
 * Watch /api/server and /api/lane-frame answer, out of the real vite.config.js.
 *
 * Scratch proof, not a suite: no dev server and no browser. `ROOT` is
 * process.cwd() when the config loads, so this moves to a throwaway checkout
 * first.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

const CHECKOUT = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-routes-'))
const SEE = path.join(CHECKOUT, 'agent-runs/see')
fs.mkdirSync(path.join(CHECKOUT, 'project/.engine'), { recursive: true })
fs.mkdirSync(SEE, { recursive: true })

const LANES = [
  { client: 'lane-a', port: 9400, pid: 4242, url: 'http://localhost:5180/?client=lane-a' },
  { client: 'lane-b', port: 9401, pid: 4243 }
]
fs.writeFileSync(path.join(CHECKOUT, 'project/.engine/lane-browsers.json'),
  JSON.stringify({ version: 1, browsers: LANES }))

const frame = (name, text, when) => {
  const file = path.join(SEE, name)
  fs.writeFileSync(file, text)
  fs.utimesSync(file, when, when)
}
frame('2026-08-31-lane-a-old.png', 'OLD', new Date('2026-08-31T09:00:00Z'))
frame('2026-08-31-lane-a-new.png', 'NEW', new Date('2026-08-31T11:00:00Z'))
frame('2026-08-31-lane-a-newest.json', 'NOT A FRAME', new Date('2026-08-31T12:00:00Z'))
fs.writeFileSync(path.join(CHECKOUT, 'agent-runs/outside.png'), 'OUTSIDE')

const CONFIG = pathToFileURL(path.join(process.cwd(), 'vite.config.js')).href
const here = process.cwd()
process.chdir(CHECKOUT)
const config = (await import(CONFIG)).default
process.chdir(here)

const middleware = []
config.plugins.find(plugin => plugin?.name === 'engine-server-registry').configureServer({
  middlewares: { use: handler => middleware.push(handler) },
  ws: { on: () => {}, send: () => {} },
  watcher: { on: () => {} },
  config: { server: { port: 5173 } }
})

async function request(url) {
  const incoming = Object.assign(Readable.from([]), { method: 'GET', url, headers: {} })
  let answer = null
  const headers = {}
  const response = {
    statusCode: 200,
    setHeader: (key, value) => { headers[key] = value },
    end: body => { answer = { status: response.statusCode, headers, body } }
  }
  for (const handler of middleware) {
    let passed = false
    await handler(incoming, response, () => { passed = true })
    if (!passed) break
  }
  return answer
}

const server = JSON.parse((await request('/api/server')).body)
assert.deepEqual(server.lanes, LANES, '/api/server carries the raw lane records')
console.log('lanes:', server.lanes.map(lane => `${lane.client}:${lane.port}`).join(' '))

const newest = await request('/api/lane-frame?client=lane-a')
assert.equal(newest.status, 200)
assert.equal(newest.headers['content-type'], 'image/png')
assert.equal(String(newest.body), 'NEW', 'the newest .png, not the newest file')
console.log('lane-frame lane-a:', newest.headers['x-engine-frame'])

for (const asked of ['lane-z', '', '../outside', '..%2Foutside', 'outside']) {
  const refused = await request(`/api/lane-frame?client=${encodeURIComponent(asked)}`)
  assert.equal(refused.status, 404, `"${asked}" was answered with ${refused.status}`)
  console.log(`lane-frame ${JSON.stringify(asked)}: 404 ${JSON.parse(refused.body).error}`)
}

fs.rmSync(CHECKOUT, { recursive: true, force: true })
console.log('OK')
