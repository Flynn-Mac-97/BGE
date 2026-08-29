/** Node-only agent coordination: focused packets, run registry, and worktrees. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { resolveAgentContext } from './agent-workspace.js'
import { onDisk } from './start-world-node.mjs'

const normal = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')

const git = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}).trim()

export function mainWorktree(root) {
  const line = git(root, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/).find(value => value.startsWith('worktree '))
  if (!line) throw new Error('git did not report a main worktree')
  return path.resolve(line.slice('worktree '.length))
}

const registryFile = root => path.join(mainWorktree(root), 'project/.engine/agents.json')

/** A registry edit is one read and one rename; a lock older than this is a corpse. */
const STALE_LOCK_MILLISECONDS = 60_000

export function readAgentRegistry(root) {
  try {
    const value = JSON.parse(fs.readFileSync(registryFile(root), 'utf8'))
    return { version: 1, runs: Array.isArray(value.runs) ? value.runs : [] }
  } catch { return { version: 1, runs: [] } }
}

function editRegistry(root, change) {
  const file = registryFile(root)
  const lock = file + '.lock'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let handle
  try {
    handle = fs.openSync(lock, 'wx')
  } catch {
    // A killed agent leaves its lock behind, and nothing used to clear it, so
    // one SIGKILL blocked every later prepare and release for good. A lock
    // older than a minute cannot belong to a live edit — this function holds
    // it for one read and one rename — so break it and say so, rather than
    // making a person find a file they were never told about.
    const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
    if (age < STALE_LOCK_MILLISECONDS) {
      throw new Error('another agent is updating the run registry; retry after it finishes')
    }
    console.warn(`[agents] breaking a stale registry lock, ${Math.round(age / 1000)}s old: ${lock}`)
    fs.rmSync(lock, { force: true })
    handle = fs.openSync(lock, 'wx')
  }
  try {
    const registry = readAgentRegistry(root)
    const next = change(registry) || registry
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fs.renameSync(temporary, file)
    return next
  } finally {
    if (handle != null) fs.closeSync(handle)
    try { fs.unlinkSync(lock) } catch { /* already gone */ }
  }
}

function staticPrefix(pattern) {
  const at = pattern.search(/[?*]/)
  return normal(at < 0 ? pattern : pattern.slice(0, at)).replace(/\/$/, '')
}

export function claimsOverlap(left, right) {
  const a = normal(left), b = normal(right)
  if (a === b) return true
  const ap = staticPrefix(a), bp = staticPrefix(b)
  if (!ap || !bp) return true
  return ap.startsWith(bp + '/') || bp.startsWith(ap + '/')
}

function assertAvailable(runs, id, files, parallel) {
  const active = runs.filter(run => run.status === 'active')
  if (active.some(run => run.id === id)) throw new Error(`agent task "${id}" is already active`)

  const conflicts = active.filter(run =>
    files.some(file => (run.files || []).some(claimed => claimsOverlap(file, claimed))))
  if (conflicts.length) {
    const detail = conflicts.map(run => `${run.id}: ${(run.files || []).join(', ')}`).join('; ')
    throw new Error(`file claim overlaps active work: ${detail}`)
  }

  if (!parallel && active.some(run => run.mode === 'current')) {
    throw new Error('the current workspace already has an active writer; finish it or use a parallel worktree')
  }
}

const validateId = id => {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error('task id must use lowercase letters, numbers, hyphens, or underscores')
  }
}

export async function contextFromDisk(root, request, projectDirectory = 'project') {
  root = path.resolve(root)
  const project = path.join(root, projectDirectory)
  const read = (scope, file) => {
    const base = scope === 'engine' ? root : project
    const target = path.resolve(base, file)
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error(`agent instruction path escapes ${scope}: ${file}`)
    }
    return fs.promises.readFile(target, 'utf8')
  }
  return resolveAgentContext(read, request, await onDisk(project).agentPlugins(), projectDirectory)
}

