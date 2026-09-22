/**
 * `context` — the one object every plugin and every hook receives.
 *
 * Its key list is a contract: game code and agents read these names, so a rename
 * breaks callers, not just code. `time` and `selection` are getters and must
 * stay enumerable, because the shell hands panels `{ ...context, state }` and a
 * non-enumerable key would be dropped by the spread. `renderer` and `shell` are
 * absent when nothing is drawing, which is the honest answer rather than a stub.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHECKOUT, FIXTURE } from '../fixture-project.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

/** The kernel's keys. `input camera play audio hud` are contributed by plugins. */
const KERNEL_KEYS = [
  'world', 'loop', 'bus', 'files', 'editor', 'loader', 'view', 'viewport',
  'device', 'host', 'startup', 'checkpoints', 'capture', 'restore', 'rewind',
  'spawn', 'destroy', 'select', 'open', 'run', 'save', 'redraw',
  'importProjectFile', 'assets', 'types', 'behaviours', 'levels', 'level',
  'selection', 'time', 'random', 'drawing', 'after', 'every', 'cancel',
  'projector', 'engine'
]

test('every kernel key is on a world context', async () => {
  const { context } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  for (const key of KERNEL_KEYS) assert.ok(key in context, `context.${key} is missing`)
})

test('time and selection are enumerable getters, so a spread keeps them', async () => {
  const { context } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  for (const key of ['time', 'selection']) {
    const descriptor = Object.getOwnPropertyDescriptor(context, key)
    assert.equal(typeof descriptor?.get, 'function', `context.${key} must be a getter`)
    assert.equal(descriptor.enumerable, true, `context.${key} must survive a spread`)
  }

  const spread = { ...context }
  assert.equal('time' in spread, true)
  assert.equal('selection' in spread, true)
})

test('time reads the clock at the moment it is asked, not the moment context was built', async () => {
  const { context, loop } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  const before = context.time
  loop.step(30)
  assert.notEqual(context.time, before, 'a copied number would have gone stale')
  assert.equal(context.time, loop.time)
})

test('a plugin added after boot receives the same context object the world was built with', async () => {
  const { context, loader } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  let given = null
  loader.add({ name: 'Context Probe', onLoad(value) { given = value } })
  assert.equal(given, context)
  assert.equal(context.engine.editor.context, context)
})
