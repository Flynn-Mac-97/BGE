/**
 * The headless door: what a `--headless` run may write while a lane works.
 *
 * `test/work-lock.test.mjs` proves what `permits` decides, and `vite.config.js`
 * enforces it for the dev server. Neither covers this route — a headless world
 * reaches disk through the node file transport and passes no server door — so
 * this spawns the real CLI against a checkout whose lock registry the test
 * writes, and reads the exit code and the disk.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const CLI = path.join(REPO, 'bin/engine.mjs')

/**
 * A checkout of its own, holding a lock registry the test controls.
 *
 * The repository's own registry records live lanes, so a test that wrote it
 * would change what other runs are told.
 *
 * One builtin plugin, re-exported from the shipped file so the write under test
 * is the real one. Nothing else is needed; the world starts with no other.
 */
function checkout(t, runs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-node-write-guard-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const coordination = path.join(root, 'project/.engine')
  fs.mkdirSync(coordination, { recursive: true })
  fs.writeFileSync(path.join(coordination, 'agents.json'), JSON.stringify({ runs }))
  fs.writeFileSync(path.join(coordination, 'lane-browsers.json'), JSON.stringify({ browsers: [] }))

  fs.mkdirSync(path.join(root, 'game'), { recursive: true })
  fs.writeFileSync(path.join(root, 'game/game.json'), JSON.stringify({ title: 'write guard' }))

  fs.mkdirSync(path.join(root, 'plugins/builtin'), { recursive: true })
  const real = pathToFileURL(path.join(REPO, 'plugins/builtin/new-file.js')).href
  fs.writeFileSync(path.join(root, 'plugins/builtin/new-file.js'), `export { default } from ${JSON.stringify(real)}\n`)

  fs.mkdirSync(path.join(root, 'game/plugins'), { recursive: true })
  fs.writeFileSync(path.join(root, 'game/plugins/ignores-refusal.js'), IGNORES_REFUSAL)

  return root
}

/** A command that never sees the refusal. The run must still fail. */
const IGNORES_REFUSAL = `export default {
  name: 'Ignores Refusal',
  commands: [{
    id: 'probe.writeIgnoringRefusal',
    label: 'write a file without waiting for it',
    run: context => {
      context.files.write('types/x.js', 'ignored').catch(() => {})
      return { ok: true }
    }
  }]
}
`

const working = [{ id: 'lane-a', status: 'active', files: ['engine/render.js'], startedAt: '2026-08-31T00:00:00Z' }]

const headless = (root, ...args) => {
  const run = spawnSync(process.execPath, [CLI, '--headless', '--root', root, '--project', 'game', ...args], {
    cwd: REPO, encoding: 'utf8'
  })
  return { code: run.status, out: run.stdout, error: run.stderr }
}

const wrote = root => fs.existsSync(path.join(root, 'game/types/x.js'))

test('a locked checkout refuses a headless write and exits 1', t => {
  const root = checkout(t, working)
  const run = headless(root, 'run', 'new.file', '["type","x"]')

  assert.equal(run.code, 1, `exit code — stdout was ${run.out}`)
  assert.match(run.error, /refused to write types\/x\.js/)
  assert.match(run.error, /lane-a/, 'the refusal names the lanes holding the lock')
  assert.equal(wrote(root), false, 'nothing may land on disk')
})

test('the same write lands and exits 0 when no lane is working', t => {
  const root = checkout(t)
  const run = headless(root, 'run', 'new.file', '["type","x"]')

  assert.equal(run.code, 0, `exit code — stderr was ${run.error}`)
  assert.deepEqual(JSON.parse(run.out), { created: 'types/x.js' })
  assert.equal(wrote(root), true)
})

test('a command that ignores the refusal still fails the run', t => {
  const root = checkout(t, working)
  const run = headless(root, 'run', 'probe.writeIgnoringRefusal')

  assert.equal(run.code, 1, `exit code — stdout was ${run.out}`)
  assert.match(run.error, /refused to write types\/x\.js/)
  assert.equal(wrote(root), false)
})

test('a locked checkout still simulates and answers', t => {
  const root = checkout(t, working)

  const played = headless(root, 'simulate', '1')
  assert.equal(played.code, 0, `simulate must run while locked — ${played.error}`)
  assert.equal(JSON.parse(played.out).time, 1)

  const asked = headless(root, 'snapshot')
  assert.equal(asked.code, 0, `snapshot must answer while locked — ${asked.error}`)
})
