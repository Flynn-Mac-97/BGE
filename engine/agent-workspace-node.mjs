/** Node-only agent coordination: focused packets, run registry, and worktrees. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
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
    throw new Error('another agent is updating the run registry; retry after it finishes')
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

export async function contextFromDisk(root, request) {
  root = path.resolve(root)
  const project = path.join(root, 'project')
  const read = (scope, file) => {
    const base = scope === 'engine' ? root : project
    const target = path.resolve(base, file)
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error(`agent instruction path escapes ${scope}: ${file}`)
    }
    return fs.promises.readFile(target, 'utf8')
  }
  return resolveAgentContext(read, request, await onDisk(project).agentPlugins())
}

export async function prepareAgent(root, id, request = {}) {
  validateId(id)
  const main = mainWorktree(root)
  const files = [].concat(request.files || []).map(normal).filter(Boolean)
  const parallel = request.parallel === true || request.mode === 'parallel'
  if (parallel && !files.length) throw new Error('parallel tasks must claim at least one file')

  const packet = await contextFromDisk(main, { ...request, files, parallel })
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

export function releaseAgent(root, id, result = {}) {
  validateId(id)
  let released
  editRegistry(root, registry => {
    const found = registry.runs.find(run => run.id === id && run.status === 'active')
    if (!found) throw new Error(`no active agent task "${id}"`)
    const blocked = result.status === 'blocked'
    const checks = result.checks === true || result.checks === 'all'
      ? [...(found.tests || [])]
      : [].concat(result.checks || []).map(String)
    const missing = (found.tests || []).filter(check => !checks.includes(check))
    if (!blocked && missing.length) {
      throw new Error(`cannot complete "${id}"; checks not recorded: ${missing.join(', ')}. Run them, then use agent.release ${id} --checked`)
    }
    found.status = blocked ? 'blocked' : 'complete'
    found.completedAt = new Date().toISOString()
    if (result.note) found.note = String(result.note)
    found.checks = checks
    released = { ...found }
    return registry
  })
  return released
}
