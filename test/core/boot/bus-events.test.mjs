/**
 * The bus events the kernel and its callers rely on.
 *
 * The bus is the only way a change leaves the modules that make it, so a reader
 * subscribes rather than polls. These tests drive the real actions — a spawn, a
 * select, a level load, a failed plugin — and check that the named events are
 * announced. `shell:ready` and `frame:painted` are emitted by the browser entry
 * only, so they are not produced here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBus } from '../../../engine/bus.js'
import { makeLoader } from '../../../engine/loader.js'
import { makeFiles } from '../../../engine/files.js'
import { captureSessionWorld, restoreSessionWorld } from '../../../engine/reload-projection.js'
import { CHECKOUT, FIXTURE } from '../../fixture-project.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'

const NAMES = [
  'plugins:changed',
  'level:loaded',
  'world:changed',
  'world:restored',
  'selection:changed',
  'tool:changed',
  'open:file',
  'plugin:error',
  'files:writing',
  'files:written',
  'files:refused',
  'entity:added',
  'entity:removed',
  'type:changed',
  'behaviour:changed',
  'play:started',
  'play:stopped',
  'context:replaced'
]

/** Boot the fixture and record every named event from now on. */
async function worldWithRecorder() {
  const { context, engine, loader } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  const seen = []
  for (const name of NAMES) context.bus.on(name, () => seen.push(name))
  return { context, engine, loader, seen }
}

test('a spawn, a destroy and a select are announced', async () => {
  const { context, seen } = await worldWithRecorder()
  const entity = context.world.entities[0]

  context.select(entity.id)
  assert.equal(seen.includes('selection:changed'), true)

  const spawned = context.spawn(entity.type, { at: [9, 9, 0] })
  assert.equal(seen.includes('entity:added'), true)
  assert.equal(seen.includes('world:changed'), true)

  context.destroy(spawned)
  assert.equal(seen.includes('entity:removed'), true)
})

test('a tool change, an open and a rebuild are announced', async () => {
  const { context, seen } = await worldWithRecorder()

  context.editor.setTool('select')
  assert.equal(seen.includes('tool:changed'), true)
  assert.equal(seen.includes('plugins:changed'), true)

  context.open('levels/main.json')
  assert.equal(seen.includes('open:file'), true)

  context.loader.rebuild()
  assert.equal(seen.filter(name => name === 'plugins:changed').length >= 2, true)
})

test('a retype and a rebehave are announced', async () => {
  const { context, seen } = await worldWithRecorder()
  const type = context.world.entities[0].type

  context.world.retype(type, {})
  assert.equal(seen.includes('type:changed'), true)

  context.world.rebehave('probe', {})
  assert.equal(seen.includes('behaviour:changed'), true)
})

test('a level load and a restore are announced', async () => {
  const { context, seen } = await worldWithRecorder()

  await context.editor.loadLevel('main')
  assert.equal(seen.includes('level:loaded'), true)

  context.restore(context.capture())
  assert.equal(seen.includes('world:changed'), true)
})

test('a world put back from a reload capture is announced as restored, not merely changed', async () => {
  const { context, seen } = await worldWithRecorder()
  const capture = captureSessionWorld({
    world: context.world,
    loop: context.loop,
    editor: context.editor,
    view: context.view
  })
  await restoreSessionWorld(capture, {
    world: context.world,
    loop: context.loop,
    editor: context.editor,
    view: context.view,
    bus: context.bus,
    context
  })
  assert.equal(seen.includes('world:restored'), true)
  assert.equal(seen.includes('world:changed'), true)
})

test('play mode announces started and stopped', async () => {
  const { context, seen } = await worldWithRecorder()
  const saved = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  }
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  try {
    context.editor.togglePlay()
    context.editor.togglePlay()
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
  assert.equal(seen.includes('play:started'), true)
  assert.equal(seen.includes('play:stopped'), true)
})

test('a plugin that cannot load is announced with its error', async () => {
  const { loader, seen, context } = await worldWithRecorder()
  context.bus.on('plugin:error', payload => seen.push(payload.error))

  assert.throws(() =>
    loader.add({
      name: 'Broken',
      onLoad() {
        throw new Error('boot failure')
      }
    })
  )
  assert.equal(
    seen.some(entry => typeof entry === 'string' && entry.includes('boot failure')),
    true
  )
})

test('a plugin that replaces a context key it did not own is announced', () => {
  const bus = makeBus()
  const loader = makeLoader(bus)
  const context = { bus, loader, world: {} }
  loader.add({
    name: 'Replacer',
    onLoad(value) {
      value.world = {}
    }
  })

  const replaced = []
  bus.on('context:replaced', payload => replaced.push(payload))
  loader.boot(context)

  assert.deepEqual(replaced, [{ key: 'world', by: 'Replacer', from: 'the kernel' }])
})

test('a file write and a refusal are announced with a pending count', async () => {
  const bus = makeBus()
  const events = []
  bus.on('files:writing', payload => events.push(`writing:${payload.pending}`))
  bus.on('files:written', () => events.push('written'))
  bus.on('files:refused', () => events.push('refused'))

  const written = makeFiles(bus, { async write() {} })
  await written.write('levels/main.json', '{}')
  assert.deepEqual(events, ['writing:1', 'written', 'writing:0'], 'a write rises, lands, and settles')

  events.length = 0
  const refused = makeFiles(bus, {
    async write() {
      throw new Error('disk is read-only')
    }
  })
  await assert.rejects(refused.write('levels/main.json', '{}'))
  assert.deepEqual(events, ['writing:1', 'refused', 'writing:0'])
  assert.equal(refused.refused.path, 'levels/main.json')
})
