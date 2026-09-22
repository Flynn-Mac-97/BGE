import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startSupervisor, askSupervisor, registerManaged, finishManaged } from '../engine/supervisor.mjs'
import { createTerminals } from '../electron/terminals.mjs'
import { startDesktopServer } from '../engine/desktop-server.mjs'

async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-desktop-'))
  context.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

test('managed instances use the CLI list and stop callback without killing their host', async context => {
  const root = await fixture(context)
  const supervisor = await startSupervisor(root, { port: 0 })
  context.after(() => supervisor.close())
  let stopped = false
  const entry = registerManaged(supervisor, { kind: 'engine-view', pid: process.pid }, async () => {
    stopped = true
    finishManaged(supervisor, entry)
  })
  const before = await askSupervisor(root, 'GET', '/instances')
  assert.equal(before.instances[0].id, entry.id)
  await askSupervisor(root, 'DELETE', `/instances/${entry.id}`)
  assert.equal(stopped, true)
  assert.deepEqual((await askSupervisor(root, 'GET', '/instances')).instances, [])
})

test('terminal output is bounded, sessions retain exits, and input targets one process', async context => {
  const root = await fixture(context)
  const supervisor = await startSupervisor(root, { port: 0 })
  context.after(() => supervisor.close())
  const processes = []
  const terminals = createTerminals(supervisor, { spawn(command, args, options) {
    const process = { pid: 123, input: [], onData(callback) { this.output = callback }, onExit(callback) { this.exit = callback }, write(text) { this.input.push(text) }, resize() {}, kill() { this.exit({ exitCode: 0 }) }, options }
    processes.push(process)
    return process
  } })
  const project = path.join(root, 'game')
  await fs.mkdir(project)
  const first = terminals.start({ cwd: root, project, client: 'view-a', port: 1234 })
  const second = terminals.start({ cwd: root })
  assert.equal(processes[0].options.env.ENGINE_CLIENT, 'view-a')
  assert.equal(processes[0].options.cwd, root)
  assert.equal(processes[0].options.env.ENGINE_PROJECT, project)
  assert.equal(processes[1].options.env.ENGINE_PROJECT, root)
  terminals.write(second.id, 'echo hello\r')
  assert.deepEqual(processes[0].input, [])
  assert.deepEqual(processes[1].input, ['echo hello\r'])
  processes[0].output('x'.repeat(2 * 1024 * 1024))
  const output = terminals.read(first.id)
  assert.equal(output.truncated, true)
  assert.equal(output.text.length, 65536)
  assert.throws(() => terminals.resize(first.id, -1, 20), /size/)
  assert.throws(() => terminals.start({ provider: 'unknown', cwd: root }), /provider/)
  await terminals.stop(first.id)
  assert.equal(terminals.list()[0].exitCode, 0)
  assert.equal(supervisor.instances.length, 1)
  await terminals.close()
})

test('packaged backend serves files, refuses traversal and cross-origin writes, and closes', async context => {
  const root = await fixture(context)
  await fs.mkdir(path.join(root, 'dist'))
  await fs.writeFile(path.join(root, 'dist/index.html'), '<title>Built editor</title>')
  await fs.writeFile(path.join(root, 'private.txt'), 'not a public asset')
  const server = await startDesktopServer({ root, project: path.join(root, 'project') })
  context.after(() => server.close())
  assert.match(await (await fetch(server.url)).text(), /Built editor/)
  assert.equal((await fetch(new URL('private.txt', server.url))).status, 404)
  const project = await (await fetch(new URL('api/project', server.url))).json()
  assert.equal(project.directory, path.join(root, 'project'))
  const role = await (await fetch(new URL('api/client-role?client=engine-view-2', server.url))).json()
  assert.equal(role.role, 'person')
  const blocked = await fetch(new URL('api/file', server.url), {
    method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}'
  })
  assert.equal(blocked.status, 403)
  const written = await fetch(new URL('api/file', server.url), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'note.txt', text: 'hello' })
  })
  assert.equal(written.status, 200)
  assert.equal(await (await fetch(new URL('project/note.txt', server.url))).text(), 'hello')
})


test('desktop capture route uses only the capture callback and refuses missing hosts', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-capture-'))
  let plain
  const calls = []
  const server = await startDesktopServer({ root, project: path.join(root, 'project'), desktopCapture: async options => {
    calls.push(options)
    return { scope: options.scope, size: [800, 600] }
  } })
  context.after(async () => { await server.close(); await plain?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }) })
  const response = await fetch(new URL('api/desktop/capture?scope=window&client=engine-view-2&name=proof', server.url))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { scope: 'window', size: [800, 600] })
  assert.deepEqual(calls, [{ scope: 'window', client: 'engine-view-2', name: 'proof' }])
  const blocked = await fetch(new URL('api/desktop/capture', server.url), { headers: { origin: 'https://example.com' } })
  assert.equal(blocked.status, 403)
  assert.equal(calls.length, 1)
  plain = await startDesktopServer({ root, project: path.join(root, 'project') })
  assert.equal((await fetch(new URL('api/desktop/capture', plain.url))).status, 404)
})
