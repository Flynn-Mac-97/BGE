import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { matchesAgentPattern, readAgentWorkspace, resolveAgentContext } from '../engine/agent-workspace.js'
import { contextFromDisk, prepareAgent, readAgentRegistry, releaseAgent, mergeAgent } from '../engine/agent-workspace-node.mjs'
import { onDisk } from '../engine/start-world-node.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Every node this checkout really offers, manifests and plugin guides alike. */
async function everyRealNode() {
  const project = path.join(ROOT, 'project')
  const read = (scope, file) => fs.promises.readFile(path.join(scope === 'engine' ? ROOT : project, file), 'utf8')
  const workspace = await readAgentWorkspace(read, await onDisk(project).agentPlugins())
  return workspace.nodes.filter(node => ['instruction', 'skill'].includes(node.kind))
}

function memoryReader({ disabled = ['blender'] } = {}) {
  const files = new Map([
    ['engine:agents/manifest.json', JSON.stringify({ version: 2, nodes: [
      { id: 'root', title: 'Root', kind: 'group' },
      { id: 'core', title: 'Rules', kind: 'instruction', parent: 'root', file: 'agents/core.md', always: true },
      { id: 'engine', title: 'Engine', kind: 'instruction', parent: 'root', file: 'agents/engine.md', match: ['engine/**'], tests: ['engine-check'] },
      { id: 'skills', title: 'Skills', kind: 'group', parent: 'root' },
      { id: 'blender', title: 'Blender', kind: 'skill', parent: 'skills', file: 'agents/skills/blender/SKILL.md', optional: true, triggers: ['blender'] }
    ] })],
    ['project:agents/manifest.json', JSON.stringify({ version: 2, nodes: [
      { id: 'game', title: 'Game', kind: 'instruction', parent: 'root', file: 'agents/game.md', match: ['project/**'], tests: ['game-check'] }
    ] })],
    ['project:agents/settings.json', JSON.stringify({ disabled })],
    ['engine:agents/core.md', 'shared'],
    ['engine:agents/engine.md', 'kernel only'],
    ['engine:agents/skills/blender/SKILL.md', '---\nname: blender\ndescription: Blender work.\n---\n\nblend only'],
    ['project:agents/game.md', 'game only']
  ])
  return async (scope, file) => {
    const value = files.get(`${scope}:${file}`)
    if (value == null) throw new Error(`missing ${scope}:${file}`)
    return value
  }
}

test('paths choose only matching branches', async () => {
  const base = memoryReader()
  const reads = []
  const result = await resolveAgentContext(async (scope, file) => {
    reads.push(`${scope}:${file}`)
    return base(scope, file)
  }, { files: ['engine/world.js'] })
  assert.deepEqual(result.nodes.map(node => node.id), ['core', 'engine'])
  assert.deepEqual(result.tests, ['engine-check'])
  assert.match(result.text, /shared[\s\S]*kernel only/)
  assert.doesNotMatch(result.text, /game only|blend only/)
  assert.ok(!reads.includes('project:agents/game.md'))
  assert.ok(!reads.includes('engine:agents/skills/blender/SKILL.md'))
  assert.equal(matchesAgentPattern('engine/folder/file.js', 'engine/**'), true)
})

test('disabled skills cost no context until enabled', async () => {
  const off = await resolveAgentContext(memoryReader(), { task: 'make a Blender model' })
  assert.doesNotMatch(off.text, /blend only/)
  const on = await resolveAgentContext(memoryReader({ disabled: [] }), { task: 'make a Blender model' })
  assert.match(on.text, /blend only/)
})

test('a project style rule replaces its named engine default', async () => {
  const files = new Map([
    ['engine:agents/manifest.json', JSON.stringify({ version: 2, nodes: [
      { id: 'root', kind: 'group' },
      { id: 'core', kind: 'instruction', parent: 'root', file: 'agents/core.md', always: true },
      { id: 'style', kind: 'instruction', parent: 'root', file: 'agents/style.md', override: 'style', match: ['**/*.js'] }
    ] })],
    ['project:agents/manifest.json', JSON.stringify({ version: 2, nodes: [
      { id: 'project-style', kind: 'instruction', parent: 'root', file: 'agents/overrides/style.md', override: 'style', match: ['project/**/*.js'] }
    ] })],
    ['project:agents/settings.json', JSON.stringify({ disabled: [] })],
    ['engine:agents/core.md', 'core'],
    ['engine:agents/style.md', 'engine style'],
    ['project:agents/overrides/style.md', 'project style']
  ])
  const read = async (scope, file) => files.get(`${scope}:${file}`)
  const result = await resolveAgentContext(read, { files: ['project/types/player.js'] })
  assert.match(result.text, /project style/)
  assert.doesNotMatch(result.text, /engine style/)
  assert.deepEqual(result.overrides, ['style'])
})

