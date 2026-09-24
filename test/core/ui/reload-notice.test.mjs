/**
 * A reload puts the world back, and says what it could not carry.
 *
 * The reload path is the one place a page hands a live world through storage to
 * the next page. Its promise is exact: what the level does not hold comes back,
 * and whatever could not come back is named rather than dropped in silence. It
 * has no direct test today, only the restore paths `checkpoint.test.mjs` touches,
 * so this drives it through the real boot: capture on the way out of one
 * `startWorldInNode`, restore on the way into the next.
 *
 * Node has no sessionStorage, so the test supplies one. That is the only seam:
 * everything else — the capture, the storage round trip, the restore, the notice
 * — runs as it does in a page.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CHECKOUT, temporaryProject } from '../../fixture-project.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'
import { takeReloadNote } from '../../../engine/reload-notice.js'

/** A game whose entity carries a value written at runtime, and nothing else. */
const PROJECT = {
  'game.json': { title: 'reload', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'walker', at: [1, 2, 0] }] },
  'types/walker.js': `export default {
  properties: { held: 0 },
  update(e, seconds, context) {
    e.properties.held += 1
    e.x += 0.5
  }
}
`
}

/**
 * sessionStorage and the window the reload path reads, as globals.
 *
 * `sessionStore()` asks for both, and `armCapture` adds a `pagehide` listener, so
 * this is the smallest tab the path can run against. It returns what was written
 * so a test can read the capture the page left behind.
 */
function installTab() {
  const items = new Map()
  const listeners = new Map()
  const saved = { window: globalThis.window, sessionStorage: globalThis.sessionStorage }
  globalThis.sessionStorage = {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key)
  }
  globalThis.window = {
    addEventListener: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    }
  }
  return {
    entries: () => [...items.entries()],
    restore() {
      if (saved.window === undefined) delete globalThis.window
      else globalThis.window = saved.window
      if (saved.sessionStorage === undefined) delete globalThis.sessionStorage
      else globalThis.sessionStorage = saved.sessionStorage
    }
  }
}

test('a reload restores the run, holds it still, and says what it lost', async context => {
  const project = await temporaryProject(PROJECT, 'reload-notice-')
  context.after(() => fs.rmSync(project, { recursive: true, force: true }))

  // A headless world has no session, so there is nothing to carry back and
  // nothing is announced. This runs before any capture exists: the notice keeps
  // its last answer for the life of the process, and a page gets a fresh one.
  const headless = await startWorldInNode({ root: CHECKOUT, project, renderer: 'null' })
  assert.equal(headless.engine.reloadNotice(), null)
  assert.equal(takeReloadNote(), null)

  const tab = installTab()
  context.after(() => tab.restore())

  const before = await startWorldInNode({ root: CHECKOUT, project, renderer: 'null' })
  before.loop.step(3)
  const placed = before.world.entities[0]
  const wasAt = { x: placed.x, held: placed.properties.held }
  // An entity the level does not hold, which is the case a plugin keeps its own
  // list of and the reason a restored world is held still rather than run on.
  const made = before.context.spawn('walker', { at: [9, 9, 0] })

  before.bus.emit('reload:before', { file: 'plugins/builtin/walker.js', why: 'vite full reload' })

  const stored = tab.entries()
  assert.equal(stored.length, 1)
  const capture = JSON.parse(stored[0][1])
  assert.equal(capture.entities.length, 2)
  assert.equal(capture.cause.file, 'plugins/builtin/walker.js')
  assert.equal(capture.simulated, true)

  const after = await startWorldInNode({ root: CHECKOUT, project, renderer: 'null' })

  // The level's own entity came back where the run left it, with its live value.
  const restored = after.world.entities.find(entity => entity.id === placed.id)
  assert.equal(restored.x, wasAt.x)
  assert.equal(restored.properties.held, wasAt.held)

  // The entity the run made came back too, under its own id.
  const spawned = after.world.entities.find(entity => entity.id === made.id)
  assert.equal(spawned.y, 9)
  assert.equal(after.world.entities.length, 2)
  assert.equal(after.loop.steps, before.loop.steps)

  const notice = after.engine.reloadNotice()
  assert.equal(notice.key, 'worldWasRestored')
  assert.equal(notice.detail.file, 'plugins/builtin/walker.js')
  assert.equal(notice.detail.restored.lookOnly, true)
  assert.match(notice.sentence, /LOOK at, not to run on/)
  assert.ok(notice.detail.notRestored.some(line => line.includes('lists plugins keep')))
  // Held by name, so every later reading of the world says so, not just the first.
  assert.deepEqual(after.loop.holds, ['restored-world'])

  // The notice is offered once and then stops, so it cannot haunt later replies.
  assert.equal(takeReloadNote(), notice)
  assert.equal(takeReloadNote(), null)
})
