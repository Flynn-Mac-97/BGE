/**
 * A refused write reaches its caller, and nothing says it was saved.
 *
 * The guard already worked — the disk was untouched. What failed was the path
 * between the guard and the person: the rejection went nowhere and the reply
 * read as success. So this drives the real surfaces — `makeFiles`, `makeLog`
 * and `makeInspect` — with a guard that always refuses, and checks every place
 * the answer is read.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeBus } from '../../../engine/bus.js'
import { makeFiles } from '../../../engine/files.js'
import { makeInspect, makeLog } from '../../../engine/inspect.js'

const HELD = '"code.save" is held: 2 lanes are working: alpha, beta.'

/** A transport that records instead of writing, so a leak through is visible. */
const recorder = () => {
  const written = []
  return {
    written,
    async write(path, text) {
      written.push({ path, text })
    },
    async writeAgent(scope, path, text) {
      written.push({ scope, path, text })
    }
  }
}

/**
 * The smallest world the Inspector's `set` and `snapshot` need, plus an editor
 * whose `saveLevel` writes the level the way `start-world.js` does.
 */
const inspector = () => {
  const bus = makeBus()
  const transport = recorder()
  const files = makeFiles(bus, transport)
  const entity = {
    id: 'wall-north-1',
    type: 'wall',
    x: 1,
    y: 2,
    z: 0,
    properties: { height: 3 },
    overrides: [],
    behaviours: []
  }
  const world = {
    entities: [entity],
    types: new Map([['wall', {}]]),
    behaviours: new Map(),
    byId: id => (id === entity.id ? entity : null),
    all: () => [entity]
  }
  const editor = {
    projectDirectory: 'project',
    levelName: 'meadow',
    selection: new Set(),
    saveLevel: () => files.writeJSON('levels/meadow.json', { entities: [entity] })
  }
  const engine = makeInspect({
    world,
    loader: { failures: () => [], plugins: new Map(), contributions: { commands: [], menus: [] } },
    loop: { running: false, time: 0, paused: false, holds: [], random: { seed: 1 } },
    files,
    bus,
    editor,
    view: { x: 0, y: 0, zoom: 32, mode: 'ortho' },
    log: makeLog(bus)
  })
  return { engine, files, transport, entity }
}

/** Let node report an unhandled rejection, which it does at the end of a turn. */
const settle = () => new Promise(resolve => setImmediate(resolve))

test('a guarded write rejects, and the rejection carries the reason', async () => {
  const { files, transport } = inspector()
  files.guardWrites(() => HELD)

  await assert.rejects(
    () => files.write('levels/meadow.json', '{}'),
    error => {
      assert.match(error.message, /levels\/meadow\.json/, 'says which file')
      assert.match(error.message, /2 lanes are working: alpha, beta/, 'says why, naming the lanes')
      return true
    }
  )

  assert.deepEqual(transport.written, [], 'nothing reached disk')
  assert.equal(files.refused.path, 'levels/meadow.json')
  assert.equal(files.refused.why, HELD)
})

test('the Inspector save path rejects instead of leaving an unhandled rejection', async () => {
  const { engine, files, transport } = inspector()
  files.guardWrites(() => HELD)

  const unhandled = []
  const watch = reason => unhandled.push(reason)
  process.on('unhandledRejection', watch)
  try {
    await assert.rejects(() => engine.set('wall-north-1', 'height', 9), /2 lanes are working: alpha, beta/)
    await settle()
  } finally {
    process.off('unhandledRejection', watch)
  }

  assert.deepEqual(unhandled, [], 'the refusal went to the caller, not to the process')
  assert.deepEqual(transport.written, [], 'nothing reached disk')
})

test('nothing announces a save for a write that was refused', async () => {
  const { engine, files } = inspector()
  files.guardWrites(() => HELD)

  await assert.rejects(() => engine.set('wall-north-1', 'height', 9))

  const snapshot = engine.snapshot()
  assert.equal(snapshot.unsaved, true, 'a refused write leaves the level unsaved')
  assert.match(snapshot.refused, /2 lanes are working: alpha, beta/, 'and says why')
  assert.equal(files.pending, 0, 'while nothing is in flight')

  const said = engine.log().map(line => `${line.level} ${line.source} ${line.message}`)
  assert.equal(said.filter(line => /^info files wrote/.test(line)).length, 0, 'no write was announced')
  assert.equal(
    engine.errors().filter(line => line.source === 'rejection').length,
    0,
    'and the refusal is not an unhandled rejection'
  )
  assert.ok(
    engine.errors().some(line => /2 lanes are working/.test(line.message)),
    'the log holds the refusal, with the reason'
  )
})

test('the reply names a save the editor skipped', async () => {
  const { engine } = inspector()
  assert.equal(
    (await engine.set('wall-north-1', 'height', 9)).notSaved,
    undefined,
    'an ordinary save says nothing extra'
  )

  engine.editor.saveLevel = async () => ({ skipped: 'playing' })
  assert.equal((await engine.set('wall-north-1', 'height', 9)).notSaved, 'playing')
})

test('a write that lands clears the refusal', async () => {
  const { engine, files, transport } = inspector()
  const stopRefusing = files.guardWrites(() => HELD)

  await assert.rejects(() => engine.set('wall-north-1', 'height', 9))
  stopRefusing()
  await engine.set('wall-north-1', 'height', 9)

  assert.equal(files.refused, null)
  assert.equal(engine.snapshot().unsaved, false)
  assert.equal(engine.snapshot().refused, undefined)
  assert.equal(transport.written.length, 1)
})

test('a write the server turns away is recorded as unsaved too', async () => {
  const bus = makeBus()
  const files = makeFiles(bus, {
    async write() {
      throw new Error(HELD)
    },
    async writeAgent() {
      throw new Error(HELD)
    }
  })

  await assert.rejects(() => files.write('levels/meadow.json', '{}'), /is held/)
  assert.equal(files.pending, 0)
  assert.match(files.refused.message, /refused to write levels\/meadow\.json/)
})