export async function prepareAgent(root, id, request = {}, projectDirectory = 'project') {
  validateId(id)
  const main = mainWorktree(root)
  const files = [].concat(request.files || []).map(normal).filter(Boolean)
  const parallel = request.parallel === true || request.mode === 'parallel'
  if (parallel && !files.length) throw new Error('parallel tasks must claim at least one file')

  const packet = await contextFromDisk(main, { ...request, files, parallel }, projectDirectory)
  assertAvailable(readAgentRegistry(main).runs, id, files, parallel)

  let workspace = main
  let branch = null
  if (parallel) {
    const dirty = git(main, ['status', '--porcelain', '--untracked-files=all'])
    if (dirty) {
      throw new Error('parallel work needs a clean tracked baseline; commit or stash current changes first')
    }
    workspace = path.join(main, '.agent-worktrees', id)
    if (fs.existsSync(workspace)) throw new Error(`worktree path already exists: ${workspace}`)
    branch = `agent/${id}`
    try {
      git(main, ['worktree', 'add', '-b', branch, workspace, 'HEAD'])
    } catch (error) {
      throw new Error(`could not create worktree "${branch}" — ${String(error.stderr || error.message).trim()}`)
    }
  }

  const run = {
    id,
    task: String(request.task || ''),
    status: 'active',
    mode: parallel ? 'worktree' : 'current',
    files,
    lanes: packet.lanes.map(lane => lane.id),
    tests: packet.tests,
    workspace,
    ...(branch ? { branch } : {}),
    startedAt: new Date().toISOString()
  }

  try {
    editRegistry(main, registry => {
      // Check again while holding the registry lock. Two prepare commands may
      // have passed the first read together; only one overlapping claim wins.
      assertAvailable(registry.runs, id, files, parallel)
      return { ...registry, runs: [...registry.runs, run] }
    })
  } catch (error) {
    if (parallel) {
      try { git(main, ['worktree', 'remove', '--force', workspace]) } catch { /* report original failure */ }
      try { git(main, ['branch', '-D', branch]) } catch { /* report original failure */ }
    }
    throw error
  }

  const taskFile = path.join(workspace, 'project/.engine/agent-task.json')
  fs.mkdirSync(path.dirname(taskFile), { recursive: true })
  fs.writeFileSync(taskFile, JSON.stringify({ run, context: packet }, null, 2) + '\n', 'utf8')

  return {
    ...run,
    context: packet,
    next: `cd ${JSON.stringify(workspace)} then work only on the claimed files and run the required checks`
  }
}

/**
 * Checks that need the one dev server and the one editor tab.
 *
 * They cannot run in a worktree and several lanes cannot run them at once, so
 * a lane defers them and `agent.merge` runs them in the main worktree, once,
 * after the lane's work has landed. Matched by substring because a manifest
 * writes the whole command line.
 */
const SERIAL = ['npm test', 'test/cli.test.mjs']
const isSerial = check => SERIAL.some(needle => check.includes(needle))

/**
 * Run one check and say what happened.
 *
 * The output is kept short on success and whole on failure: a passing check is
 * a tick, and a failing one is the only thing anybody will read.
 */
function runCheck(cwd, command) {
  try {
    const output = execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { command, ok: true, exitCode: 0, output: output.trim().slice(-400) }
  } catch (error) {
    return {
      command,
      ok: false,
      exitCode: error.status ?? null,
      output: String(error.stdout || '').trim().slice(-2000),
      error: String(error.stderr || error.message).trim().slice(-2000)
    }
  }
}

/**
 * Finish a run, having actually run its checks.
 *
 * This used to copy the lane's list of required checks into the record on the
 * caller's say-so, and run nothing — so a lane that never tested released
 * exactly as cleanly as one that did, and the registry then carried a record
 * that read as proof. Worse than no gate, because it was believed.
 */
