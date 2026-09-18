/**
 * The interface block a plugin guide arrives with.
 *
 * A packet prints what the source declares above the guide prose, parsed as the
 * packet is built. That is the reason a guide no longer lists commands: a list
 * in prose is a second copy of the code, and the copy is the one that goes
 * stale. Pickups proved it — the guide promised four payload keys on
 * `pickup:latched` while the code sent two.
 *
 * The block is built by the plugin that owns the parser, and the packet builder
 * takes it as an injected reader, so these tests run without wasm: what is
 * proved here is the shape of the block and where the packet puts it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { CHECKOUT, FIXTURE, temporaryProject } from './fixture-project.mjs'
import { startWorldInNode, onDisk } from '../engine/start-world-node.mjs'
import { contextFromDisk } from '../engine/agent-workspace-node.mjs'
import { makeSourceReader } from '../plugins/builtin/plugin-master/source-facts.js'

import { resolveAgentContext } from '../engine/agent-workspace.js'
import { interfaceBlock } from '../plugins/builtin/plugin-master/interface-block.js'

const FACTS = {
  name: 'Pickups',
  category: 'game',
  about: null,
  lifecycle: 'legacy',
  contributes: { commands: 2 },
  commands: [
    { id: 'pickups.list', label: 'What is waiting to be picked up', key: null, refusesWithoutHost: false },
    { id: 'pickups.attract', label: 'Pull every pickup in now', key: 'ctrl+a', refusesWithoutHost: true }
  ],
  provides: [],
  systems: ['fixed'],
  context: ['pickups'],
  listens: ['level:loaded'],
  emits: [{ event: 'pickup:latched', payloadKeys: ['entity', 'collector'] }]
}

const GUIDE = {
  id: 'plugin-engine-pickups', title: 'Pickups', kind: 'instruction',
  scope: 'engine', file: 'plugins/builtin/pickups.agent.md',
  source: 'plugins/builtin/pickups.js', match: ['plugins/builtin/pickups.js'],
  triggers: ['pickups'], enabled: true
}

/** The smallest read the packet builder needs: a manifest and one guide. */
const read = async (scope, file) => {
  if (file === 'agents/manifest.json') return scope === 'engine' ? '{"nodes":[]}' : '{"nodes":[]}'
  if (file === GUIDE.file) return '# Pickups\n\nprose only\n'
  throw new Error(`missing ${scope}:${file}`)
}

const packetFor = (interfaceText) =>
  resolveAgentContext(read, { task: 'pickups', files: ['plugins/builtin/pickups.js'] },
    [GUIDE], 'project', interfaceText)

test('the block lists what the source declares, in one fixed order', () => {
  const block = interfaceBlock(FACTS, { file: GUIDE.source, lines: 209 })
  const rows = block.split('\n').filter(line => line.startsWith('  ')).map(line => line.trim().split(/\s+/)[0])
  // The second command sits under the first, so it reads as the continuation of
  // `commands` and not as a row label of its own.
  assert.deepEqual(rows,
    ['plugin', 'category', 'commands', 'pickups.attract', 'context', 'systems', 'listens', 'emits', 'source'])
  assert.match(block, /pickups\.attract \(Pull every pickup in now, \[ctrl\+a\], refuses without a host\)/)
  assert.match(block, /pickup:latched \{entity, collector\}/)
  assert.match(block, /209 lines/)
})

test('an absent row is left out rather than printed empty', () => {
  const block = interfaceBlock({ name: 'Hot', category: 'engine', lifecycle: 'legacy' }, { file: 'plugins/builtin/hot.js' })
  assert.doesNotMatch(block, /listens/, 'nothing listening is not a blank listens row')
  assert.doesNotMatch(block, /lifecycle/, 'legacy is what a plugin that says nothing gets')
  assert.match(block, /plugin\s+Hot/)
  // A plugin that declares nothing at all still gets a line: an empty block
  // would read as "not measured", and this block is measured.
  assert.match(interfaceBlock({}, { file: 'plugins/builtin/x.js' }), /declared\s+no contribution point/)
})

test('the parsed interface is printed above the guide prose', async () => {
  const asked = []
  const packet = await packetFor(async (scope, file) => {
    asked.push(`${scope}:${file}`)
    return interfaceBlock(FACTS, { file, lines: 209 })
  })

  assert.deepEqual(asked, [`engine:${GUIDE.source}`], 'the reader is asked for the plugin, once')
  const block = packet.text.indexOf('parsed from source')
  const prose = packet.text.indexOf('prose only')
  assert.ok(block > 0 && block < prose, 'the block comes first, so the lookup is above the reading')
  assert.ok(packet.nodes.some(node => node.id === GUIDE.id), 'the guide is still the node that carried it')
})