test('a project rule adds to an always rule and never evicts it', async () => {
  // Two routes, because an override is scoped to its own files while eviction
  // is scoped to the whole packet: a project file must not cost the engine
  // files beside it their universal rule.
  const files = new Map([
    ['engine:agents/manifest.json', JSON.stringify({ version: 2, nodes: [
      { id: 'root', kind: 'group' },
      { id: 'style', kind: 'instruction', parent: 'root', file: 'agents/style.md', override: 'style', always: true }
    ] })],
    ['project:agents/manifest.json', JSON.stringify({ version: 2, nodes: [
      { id: 'project-style', kind: 'instruction', parent: 'root', file: 'agents/overrides/style.md', override: 'style', match: ['project/**/*.js'] }
    ] })],
    ['project:agents/settings.json', JSON.stringify({ disabled: [] })],
    ['engine:agents/style.md', 'engine style'],
    ['project:agents/overrides/style.md', 'project style']
  ])
  const read = async (scope, file) => files.get(`${scope}:${file}`)
  for (const list of [['project/types/player.js'], ['engine/world.js', 'project/types/player.js']]) {
    const result = await resolveAgentContext(read, { files: list })
    assert.match(result.text, /engine style/, `the always rule is missing for ${list.join(' + ')}`)
  }
  // The project's own rule still arrives for its own files, after the engine's.
  const both = await resolveAgentContext(read, { files: ['project/types/player.js'] })
  assert.ok(both.text.indexOf('engine style') < both.text.indexOf('project style'))
})

test('enabled plugin guides load only when the task names the plugin', async () => {
  const base = memoryReader()
  const read = async (scope, file) => file === 'plugins/builtin/physics.agent.md'
    ? '# Physics\n\n- Use this for collision.\n'
    : base(scope, file)
  const plugin = {
    id: 'plugin-engine-physics', title: 'Physics', kind: 'instruction', parent: 'skills', scope: 'engine',
    file: 'plugins/builtin/physics.agent.md', triggers: ['physics'], enabled: true
  }
  const idle = await resolveAgentContext(read, { task: 'change a player' }, [plugin])
  assert.doesNotMatch(idle.text, /collision/)
  const matched = await resolveAgentContext(read, { task: 'fix physics' }, [plugin])
  assert.match(matched.text, /collision/)
})

// The first call an agent makes is the one where it does not yet know its
// files, so any rule selected by file match is absent from it. Style rules
// govern every write, so they cannot be selected that way.
test('a packet built from a task alone still carries the style rules', async () => {
  const packet = await contextFromDisk(ROOT, { task: 'finish the See plugin' })
  const ids = packet.nodes.map(node => node.id)
  assert.ok(ids.includes('code-style'), `code-style is missing from ${ids.join(', ')}`)
  assert.ok(ids.includes('comment-style'), `comment-style is missing from ${ids.join(', ')}`)
  assert.match(packet.text, /Explain why, not what the code already says/)
  assert.match(packet.text, /Use full names/)
})

