import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { matchesAgentPattern, readAgentWorkspace, resolveAgentContext } from '../engine/agent-workspace.js'
import {
  contextFromDisk, prepareAgent, readAgentRegistry, releaseAgent, mergeAgent,
  agentState, sweepAgents
} from '../engine/agent-workspace-node.mjs'
import { onDisk } from '../engine/start-world-node.mjs'
import { FIXTURE } from './fixture-project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Every node this checkout really offers, manifests and plugin guides alike. */
async function everyRealNode() {
  const read = (scope, file) => fs.promises.readFile(path.join(scope === 'engine' ? ROOT : FIXTURE, file), 'utf8')
  const workspace = await readAgentWorkspace(read, await onDisk(FIXTURE, ROOT).agentPlugins())
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

test('a broad file match carries the guide without an unrelated plugin interface', async () => {
  const guide = {
    id: 'plugin-engine-physics', title: 'Physics', kind: 'instruction', parent: 'skills',
    scope: 'engine', file: 'plugins/builtin/physics.agent.md', source: 'plugins/builtin/physics.js',
    match: ['plugins/**'], enabled: true
  }
  const interfaces = []
  const read = async (scope, file) => file === guide.file ? '# Physics\n\n- Use this for collision.\n' : memoryReader()(scope, file)
  const packet = await resolveAgentContext(read, { files: ['plugins/builtin/particles.js'] }, [guide], 'project', async (scope, file) => {
    interfaces.push(`${scope}:${file}`)
    return 'PARSED PHYSICS INTERFACE'
  })
  assert.match(packet.text, /Use this for collision/)
  assert.doesNotMatch(packet.text, /PARSED PHYSICS INTERFACE/)
  assert.deepEqual(interfaces, [])
})

// The first call an agent makes is the one where it does not yet know its
// files, so any rule selected by file match is absent from it. Style rules
// govern every write, so they cannot be selected that way.
test('a packet built from a task alone still carries the style rules', async () => {
  const packet = await contextFromDisk(ROOT, { task: 'finish the See plugin' })
  const ids = packet.nodes.map(node => node.id)
  assert.ok(ids.includes('code-style'), `code-style is missing from ${ids.join(', ')}`)
  assert.match(packet.text, /A comment says what the code cannot/)
  assert.match(packet.text, /Full words: `context`, not `ctx`/)
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
  fs.cpSync(path.join(FIXTURE, 'agents'), path.join(root, 'project/agents'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  fs.copyFileSync(path.join(ROOT, 'ARCHITECTURE.md'), path.join(root, 'ARCHITECTURE.md'))
  fs.writeFileSync(path.join(root, 'engine/world.js'), 'export const world = true\n')
  fs.writeFileSync(path.join(root, '.gitignore'), '.agent-worktrees/\n.engine/\n')

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
  assert.equal(parallel.packet, path.join(parallel.workspace, '.engine/agent-task.json'))
  assert.ok(fs.existsSync(parallel.packet))

  // The packet is written in the lane's own workspace, never in a project: the
  // project is shared by every lane, so a packet there is overwritten by the
  // next run.
  const named = await prepareAgent(root, 'named-project', { files: ['engine/render.js'], parallel: true }, 'kitten-survivors')
  assert.equal(named.packet, path.join(named.workspace, '.engine/agent-task.json'))
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

/**
 * A checkout with the agent manifests in it, ready for lanes.
 *
 * The fixture has no engine, so its required checks cannot pass. Every lane
 * here releases blocked, which skips the checks and still exercises merging,
 * state and sweeping.
 */
function laneFixture(t) {
  const fixtures = path.join(ROOT, '.tmp-agent-tests')
  fs.mkdirSync(fixtures, { recursive: true })
  const root = fs.mkdtempSync(path.join(fixtures, 'engine-agent-lanes-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  fs.mkdirSync(path.join(root, 'project'), { recursive: true })
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'agents'), path.join(root, 'agents'), { recursive: true })
  fs.cpSync(path.join(FIXTURE, 'agents'), path.join(root, 'project/agents'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  fs.copyFileSync(path.join(ROOT, 'ARCHITECTURE.md'), path.join(root, 'ARCHITECTURE.md'))
  fs.writeFileSync(path.join(root, 'engine/world.js'), 'export const world = true\n')
  fs.writeFileSync(path.join(root, 'engine/render.js'), 'export const render = true\n')
  fs.writeFileSync(path.join(root, '.gitignore'), '.agent-worktrees/\n.engine/\n')

  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init']); git(['config', 'user.email', 'agent-test@example.invalid']); git(['config', 'user.name', 'Agent Test'])
  git(['add', '.']); git(['commit', '-m', 'baseline'])
  return { root, git }
}

/** Give a lane a commit of its own, so merging it is a real merge. */
function commitInLane(lane, name) {
  fs.writeFileSync(path.join(lane.workspace, `${name}.txt`), `${name}\n`)
  const run = args => execFileSync('git', ['-C', lane.workspace, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  run(['add', '.']); run(['commit', '-m', `work from ${name}`])
}

const stateOf = (root, id) => agentState(root).filter(state => state.id === id).pop()

test('a merge is recorded even when the worktree cannot be removed', async t => {
  const { root, git } = laneFixture(t)

  const lane = await prepareAgent(root, 'stuck', { files: ['engine/world.js'], parallel: true })
  commitInLane(lane, 'stuck')
  releaseAgent(root, 'stuck', { status: 'blocked', note: 'fixture' })

  // Deleting git's administrative copy makes `worktree remove` fail on every
  // platform, which is what a file another process holds open does on Windows.
  fs.rmSync(path.join(root, '.git/worktrees/stuck'), { recursive: true, force: true })

  const merged = mergeAgent(root, 'stuck')
  assert.equal(merged.merged, true)
  assert.equal(merged.cleaned, false, 'removal was expected to fail in this fixture')
  assert.match(merged.why, /agent\.sweep/, 'the reply must say how to finish the cleanup')

  // The commit is durable, so the registry says merged whatever cleanup did.
  assert.equal(readAgentRegistry(root).runs.find(run => run.id === 'stuck').status, 'merged')
  assert.equal(stateOf(root, 'stuck').landed, true)
  assert.match(git(['log', '--oneline']), /work from stuck/)
})

test('an unmerged id cannot be reused and a merged one can', async t => {
  const { root } = laneFixture(t)

  const first = await prepareAgent(root, 'twice', { files: ['engine/world.js'], parallel: true })
  commitInLane(first, 'first')
  releaseAgent(root, 'twice', { status: 'blocked', note: 'fixture' })

  // Released but not merged: every verb that takes an id would now have two
  // records to choose between.
  await assert.rejects(
    prepareAgent(root, 'twice', { files: ['engine/render.js'], parallel: true }),
    /already exists and is not merged[\s\S]*twice-2/)

  mergeAgent(root, 'twice')
  const again = await prepareAgent(root, 'twice', { files: ['engine/render.js'], parallel: true })
  assert.equal(again.id, 'twice')
  assert.equal(readAgentRegistry(root).runs.filter(run => run.id === 'twice').length, 2)
})

test('state comes from git, not from the recorded status', async t => {
  const { root } = laneFixture(t)

  const lane = await prepareAgent(root, 'drift', { files: ['engine/world.js'], parallel: true })
  commitInLane(lane, 'drift')
  releaseAgent(root, 'drift', { status: 'blocked', note: 'fixture' })

  const before = stateOf(root, 'drift')
  assert.equal(before.landed, false)
  assert.equal(before.provenByGit, true)
  assert.equal(before.disagrees, false)

  // Merged by hand, the way a person resolving a conflict does, so the registry
  // never hears about it.
  execFileSync('git', ['-C', root, 'merge', '--no-ff', '-m', 'merged by hand', 'agent/drift'], { stdio: 'ignore' })

  const after = stateOf(root, 'drift')
  assert.equal(after.landed, true, 'git says the work is in HEAD')
  assert.equal(after.recorded, 'blocked', 'the registry still says otherwise')
  assert.equal(after.disagrees, true)
})

test('a sweep clears landed leftovers and never touches unmerged work', async t => {
  const { root } = laneFixture(t)
  const home = path.join(root, '.agent-worktrees')

  const landed = await prepareAgent(root, 'landed', { files: ['engine/world.js'], parallel: true })
  commitInLane(landed, 'landed')
  releaseAgent(root, 'landed', { status: 'blocked', note: 'fixture' })
  execFileSync('git', ['-C', root, 'merge', '--no-ff', '-m', 'merged by hand', 'agent/landed'], { stdio: 'ignore' })

  const unmerged = await prepareAgent(root, 'unmerged', { files: ['engine/render.js'], parallel: true })
  commitInLane(unmerged, 'unmerged')
  releaseAgent(root, 'unmerged', { status: 'blocked', note: 'fixture' })

  // A directory git no longer lists, left by a removal that deleted part of the
  // worktree and then failed.
  const orphan = path.join(home, 'orphan')
  fs.mkdirSync(orphan, { recursive: true })
  fs.writeFileSync(path.join(orphan, 'leftover.txt'), 'x\n')

  const planned = sweepAgents(root, { dryRun: true })
  assert.ok(planned.removed.every(entry => entry.would), 'a dry run removes nothing')
  assert.ok(fs.existsSync(orphan), 'a dry run leaves the orphan on disk')
  assert.ok(fs.existsSync(unmerged.workspace))

  const swept = sweepAgents(root)
  const gone = swept.removed.map(entry => path.basename(entry.directory)).sort()
  assert.deepEqual(gone, ['landed', 'orphan'])

  assert.ok(!fs.existsSync(landed.workspace), 'a landed worktree is removed')
  assert.ok(!fs.existsSync(orphan), 'an orphan directory is deleted')
  assert.ok(fs.existsSync(unmerged.workspace), 'work that is not in HEAD is kept')
  assert.ok(swept.kept.some(entry => path.basename(entry.directory) === 'unmerged'))

  // The landed lane's branch goes with its worktree; the unmerged one stays.
  const branches = execFileSync('git', ['-C', root, 'branch', '--list'], { encoding: 'utf8' })
  assert.doesNotMatch(branches, /agent\/landed/)
  assert.match(branches, /agent\/unmerged/)
})

test('a sweep deletes a landed branch whose worktree is already gone', async t => {
  const { root, git } = laneFixture(t)

  const landed = await prepareAgent(root, 'orphan-branch', { files: ['engine/world.js'], parallel: true })
  commitInLane(landed, 'orphan-branch')
  releaseAgent(root, 'orphan-branch', { status: 'blocked', note: 'fixture' })
  git(['merge', '--no-ff', '-m', 'merged by hand', 'agent/orphan-branch'])

  // Removing the worktree by hand leaves the branch, which is what keeps a
  // landed run reading as unmerged.
  git(['worktree', 'remove', '--force', landed.workspace])
  assert.equal(stateOf(root, 'orphan-branch').branchExists, true)

  const planned = sweepAgents(root, { dryRun: true })
  assert.ok(planned.branches.some(entry => entry.branch === 'agent/orphan-branch' && entry.would))
  assert.equal(stateOf(root, 'orphan-branch').branchExists, true, 'a dry run deletes no branch')

  const swept = sweepAgents(root)
  assert.ok(swept.branches.some(entry => entry.branch === 'agent/orphan-branch'))
  assert.doesNotMatch(git(['branch', '--list']), /agent\/orphan-branch/)
})

test('a sweep keeps the branch of a lane that is still checked out', async t => {
  const { root, git } = laneFixture(t)

  const lane = await prepareAgent(root, 'still-out', { files: ['engine/world.js'], parallel: true })
  commitInLane(lane, 'still-out')
  releaseAgent(root, 'still-out', { status: 'blocked', note: 'fixture' })
  git(['merge', '--no-ff', '-m', 'merged by hand', 'agent/still-out'])

  // Landed, but a worktree still has the branch checked out, so deleting it
  // would leave that worktree on a branch git no longer knows.
  const swept = sweepAgents(root, { dryRun: true })
  assert.ok(!swept.branches.some(entry => entry.branch === 'agent/still-out'),
    'a branch checked out in a live worktree is left alone')
})

test('a run in the current workspace is never reported as a leftover', async t => {
  const { root } = laneFixture(t)

  await prepareAgent(root, 'in-place', { files: ['engine/world.js'] })
  releaseAgent(root, 'in-place', { status: 'blocked', note: 'fixture' })

  const state = stateOf(root, 'in-place')
  assert.equal(state.ownsWorktree, false, 'the main worktree is not a lane worktree')
  assert.equal(state.onDisk, true)
  assert.deepEqual(sweepAgents(root).removed, [], 'a sweep leaves the checkout alone')
})

test('merging a reused id records the run that was merged', async t => {
  const { root } = laneFixture(t)

  const first = await prepareAgent(root, 'shared', { files: ['engine/world.js'], parallel: true })
  commitInLane(first, 'first')
  releaseAgent(root, 'shared', { status: 'blocked', note: 'fixture' })
  mergeAgent(root, 'shared')

  const second = await prepareAgent(root, 'shared', { files: ['engine/render.js'], parallel: true })
  commitInLane(second, 'second')
  releaseAgent(root, 'shared', { status: 'blocked', note: 'fixture' })
  mergeAgent(root, 'shared')

  const records = readAgentRegistry(root).runs.filter(run => run.id === 'shared')
  assert.equal(records.length, 2)
  assert.ok(records.every(run => run.status === 'merged'), 'both records report their own outcome')
  assert.notEqual(records[0].mergedAt, records[1].mergedAt, 'each merge stamped its own record')
  assert.match(execFileSync('git', ['-C', root, 'log', '--oneline'], { encoding: 'utf8' }), /work from second/)
})

test('agent context leaves Jev off by default and falls back to the plain packet without a key', async () => {
  const beforeKey = process.env.OPENROUTER_API_KEY
  const beforeProxy = process.env.OPENROUTER_PROXY_URL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_PROXY_URL
  try {
    const off = await contextFromDisk(ROOT, { task: 'finish the See plugin', jev: false })
    assert.equal(off.jev, undefined, 'off means no Jev field and no call')
    const plain = await contextFromDisk(ROOT, { task: 'finish the See plugin' })
    assert.equal(plain.jev, undefined, 'the switch is off by default')

    const on = await contextFromDisk(ROOT, { task: 'finish the See plugin', jev: true })
    assert.equal(on.jev.ok, false)
    assert.match(on.jev.why, /no OpenRouter key/)
    assert.equal(on.text, plain.text, 'a Jev fault leaves the packet exactly as it was')
  } finally {
    if (beforeKey !== undefined) process.env.OPENROUTER_API_KEY = beforeKey
    if (beforeProxy !== undefined) process.env.OPENROUTER_PROXY_URL = beforeProxy
  }
})

test('a file inside a game folder routes the packet to that game, with no --project', async () => {
  const games = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-packet-game-'))
  const game = path.join(games, 'brawler')
  fs.mkdirSync(path.join(game, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(game, 'game.json'), '{"title":"Brawler"}')
  fs.writeFileSync(path.join(game, 'plugins', 'gear.js'), 'export default { name: "Gear" }\n')
  try {
    const packet = await contextFromDisk(ROOT, { task: 'polish the gear', files: [path.join(game, 'plugins', 'gear.js')] })
    assert.ok(packet.nodes.some(node => node.id === 'game'), `the game rule set is in (${packet.nodes.map(node => node.id)})`)
  } finally {
    fs.rmSync(games, { recursive: true, force: true })
  }
})