test('an unavailable interface tells the agent to read source', async () => {
  const packet = await packetFor(null)
  assert.doesNotMatch(packet.text, /parsed from source/)
  assert.match(packet.text, /prose only/)
  assert.match(packet.text, /Interface unavailable.*plugins\/builtin\/pickups.js/)
})

test('every builtin plugin packet carries its live commands and work instructions', async () => {
  const { context } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  const nodes = await context.files.agentPlugins()
  const sourceReader = await makeSourceReader()
  for (const node of nodes.filter(node => node.scope === 'engine' && node.source && node.enabled)) {
    const request = { files: [node.source] }
    const packet = await context.agents.context(request)
    assert.doesNotMatch(packet.text, /Interface unavailable/, node.source)
    for (const rule of ['Shared Rules', 'Code Style', 'Comment Style', 'Plugin Master', 'Required checks', 'Not included']) {
      assert.ok(packet.text.includes(rule), `${node.source}: ${rule}`)
    }
    const source = await fs.readFile(path.join(CHECKOUT, node.source), 'utf8')
    const facts = await sourceReader.facts(node.source, source)
    assert.ok(facts?.name, node.source)
    const definition = context.loader.plugins.get(facts.name)?.definition
    assert.ok(definition, `${node.source}: loaded definition`)
    assert.deepEqual(facts.commands.map(command => command.id), (definition.commands || []).map(command => command.id), node.source)
    assert.deepEqual(facts.menus.map(command => command.id), (definition.menus || []).map(command => command.id), node.source)
    for (const command of [...(definition.commands || []), ...(definition.menus || [])]) {
      assert.ok(packet.text.includes(command.id), `${node.source}: ${command.id}`)
      assert.ok(packet.text.includes(`arguments`) && packet.text.includes(`${command.id}:`), `${command.id}: arguments`)
    }
    const guide = await context.files.readAgent(node.scope, node.file)
    for (const link of guide.matchAll(/`(plugins\/[^`]+\.agent\/[^`]+\.md)`/g)) {
      assert.ok((await context.files.readAgent(node.scope, link[1])).length, link[1])
    }
    const stored = await context.files.readAgent(node.scope, node.source.replace(/\.js$/, '.agent/interface.generated.md'))
    assert.ok(packet.text.includes(stored.trim()), `${node.source}: stored interface`)
  }
  const request = { files: ['plugins/builtin/rapier-2d.js'] }
  const live = await context.engine.run('agent.context', request)
  const offline = await contextFromDisk(CHECKOUT, request, FIXTURE)
  assert.equal(live.text, offline.text)
  const cli = JSON.parse(execFileSync(process.execPath, ['bin/engine.mjs', '--project', FIXTURE, 'agent.context', JSON.stringify(request)], { cwd: CHECKOUT, encoding: 'utf8' }))
  assert.equal(cli.text, live.text)
})

test('stored interfaces refresh after source edits and reuse unchanged files', async () => {
  const source = "export default { name: 'Packet Example', commands: [{ id: 'example.run', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'number' } } }, run(context, options = {}) {} }] }"
  const project = await temporaryProject({
    'plugins/example.js': source,
    'plugins/example.agent.md': '# Packet Example\n\nUse for the example.\n'
  }, 'packet-interface-')
  try {
    const transport = onDisk(project, CHECKOUT)
    const first = await transport.agentInterface('project', 'plugins/example.js')
    assert.match(first, /options = \{\}/)
    assert.match(first, /required: \['value'\]/)
    const file = path.join(project, 'plugins/example.agent/interface.generated.md')
    const before = (await fs.stat(file)).mtimeMs
    assert.equal(await transport.agentInterface('project', 'plugins/example.js'), first)
    assert.equal((await fs.stat(file)).mtimeMs, before)
    await fs.writeFile(path.join(project, 'plugins/example.js'), source.replace('example.run', 'example.changed'))
    const changed = await transport.agentInterface('project', 'plugins/example.js')
    assert.match(changed, /example.changed/)
    assert.doesNotMatch(changed, /example.run/)
    assert.equal(await fs.readFile(file, 'utf8'), changed)
    await fs.writeFile(path.join(project, 'plugins/example.js'), source + '}')
    await assert.rejects(transport.agentInterface('project', 'plugins/example.js'), /cannot derive/)
    const packet = await contextFromDisk(CHECKOUT, { files: ['project/plugins/example.js'] }, project)
    assert.match(packet.text, /Interface unavailable/)
    assert.doesNotMatch(packet.text, /example.changed/)
    assert.equal(await transport.agentInterface('project', '../outside.js'), null)
  } finally { await fs.rm(project, { recursive: true, force: true }) }
})
