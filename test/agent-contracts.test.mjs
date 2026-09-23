/**
 * The Agent Contracts plugin: the paginated report of what the loader holds.
 *
 * This is the plugin's own test. The kernel's `engine.run` argument boundary is
 * covered in `test/core/plugin/plugin-contracts.test.mjs`; here the claim is the
 * plugin's — a page has a total, an offset and a next offset, and the contracts
 * report names the scoped plugin that owns a service.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLoader } from '../engine/loader.js'
import { makeBus } from '../engine/bus.js'
import { makeInspect } from '../engine/inspect.js'
import contracts from '../plugins/builtin/agent-contracts.js'

/** An engine whose loader carries the plugin and a probe command list. */
function engineWith(commands) {
  const bus = makeBus()
  const loader = makeLoader(bus)
  const context = { bus, loader }
  loader.add(contracts)
  loader.add({ name: 'Probe', commands })
  loader.boot(context)
  return makeInspect({ world: {}, loader, bus, editor: { context }, log: { lines: [], push() {} }, loop: {} })
}

test('agent.commands pages the command list and says whether each argument set is checked', async () => {
  const commands = Array.from({ length: 60 }, (_, index) => ({
    id: `probe.${index}`, label: 'Probe', inputSchema: { type: 'object' }, run: () => ({ ok: true })
  }))
  const engine = engineWith(commands)

  const page = await engine.run('agent.commands', { query: 'probe.', limit: 5 })
  assert.equal(page.items.length, 5)
  assert.equal(page.total, 60)
  assert.equal(page.nextOffset, 5)
  assert.equal(page.items[0].validation, 'validated')

  const second = await engine.run('agent.commands', { query: 'probe.', limit: 5, offset: 5 })
  assert.equal(second.items[0].id, 'probe.5')

  await assert.rejects(engine.run('agent.commands', { limit: 500 }), /outside allowed range/)
  assert.ok(JSON.stringify(page).length < JSON.stringify(engine.commands()).length)
})

test('agent.contracts names the scoped plugin and the service it owns', async () => {
  const report = await engineWith([]).run('agent.contracts', {})
  assert.equal(report.items.some(item => item.name === 'Agent Contracts'), true)
  assert.equal(
    report.services.some(service => service.name === 'agent.contracts' && service.owner === 'Agent Contracts'),
    true)
  assert.ok(report.coverage.scoped >= 1)
})
