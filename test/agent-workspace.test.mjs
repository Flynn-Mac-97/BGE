import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { matchesAgentPattern, readAgentWorkspace, resolveAgentContext } from '../engine/agent-workspace.js'
import { prepareAgent, readAgentRegistry, releaseAgent } from '../engine/agent-workspace-node.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
  assert.throws(() => releaseAgent(root, 'small-fix'), /checks not recorded/)
  releaseAgent(root, 'small-fix', { checks: 'all' })

  const parallel = await prepareAgent(root, 'parallel-fix', { files: ['engine/world.js'], parallel: true })
  assert.equal(parallel.mode, 'worktree')
  assert.ok(fs.existsSync(path.join(parallel.workspace, 'project/.engine/agent-task.json')))
  assert.equal(readAgentRegistry(root).runs.filter(run => run.status === 'active').length, 1)
  releaseAgent(root, 'parallel-fix', { checks: 'all' })
  git(['worktree', 'remove', '--force', parallel.workspace]); git(['branch', '-D', parallel.branch])
})
