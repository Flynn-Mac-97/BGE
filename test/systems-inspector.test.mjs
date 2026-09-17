import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inspectFlow, findNode } from '../plugins/builtin/systems-inspector/model.js'
import inspector from '../plugins/builtin/systems-inspector.js'
import { importPlugin } from '../engine/plugin-import.js'
import { readSource } from '../engine/source-files.mjs'
import { makeBus } from '../engine/bus.js'

function context() {
  return {
    bus: makeBus(), redraw() {}, world: { entities: [] }, editor: { index: { types: {}, behaviours: {} } },
    loader: { contrib: { systems: [] }, plugins: new Map() },
    files: { async readSource() { return { text: 'one\ntwo' } } }
  }
}

test('flow follows registry order, filters phases, and separates plugins from core', async () => {
  const world = context()
  const definition = await importPlugin({ file: 'plugins/builtin/example.js', builtin: true, load: async () => ({ default: { name: 'Example' } }) })
  world.loader.plugins.set('Example', { definition })
  const first = () => 'first', second = () => 'second'
  world.loader.contrib.systems = [
    { plugin: 'Example', phase: 'fixed', run: first },
    { plugin: 'Example', phase: 'frame', run: () => {} },
    { plugin: 'Example', phase: 'fixed', run: second }
  ]
  const model = inspectFlow(world)
  const children = findNode(model, 'systems').children
  assert.deepEqual(children.map(node => node.code), [String(first), String(second)])
  assert.equal(children[0].source.file, 'plugins/builtin/example.js')
  assert.equal(children[0].group, 'Plugins')
  assert.equal(model.nodes[0].group, 'Engine Core')
  assert.equal(findNode(inspectFlow(world, 'frame'), 'systems').children.length, 1)
  world.loader.contrib.systems = []
  assert.equal(findNode(inspectFlow(world), 'systems').children.length, 0)
  assert.throws(() => inspectFlow(world, 'invented'))
})

test('inspector state belongs to one world and reading it never runs systems', async () => {
  const left = context(), right = context()
  inspector.onLoad(left); inspector.onLoad(right)
  let ran = false
  left.loader.contrib.systems = [{ plugin: 'Example', phase: 'fixed', run() { ran = true } }]
  left.systemsInspector.model()
  await left.systemsInspector.open()
  assert.equal(ran, false)
  assert.equal(left.systemsInspector.state.open, true)
  assert.equal(right.systemsInspector.state.open, false)
})

test('a late file read cannot replace a newer source selection', async () => {
  const world = context()
  const pending = []
  world.files.readSource = () => new Promise(resolve => pending.push(resolve))
  inspector.onLoad(world)
  const old = world.systemsInspector.select('world')
  const current = world.systemsInspector.select('loop')
  pending[1]({ text: 'new selection' }); await current
  pending[0]({ text: 'old selection' }); await old
  assert.equal(world.systemsInspector.state.text, 'new selection')
})

test('source reader allows code and rejects traversal, unknown scopes and non-code files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'systems-inspector-'))
  try {
    await fs.mkdir(path.join(root, 'engine'))
    await fs.writeFile(path.join(root, 'engine/example.js'), 'export const value = 1')
    const result = await readSource(root, root, 'engine', 'engine/example.js')
    assert.equal(result.text, 'export const value = 1')
    for (const [scope, file] of [['engine','engine/../secret.js'], ['engine','engine\\example.js'], ['engine','engine/key.json'], ['other','engine/example.js']]) {
      await assert.rejects(readSource(root, root, scope, file))
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
