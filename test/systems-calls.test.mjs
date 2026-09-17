import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectCalls, relativeSource } from '../plugins/builtin/systems-inspector/calls.js'
import { createCallInspector } from '../plugins/builtin/systems-inspector/call-inspector.js'

test('call inspection resolves lexical scope and excludes shadowed, dynamic and reassigned targets', () => {
  const result = inspectCalls(`
    function step() {}
    function run(step) { step(); service.step(); }
    function outer() { step(); function nested() { step(); } }
    function changed() {}
    changed = replacement; changed();
    // step() is not a call in code
    const text = "step()";
  `)
  assert.equal(result.error, null)
  const step = result.functions.find(item => item.name === 'step')
  assert.equal(result.calls.filter(call => call.target === step.id).length, 2)
  assert.equal(result.calls.find(call => call.name === 'service.step').target, null)
  assert.equal(result.calls.find(call => call.name === 'changed').target, null)
  assert.equal(result.calls.length, 5)
  const nested = result.functions.find(item => item.name === 'nested')
  assert.equal(result.calls.filter(call => call.owner === nested.id).length, 1)
})

test('imports, arrow exports, method bodies and parse errors retain accurate source evidence', () => {
  const result = inspectCalls(`import { makeWorld as create } from './world.js';
export const start = () => create();
const api = { run() { start(); } };
export { start as boot };`)
  const call = result.calls.find(item => item.name === 'create')
  assert.deepEqual(call.imported, { path: './world.js', name: 'makeWorld' })
  assert.equal(call.line, 2)
  assert.equal(result.exports.start, result.exports.boot)
  assert.equal(result.functions.find(item => item.id === result.exports.start).name, 'start')
  assert.equal(result.functions.some(item => item.name === 'run'), true)
  assert.match(inspectCalls('function {').error, /Cannot parse/)
  assert.deepEqual(relativeSource({ scope: 'engine', file: 'engine/start.js' }, './world.js'), { scope: 'engine', file: 'engine/world.js' })
  assert.equal(relativeSource({ scope: 'engine', file: 'engine/start.js' }, '../../secret.js'), null)
  assert.equal(relativeSource({ scope: 'engine', file: 'engine/start.js' }, 'three'), null)
})

test('function navigation follows imports and restores the calling file without executing code', async () => {
  const files = { 'engine/start.js': "import { makeWorld } from './world.js';\nexport function start() { makeWorld() }", 'engine/world.js': 'export function makeWorld() { throw new Error("must not run") }' }
  const state = { generation: 0, line: 2, sourceRef: { scope: 'engine', file: 'engine/start.js' } }
  const inspector = createCallInspector({ files: { async readSource(scope, file) { return { text: files[file] } } } }, state, () => {})
  await inspector.open()
  assert.equal(state.analysis.functions.find(item => item.id === state.callSelection).name, 'start')
  const call = state.analysis.calls[0]
  inspector.site(call.id)
  assert.equal(state.line, 2)
  await inspector.definition(call.id)
  assert.equal(state.file, 'engine/world.js')
  assert.equal(state.analysis.functions.find(item => item.id === state.callSelection).name, 'makeWorld')
  inspector.back()
  assert.equal(state.file, 'engine/start.js')
  assert.equal(state.line, 2)
})

test('property writes do not reassign lexical functions, but export reassignment is unresolved', () => {
  const result = inspectCalls('function step() {} api.step = step; step(); export function changed() {} changed = step;')
  assert.equal(result.calls[0].target, result.functions[0].id)
  assert.equal(result.exports.changed, undefined)
})
