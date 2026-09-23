/**
 * The plugin contract: the order plugins load in, the resources a scope owns,
 * and the failures the loader contains.
 *
 * A plugin author writes against this and nothing else, so every claim here is
 * about what a plugin can observe: its onLoad order, the service it requires,
 * the cleanup it registered, and what happens when one of them is wrong. The
 * loader is driven through its own interface — `add`, `order`, `boot`, `enable`
 * — and through a real headless world, never through a plugin file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLoader } from '../../../engine/loader.js'
import { makeBus } from '../../../engine/bus.js'
import { makeInspect } from '../../../engine/inspect.js'
import { CHECKOUT, FIXTURE } from '../../fixture-project.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'

/** A loader with definitions registered, and booted unless the test says otherwise. */
function makePluginLoader(definitions, { boot = true } = {}) {
  const bus = makeBus()
  const loader = makeLoader(bus)
  const context = { bus, loader }
  for (const definition of definitions) loader.add(definition)
  if (boot) loader.boot(context)
  return { bus, loader, context }
}

test('the loader collects exactly the seven contribution points', () => {
  const { loader } = makePluginLoader([])
  assert.deepEqual(Object.keys(loader.contrib).sort(), [
    'commands',
    'fields',
    'importers',
    'menus',
    'panels',
    'systems',
    'tools'
  ])
})

test('a provider initializes before its consumer, whatever order they were registered', () => {
  const calls = []
  makePluginLoader([
    {
      name: 'Consumer',
      lifecycle: 'scoped',
      requires: ['clock'],
      onLoad(context, scope) {
        calls.push(scope.require('clock').value)
      }
    },
    {
      name: 'Provider',
      lifecycle: 'scoped',
      provides: ['clock'],
      onLoad(context, scope) {
        calls.push('provider')
        scope.provide('clock', { value: 42 })
      }
    }
  ])
  assert.deepEqual(calls, ['provider', 42], 'the provider loaded first and the consumer reached it by name')
})

test('a plugin reaches only the services it declared, and one that is missing is contained', () => {
  const reported = []
  const bus = makeBus()
  bus.on('plugin:error', payload => reported.push(payload))
  const loader = makeLoader(bus)
  for (const definition of [
    {
      name: 'Provider',
      lifecycle: 'scoped',
      provides: ['clock'],
      onLoad(context, scope) {
        scope.provide('clock', { value: 1 })
      }
    },
    {
      name: 'Undeclared',
      lifecycle: 'scoped',
      onLoad(context, scope) {
        scope.require('clock')
      }
    }
  ])
    loader.add(definition)
  loader.boot({ bus, loader })

  assert.match(reported.map(row => row.error).join(' '), /Undeclared: undeclared requirement clock/)
  assert.equal(loader.contracts().plugins.find(plugin => plugin.name === 'Undeclared').active, false)
})

test('a scope cleans up in reverse registration order, and a failing cleanup does not stop the rest', () => {
  const cleaned = []
  const reported = []
  const bus = makeBus()
  bus.on('plugin:error', payload => reported.push(payload.error))
  const loader = makeLoader(bus)
  loader.add({
    name: 'Owned',
    lifecycle: 'scoped',
    onLoad(context, scope) {
      scope.defer(() => cleaned.push('first'))
      scope.defer(() => {
        throw new Error('cleanup failure')
      })
      scope.defer(() => cleaned.push('last'))
    }
  })
  loader.boot({ bus, loader })
  loader.enable('Owned', false)

  assert.deepEqual(cleaned, ['last', 'first'], 'the most recently registered cleanup ran first')
  assert.match(reported.join(' '), /cleanup: cleanup failure/)
})

test('disabling a provider disables its dependents first, and re-enabling goes providers first', () => {
  const disposed = []
  const loaded = []
  const { loader } = makePluginLoader([
    {
      name: 'Provider',
      lifecycle: 'scoped',
      provides: ['clock'],
      onLoad(context, scope) {
        loaded.push('provider')
        scope.provide('clock', {})
        scope.defer(() => disposed.push('provider'))
      }
    },
    {
      name: 'Consumer',
      lifecycle: 'scoped',
      requires: ['clock'],
      onLoad(context, scope) {
        loaded.push('consumer')
        scope.require('clock')
        scope.defer(() => disposed.push('consumer'))
      }
    }
  ])

  assert.deepEqual(loaded, ['provider', 'consumer'])
  loader.enable('Provider', false)
  assert.deepEqual(disposed, ['consumer', 'provider'], 'the dependent let go before the service it used')
  assert.throws(() => loader.enable('Consumer', true), /dependency unavailable/)

  loader.enable('Provider', true)
  loader.enable('Consumer', true)
  assert.deepEqual(loaded, ['provider', 'consumer', 'provider', 'consumer'], 'both loaded again, providers first')
})