test('a packet says what it withheld and that no files were named', async () => {
  const packet = await contextFromDisk(ROOT, { task: 'finish the See plugin' })
  const sent = new Set(packet.nodes.map(node => node.id))
  for (const node of packet.withheld) {
    assert.ok(node.id && node.title && node.reason, `withheld entry is incomplete: ${JSON.stringify(node)}`)
    assert.ok(!sent.has(node.id), `${node.id} is both sent and withheld`)
  }
  assert.ok(packet.withheld.some(node => node.id === 'engine'), 'the engine rules were dropped without saying so')
  assert.match(packet.text, /# Not included/)
  assert.match(packet.text, /`engine` — Engine — no file matched its patterns/)

  assert.ok(packet.skippedByFile > 0)
  assert.match(packet.text, new RegExp(`# You named no files[\\s\\S]*${packet.skippedByFile} rule sets`))

  const withFiles = await contextFromDisk(ROOT, { task: 'finish the See plugin', files: ['engine/world.js'] })
  assert.doesNotMatch(withFiles.text, /# You named no files/)
  assert.ok(withFiles.nodes.some(node => node.id === 'engine'))
})

// Guards the shape of the bug, not one node id: a rule that applies to every
// JavaScript or Markdown file cannot be reached by file match on the first
// call, so it must be marked `always`.
test('no rule covering all JavaScript or all Markdown waits on a file match', async () => {
  // Every probe sits in a directory: `**/*.js` matches nothing at the root, so a
  // root file would let a pattern that covers the whole tree slip through.
  const everywhere = ['engine/world.js', 'plugins/builtin/see.js', 'project/types/player.js', 'a/b/c/deep.js']
  const everyDocument = ['agents/core.md', 'docs/kernel.md', 'project/notes.md', 'a/b/c/deep.md']
  const covers = (patterns, probes) =>
    probes.every(file => patterns.some(pattern => matchesAgentPattern(file, pattern)))

  for (const node of await everyRealNode()) {
    const patterns = node.match || []
    if (!covers(patterns, everywhere) && !covers(patterns, everyDocument)) continue
    assert.equal(node.always, true,
      `node "${node.id}" matches every file of a kind, so it must set "always": true rather than wait for a file list`)
  }
})

test('bad parents are shown in the tree status', async () => {
  const base = memoryReader()
  const read = async (scope, file) => scope === 'project' && file === 'agents/manifest.json'
    ? JSON.stringify({ version: 2, nodes: [{ id: 'lost', kind: 'instruction', parent: 'missing', file: 'agents/game.md' }] })
    : base(scope, file)
  const workspace = await readAgentWorkspace(read)
  assert.ok(workspace.problems.some(problem => problem.includes('missing parent')))
})

test('small tasks stay put and parallel tasks receive worktrees', async t => {
  const fixtures = path.join(ROOT, '.tmp-agent-tests')
  fs.mkdirSync(fixtures, { recursive: true })
  const root = fs.mkdtempSync(path.join(fixtures, 'engine-agent-workspace-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  fs.mkdirSync(path.join(root, 'project'), { recursive: true })
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'agents'), path.join(root, 'agents'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'project/agents'), path.join(root, 'project/agents'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  fs.copyFileSync(path.join(ROOT, 'ARCHITECTURE.md'), path.join(root, 'ARCHITECTURE.md'))
  fs.writeFileSync(path.join(root, 'engine/world.js'), 'export const world = true\n')
  fs.writeFileSync(path.join(root, '.gitignore'), '.agent-worktrees/\nproject/.engine/\n')

  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
  git(['init']); git(['config', 'user.email', 'agent-test@example.invalid']); git(['config', 'user.name', 'Agent Test'])
  git(['add', '.']); git(['commit', '-m', 'baseline'])

  const small = await prepareAgent(root, 'small-fix', { files: ['engine/world.js'] })
  assert.equal(small.mode, 'current')
  await assert.rejects(prepareAgent(root, 'overlap', { files: ['engine/world.js'] }), /overlaps active work|active writer/)

  // The fixture is not a real checkout, so its required checks cannot pass.
  // That is the point: release runs them and refuses, where it used to record
  // the caller's word that they had been run.
  assert.throws(() => releaseAgent(root, 'small-fix'), /checks failed/)
  assert.equal(readAgentRegistry(root).runs.find(run => run.id === 'small-fix').status, 'active',
    'a refused release leaves the run active')

  const blocked = releaseAgent(root, 'small-fix', { status: 'blocked', note: 'no engine in the fixture' })
  assert.equal(blocked.status, 'blocked')

  const parallel = await prepareAgent(root, 'parallel-fix', { files: ['engine/world.js'], parallel: true })
  assert.equal(parallel.mode, 'worktree')
  assert.equal(parallel.packet, path.join(parallel.workspace, 'project', '.engine/agent-task.json'))
  assert.ok(fs.existsSync(parallel.packet))

  // The packet is written beside the game the lane works on, so a run under one
  // project never writes into another's directory.
  const named = await prepareAgent(root, 'named-project', { files: ['engine/render.js'], parallel: true }, 'kitten-survivors')
  assert.equal(named.packet, path.join(named.workspace, 'kitten-survivors', '.engine/agent-task.json'))
  assert.ok(fs.existsSync(named.packet))
  releaseAgent(root, 'named-project', { status: 'blocked', note: 'no engine in the fixture' })
  mergeAgent(root, 'named-project')

  assert.equal(readAgentRegistry(root).runs.filter(run => run.status === 'active').length, 1)
  releaseAgent(root, 'parallel-fix', { status: 'blocked', note: 'no engine in the fixture' })

  // Merging takes the worktree and the branch away, so the id is free again.
  mergeAgent(root, 'parallel-fix')
  assert.ok(!fs.existsSync(parallel.workspace), 'the worktree is gone')
  assert.equal(execFileSync('git', ['-C', root, 'branch', '--list', parallel.branch], { encoding: 'utf8' }).trim(), '',
    'the branch is gone')
  assert.equal(readAgentRegistry(root).runs.find(run => run.id === 'parallel-fix').status, 'merged')
})