export function releaseAgent(root, id, result = {}) {
  validateId(id)
  const main = mainWorktree(root)
  const run = readAgentRegistry(main).runs.find(entry => entry.id === id && entry.status === 'active')
  if (!run) throw new Error(`no active agent task "${id}"`)

  const blocked = result.status === 'blocked'
  const required = run.tests || []
  // Run them outside the registry lock: a check takes seconds and the lock is
  // held for one read and one rename.
  const ran = blocked ? [] : required.filter(check => !isSerial(check)).map(check => runCheck(run.workspace, check))
  const deferred = blocked ? [] : required.filter(isSerial)
  const failed = ran.filter(check => !check.ok)

  if (failed.length) {
    const detail = failed.map(check => `${check.command} (exit ${check.exitCode})`).join('; ')
    const error = new Error(`cannot complete "${id}"; checks failed: ${detail}`)
    error.checks = ran
    throw error
  }

  let released
  editRegistry(main, registry => {
    const found = registry.runs.find(entry => entry.id === id && entry.status === 'active')
    if (!found) throw new Error(`no active agent task "${id}"`)
    found.status = blocked ? 'blocked' : 'complete'
    found.completedAt = new Date().toISOString()
    if (result.note) found.note = String(result.note)
    found.checks = ran
    // Named, not silently dropped. agent.merge runs these in the main worktree.
    if (deferred.length) found.deferred = deferred
    released = { ...found }
    return registry
  })
  return released
}

/**
 * Land a finished lane and take its workspace away.
 *
 * `release` only ever flipped a status, so a parallel run ended with a worktree
 * and an `agent/<id>` branch still on disk and a merge nobody had done — and
 * re-preparing that id later failed at `git worktree add` because the branch
 * was still there. This is the other half of finishing.
 *
 * A conflict is reported by name and the worktree is kept, because the lane's
 * work is the only place the resolution can come from.
 */
export function mergeAgent(root, id) {
  validateId(id)
  const main = mainWorktree(root)
  const run = readAgentRegistry(main).runs.find(entry => entry.id === id)
  if (!run) throw new Error(`no agent task "${id}"`)
  if (run.status === 'active') throw new Error(`agent task "${id}" is still active; release it first`)
  if (run.status === 'merged') return { ...run, already: true }
  if (!run.branch) {
    // A single-writer run edited the main worktree directly. There is nothing
    // to merge and nothing to remove; say so rather than inventing a git step.
    return { ...run, merged: false, why: 'this run used the current workspace, so its work is already here' }
  }

  const dirty = git(main, ['status', '--porcelain', '--untracked-files=all'])
  if (dirty) throw new Error('the main worktree has uncommitted changes; commit or stash them before merging a lane')

  try {
    git(main, ['merge', '--no-ff', '-m', `Merge agent lane ${id}`, run.branch])
  } catch (error) {
    const conflicts = git(main, ['diff', '--name-only', '--diff-filter=U']).split(/\r?\n/).filter(Boolean)
    const failure = new Error(conflicts.length
      ? `merging "${id}" conflicts in: ${conflicts.join(', ')}. Resolve them, commit, then run agent.merge ${id} again`
      : `could not merge "${id}" — ${String(error.stderr || error.message).trim()}`)
    failure.conflicts = conflicts
    throw failure
  }

  // The checks a lane could not run are run here, once, now that its work is in
  // the main worktree where a dev server and an editor tab can exist.
  const serial = (run.deferred || []).map(check => runCheck(main, check))
  const broke = serial.filter(check => !check.ok)

  git(main, ['worktree', 'remove', '--force', run.workspace])
  git(main, ['branch', '-d', run.branch])

  let merged
  editRegistry(main, registry => {
    const found = registry.runs.find(entry => entry.id === id)
    found.status = 'merged'
    found.mergedAt = new Date().toISOString()
    if (serial.length) found.serialChecks = serial
    merged = { ...found }
    return registry
  })

  // Merged and reported, not merged and hidden. The work is in; whether it is
  // good is the next thing anybody needs to know.
  return { ...merged, merged: true, serialChecks: serial, ok: broke.length === 0,
    ...(broke.length ? { why: `merged, but ${broke.length} deferred check(s) failed here: ${broke.map(check => check.command).join(', ')}` } : {}) }
}