test('the plugin graph is refused before anything loads when a name or an edge is wrong', () => {
  const { loader } = makePluginLoader([])

  assert.throws(() => loader.order([{ name: 'Missing', needs: ['Absent'] }]), /missing plugin dependency: Absent/)
  assert.throws(() => loader.order([{ name: 'Missing', requires: ['absent'] }]), /missing service provider: absent/)
  assert.throws(
    () =>
      loader.order([
        { name: 'A', provides: ['x'] },
        { name: 'B', provides: ['x'] }
      ]),
    /declared by both/
  )
  assert.throws(
    () =>
      loader.order([
        { name: 'A', needs: ['B'] },
        { name: 'B', needs: ['A'] }
      ]),
    /cycle/
  )
  assert.throws(() => loader.order([{ name: 'A' }, { name: 'A' }]), /duplicate plugin/)

  loader.add({ name: 'One' })
  assert.throws(() => loader.add({ name: 'One' }), /duplicate plugin/)
})

for (const [why, systems] of [
  [
    'a repeated system id',
    [
      { id: 'a', phase: 'fixed' },
      { id: 'a', phase: 'frame' }
    ]
  ],
  ['a missing after target', [{ id: 'a', phase: 'fixed', after: ['missing'] }]],
  ['a missing before target', [{ id: 'a', phase: 'fixed', before: ['missing'] }]],
  [
    'a cycle',
    [
      { id: 'a', phase: 'fixed', after: ['b'] },
      { id: 'b', phase: 'fixed', after: ['a'] }
    ]
  ],
  [
    'a constraint across phases',
    [
      { id: 'a', phase: 'fixed', after: ['b'] },
      { id: 'b', phase: 'frame' }
    ]
  ],
  ['an unknown phase', [{ id: 'a', phase: 'whenever' }]]
]) {
  test(`an invalid schedule fails closed and names the reason: ${why}`, () => {
    let ran = 0
    const { loader } = makePluginLoader([
      { name: 'Bad', systems: systems.map(system => ({ ...system, run: () => ran++ })) }
    ])
    assert.deepEqual(loader.schedule, { fixed: [], frame: [] }, 'no stale schedule survives the failure')
    assert.equal(typeof loader.contracts().scheduleError, 'string')
    assert.equal(ran, 0)
  })
}

test('a schedule failure still leaves a diagnostic command usable', async () => {
  const { bus, loader, context } = makePluginLoader([
    { name: 'Diagnostics', commands: [{ id: 'contracts.report', label: 'Contracts', run: () => ({ ok: true }) }] },
    { name: 'Bad', systems: [{ id: 'a', phase: 'fixed', after: ['missing'], run() {} }] }
  ])
  assert.match(loader.contracts().scheduleError, /missing/)

  const engine = makeInspect({ world: {}, loader, bus, editor: { context }, log: { lines: [], push() {} }, loop: {} })
  assert.deepEqual(await engine.run('contracts.report', {}), { ok: true })
})

test('a bad argument is refused at the engine.run boundary before the handler runs', async () => {
  let calls = 0
  const probe = {
    id: 'probe.count',
    label: 'Probe',
    inputSchema: {
      type: 'object',
      required: ['count'],
      properties: { count: { type: 'integer', minimum: 1 } },
      additionalProperties: false
    },
    run() {
      calls++
      return { ok: true }
    }
  }
  const { bus, loader, context } = makePluginLoader([{ name: 'Probe', commands: [probe] }])
  const engine = makeInspect({ world: {}, loader, bus, editor: { context }, log: { lines: [], push() {} }, loop: {} })

  await assert.rejects(engine.run('probe.count', { count: 'bad' }), /expected integer/)
  await assert.rejects(engine.run('probe.count', { count: 2, typo: true }), /unknown argument/)
  assert.equal(calls, 0, 'the handler never saw a bad argument')

  await engine.run('probe.count', { count: 2 })
  assert.equal(calls, 1)
})

test('a fixed step runs its systems in dependency order, then the frame systems', async () => {
  const calls = []
  const { loop, loader } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  loader.add({
    name: 'Probe Systems',
    systems: [
      { id: 'probe.consume', phase: 'fixed', after: ['probe.produce'], run: () => calls.push('consume') },
      { id: 'probe.produce', phase: 'fixed', run: () => calls.push('produce') },
      { id: 'probe.frame', phase: 'frame', run: () => calls.push('frame') }
    ]
  })

  loop.step(1)
  assert.deepEqual(calls, ['produce', 'consume', 'frame'], 'fixed order first, frame phase after')
})

test('a system that throws is contained, and its dependents are skipped in the same tick', async () => {
  const calls = []
  const reported = []
  const { bus, loop, loader } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  bus.on('plugin:error', payload => reported.push(payload.error))
  loader.add({
    name: 'Failing Systems',
    systems: [
      {
        id: 'probe.fail',
        phase: 'fixed',
        run() {
          calls.push('first')
          throw new Error('intentional test failure')
        }
      },
      {
        id: 'probe.after',
        phase: 'fixed',
        after: ['probe.fail'],
        run() {
          calls.push('must not run')
        }
      }
    ]
  })

  loop.step(1)
  loop.step(1)

  assert.deepEqual(calls, ['first'], 'the failure took the plugin and its dependents out for good')
  assert.match(reported.join(' '), /intentional test failure/)
})
