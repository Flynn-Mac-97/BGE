/** Node-only agent coordination: focused packets, run registry, and worktrees. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { resolveAgentContext } from './agent-workspace.js'
import { onDisk } from './start-world-node.mjs'

/** A path in the one spelling the tree uses: forward slashes, no leading `./`. */
const normal = value =>
  String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')

/** Run git in a checkout and return its trimmed output; a failure throws with git's own message. */
const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }).trim()

/** The main worktree's absolute path, so lane records survive a worktree being deleted. */
export function mainWorktree(root) {
  const line = git(root, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .find(value => value.startsWith('worktree '))
  if (!line) throw new Error('git did not report a main worktree')
  return path.resolve(line.slice('worktree '.length))
}

/** The run registry's path in the main worktree. */
const registryFile = root =>
  path.join(process.env.ENGINE_STATE_ROOT || path.join(mainWorktree(root), '.engine'), 'agents.json')

/** A registry edit is one read and one rename; a lock older than this is a corpse. */
const STALE_LOCK_MILLISECONDS = 60_000

/** The run records for this checkout, or an empty registry when the file is missing or broken. */
export function readAgentRegistry(root) {
  try {
    const value = JSON.parse(fs.readFileSync(registryFile(root), 'utf8'))
    return { version: 1, runs: Array.isArray(value.runs) ? value.runs : [] }
  } catch {
    return { version: 1, runs: [] }
  }
}

/** Read, change and rename the run registry under a lock, breaking a lock older than a minute. */
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
    try {
      fs.unlinkSync(lock)
    } catch {
      /* already gone */
    }
  }
}

/** The directory part of a glob before its first wildcard. */
function staticPrefix(pattern) {
  const wildcardIndex = pattern.search(/[?*]/)
  return normal(wildcardIndex < 0 ? pattern : pattern.slice(0, wildcardIndex)).replace(/\/$/, '')
}

/** Whether two claimed paths are the same or one is inside the other. */
export function claimsOverlap(left, right) {
  const leftPath = normal(left),
    rightPath = normal(right)
  if (leftPath === rightPath) return true
  const leftPrefix = staticPrefix(leftPath),
    rightPrefix = staticPrefix(rightPath)
  if (!leftPrefix || !rightPrefix) return true
  return leftPrefix.startsWith(rightPrefix + '/') || rightPrefix.startsWith(leftPrefix + '/')
}

/**
 * Whether two claims can be held at once — which is not the same question as
 * whether their paths overlap.
 *
 * A claim exists so two writers never edit one file. Under a directory claim,
 * that only covers the files already in it: a file nobody has written yet
 * cannot be edited twice, and each lane is in its own worktree, so two new
 * files under one folder never touch. The prefix rule alone meant one lane
 * claiming `<project>/plugins` locked every other lane out of a folder that was
 * empty, and four lanes each adding one new plugin is the ordinary case.
 *
 * Same path is still a conflict, whether or not it is on disk yet — two lanes
 * both meaning to create `horde.js` is exactly what this is here to stop.
 */
export const claimsCollide = (root, left, right) => {
  if (normal(left) === normal(right)) return true
  if (!claimsOverlap(left, right)) return false
  const deeper = normal(left).length > normal(right).length ? left : right
  return fs.existsSync(path.join(root, normal(deeper)))
}

/**
 * A free id, given the ones already taken.
 *
 * Suffixed rather than random so the suggestion still names the work.
 */
/** A free id suffixed off `id`, so a suggestion still names the work. */
function freeId(taken, id) {
  let suffix = 2
  while (taken.has(`${id}-${suffix}`)) suffix++
  return `${id}-${suffix}`
}

/** Refuse an id or file claim that an active or unmerged run already holds. */
function assertAvailable(root, runs, id, files, parallel) {
  const active = runs.filter(run => run.status === 'active')
  if (active.some(run => run.id === id)) throw new Error(`agent task "${id}" is already active`)

  // Every verb that takes an id resolves it against this file, so two records
  // sharing one id cannot be told apart. A merged run may keep its name; an
  // unfinished one still answers to it.
  const unfinished = runs.filter(run => run.id === id && run.status !== 'merged')
  if (unfinished.length) {
    const taken = new Set(runs.map(run => run.id))
    throw new Error(
      `agent task "${id}" already exists and is not merged (status: ${unfinished[unfinished.length - 1].status}). ` +
        `Land it with agent.merge ${id}, or use a different id such as "${freeId(taken, id)}".`
    )
  }

  const conflicts = active.filter(run =>
    files.some(file => (run.files || []).some(claimed => claimsCollide(root, file, claimed)))
  )
  if (conflicts.length) {
    const detail = conflicts.map(run => `${run.id}: ${(run.files || []).join(', ')}`).join('; ')
    throw new Error(`file claim overlaps active work: ${detail}`)
  }

  if (!parallel && active.some(run => run.mode === 'current')) {
    throw new Error('the current workspace already has an active writer; finish it or use a parallel worktree')
  }
}

/** Refuse a task id that is not lowercase letters, numbers, hyphens or underscores. */
const validateId = id => {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error('task id must use lowercase letters, numbers, hyphens, or underscores')
  }
}

/**
 * Jev when its plugin is present, null when that directory is gone.
 *
 * Jev is a plugin, so the kernel reaches it lazily: a checkout without it
 * still builds packets, without the advisory block. Any other import fault is
 * real and must not be swallowed.
 */
async function loadJev() {
  try {
    return await import('../plugins/builtin/jev/context.mjs')
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    return null
  }
}

/**
 * Build a packet for a request by reading the tree off disk.
 *
 * The read refuses any path that leaves the scope it named, so a request cannot
 * pull in a file outside the engine or the project.
 *
 * @param {string} checkout The checkout.
 * @param {object} request The task, files and nodes asked for.
 * @param {string} projectPath The open project, as the tree spells it.
 * @param {Function} interfaceText `(scope, file)`, answering a plugin's parsed
 * interface. Optional: without it a packet carries guide prose alone.
 */
export async function contextFromDisk(checkout, request, projectPath = 'project', interfaceText = null) {
  const root = path.resolve(checkout)
  const project = path.resolve(root, projectPath)
  const read = (scope, file) => {
    const base = scope === 'engine' ? root : project
    const target = path.resolve(base, file)
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error(`agent instruction path escapes ${scope}: ${file}`)
    }
    return fs.promises.readFile(target, 'utf8')
  }
  const transport = onDisk(project, root)
  const pluginNodes = await transport.agentPlugins()
  // A packet's checks run from the checkout, so the project they name is the
  // path from there. The absolute path is longer and moves with the worktree.
  const projectLabel = normal(path.relative(root, project)) || '.'
  const packet = await resolveAgentContext(
    read,
    request,
    pluginNodes,
    projectLabel,
    interfaceText || transport.agentInterface
  )
  // A request that names no files has given the agent nothing to point at. The
  // file tree in the packet answers that, so finding a path costs no second
  // engine process (`tree`). A request that names files needs no tree.
  if (!packet.files.length) {
    const { walk } = await import('./project-index.mjs')
    packet.tree = await walk(project)
  }
  // Jev is off unless the project switched it on or the request asked for it.
  // It only appends an advisory block: a fault leaves the packet as it was.
  const jev = await loadJev()
  const suggested = jev ? await jev.addGuideSuggestions({ project, request, packet, pluginNodes, read }) : null
  if (suggested) {
    packet.jev = suggested.jev
    if (suggested.suggestions) packet.suggestions = suggested.suggestions
    if (suggested.dropped) packet.jevDropped = suggested.dropped
    if (suggested.section) {
      packet.text = packet.text.trimEnd() + '\n' + suggested.section
      packet.characters = packet.text.length
    }
  }
  return packet
}

/**
 * Claim a run: build its packet, check the claim, and make a worktree when the
 * caller asked for parallel work.
 *
 * The claim is checked twice — once before the worktree exists and again under
 * the registry lock — so two prepares racing for one file cannot both win.
 *
 * @param {Function} interfaceText `(scope, file)`, answering a plugin's parsed
 * interface for the packet the lane is handed.
 */
export async function prepareAgent(root, id, request = {}, projectPath = 'project', interfaceText = null) {
  validateId(id)
  const main = mainWorktree(root)
  const files = []
    .concat(request.files || [])
    .map(normal)
    .filter(Boolean)
  const parallel = request.parallel === true || request.mode === 'parallel'
  if (parallel && !files.length) throw new Error('parallel tasks must claim at least one file')

  const packet = await contextFromDisk(main, { ...request, files, parallel }, projectPath, interfaceText)
  assertAvailable(main, readAgentRegistry(main).runs, id, files, parallel)

  let workspace = main
  let branch = null
  if (parallel) {
    const dirty = git(main, ['status', '--porcelain', '--untracked-files=all'])
    if (dirty) {
      throw new Error('parallel work needs a clean tracked baseline; commit or stash current changes first')
    }
    workspace = path.join(main, '.agent-worktrees', id)
    if (fs.existsSync(workspace)) {
      throw new Error(
        `worktree path already exists: ${workspace}\n` +
          `A released lane keeps its worktree until it is merged. Land it with\n` +
          `  node bin/engine.mjs agent.merge ${id}\n` +
          `or throw the work away with\n` +
          `  git worktree remove --force ${path.join('.agent-worktrees', id)} && git branch -D agent/${id}`
      )
    }
    branch = `agent/${id}`
    try {
      git(main, ['worktree', 'add', '-b', branch, workspace, 'HEAD'])
    } catch (error) {
      throw new Error(`could not create worktree "${branch}" — ${String(error.stderr || error.message).trim()}`, {
        cause: error
      })
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
      assertAvailable(main, registry.runs, id, files, parallel)
      return { ...registry, runs: [...registry.runs, run] }
    })
  } catch (error) {
    if (parallel) {
      try {
        git(main, ['worktree', 'remove', '--force', workspace])
      } catch {
        /* report original failure */
      }
      try {
        git(main, ['branch', '-D', branch])
      } catch {
        /* report original failure */
      }
    }
    throw error
  }

  // In the lane's own workspace, not in a project: the project may be any
  // directory on disk and is shared by every lane, so a packet written there
  // would be overwritten by the next run.
  const taskFile = path.join(workspace, '.engine/agent-task.json')
  fs.mkdirSync(path.dirname(taskFile), { recursive: true })
  fs.writeFileSync(taskFile, JSON.stringify({ run, context: packet }, null, 2) + '\n', 'utf8')

  return {
    ...run,
    packet: taskFile,
    context: packet,
    next: `cd ${JSON.stringify(workspace)} then read ${JSON.stringify(taskFile)}, work only on the claimed files, and run the required checks`
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
const SERIAL = ['npm test', 'test/cli.bridge.mjs']
/** Whether a required check needs the one dev server and editor tab, so a lane must defer it. */
const isSerial = check => SERIAL.some(needle => check.includes(needle))

/**
 * Run one check and say what happened.
 *
 * The output is kept short on success and whole on failure: a passing check is
 * a tick, and a failing one is the only thing anybody will read.
 */
function runCheck(cwd, command) {
  try {
    const output = execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    return { command, ok: true, exitCode: 0, output: output.trim().slice(-400) }
  } catch (error) {
    return {
      command,
      ok: false,
      exitCode: error.status ?? null,
      output: String(error.stdout || '')
        .trim()
        .slice(-2000),
      error: String(error.stderr || error.message)
        .trim()
        .slice(-2000)
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
  // The newest run with this id. An id is reused across sessions, and an older
  // merged record answering for a finished lane skips the merge and reports
  // success.
  const runs = readAgentRegistry(main).runs.filter(entry => entry.id === id)
  const run = runs[runs.length - 1]
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
    const failure = new Error(
      conflicts.length
        ? `merging "${id}" conflicts in: ${conflicts.join(', ')}. Resolve them, commit, then run agent.merge ${id} again`
        : `could not merge "${id}" — ${String(error.stderr || error.message).trim()}`
    )
    failure.conflicts = conflicts
    throw failure
  }

  // The commit is durable, so record it before anything that can fail. Cleanup
  // and the deferred checks come after: a worktree this process cannot delete
  // must not cost the registry its only note that the work landed.
  let merged
  editRegistry(main, registry => {
    const found = sameRun(registry.runs, run)
    if (!found) throw new Error(`agent task "${id}" left the registry mid-merge`)
    found.status = 'merged'
    found.mergedAt = new Date().toISOString()
    merged = found
    return registry
  })

  // Run here, once, now the work is in the worktree a dev server and an editor
  // tab can exist in.
  const serial = (run.deferred || []).map(check => runCheck(main, check))
  const broke = serial.filter(check => !check.ok)

  const cleanup = removeWorktree(main, run)

  editRegistry(main, registry => {
    const found = sameRun(registry.runs, run)
    if (!found) return registry
    if (serial.length) found.serialChecks = serial
    if (!cleanup.ok) found.leftBehind = cleanup.why
    merged = { ...found }
    return registry
  })

  const problems = [
    ...(broke.length
      ? [`${broke.length} deferred check(s) failed here: ${broke.map(check => check.command).join(', ')}`]
      : []),
    ...(cleanup.ok ? [] : [cleanup.why])
  ]
  return {
    ...merged,
    merged: true,
    serialChecks: serial,
    cleaned: cleanup.ok,
    ok: problems.length === 0,
    ...(problems.length ? { why: `merged, but ${problems.join('; ')}` } : {})
  }
}

/** Absolute paths git currently lists as worktrees. */
function gitWorktrees(main) {
  return git(main, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => path.resolve(line.slice('worktree '.length)))
}

/** Whether a branch ref exists in the checkout. */
const branchExists = (main, branch) => {
  try {
    git(main, ['rev-parse', '--verify', '--quiet', branch])
    return true
  } catch {
    return false
  }
}

/** Whether a branch's commits are already in HEAD. */
const inHead = (main, branch) => {
  try {
    git(main, ['merge-base', '--is-ancestor', branch, 'HEAD'])
    return true
  } catch {
    return false
  }
}

/**
 * What git says about a run, as against what the registry recorded.
 *
 * The registry is written by whichever verb ran last, and a verb that fails
 * part way writes nothing. Git holds the commits either way, so state is read
 * from git and the stored status is kept only to be compared against it.
 */
export function agentState(root) {
  const main = mainWorktree(root)
  const worktrees = new Set(gitWorktrees(main))
  const mainPath = path.resolve(main)
  return readAgentRegistry(main).runs.map(run => {
    // A merge deletes the lane's branch, so a missing ref is the normal end
    // state and git has nothing left to test. Only a branch that still exists
    // can be proved landed or not; without one the record is all there is.
    const hasBranch = Boolean(run.branch) && branchExists(main, run.branch)
    const landed = hasBranch ? inHead(main, run.branch) : run.status === 'merged'
    const state = {
      id: run.id,
      recorded: run.status,
      startedAt: run.startedAt,
      files: run.files || [],
      workspace: run.workspace || null,
      landed,
      provenByGit: hasBranch,
      branch: run.branch || null,
      branchExists: hasBranch,
      // A run in the current workspace records the main worktree as its
      // workspace, which is never a leftover.
      ownsWorktree: Boolean(run.workspace) && path.resolve(run.workspace) !== mainPath,
      hasWorktree: run.workspace ? worktrees.has(path.resolve(run.workspace)) : false,
      onDisk: run.workspace ? fs.existsSync(run.workspace) : false
    }
    state.live = run.status === 'active'
    // The registry disagreeing with git is the reading nobody gets from the
    // stored status, and it decides whether a lane still needs merging.
    state.disagrees = hasBranch && landed && run.status !== 'merged'
    return state
  })
}

/**
 * Remove what finished lanes left in `.agent-worktrees`, and old agent output.
 *
 * Two worktree leftovers, from the same cause: one git still lists whose work
 * is already in HEAD, and one git does not list at all, left by a removal that
 * deleted some of the files and then failed. Only runs already in HEAD are
 * touched, so unmerged work is never deleted.
 *
 * `days` is passed to `sweepRuns`, which clears rounds of agent output.
 */
export function sweepAgents(root, { dryRun = false, days } = {}) {
  const main = mainWorktree(root)
  const home = path.join(main, '.agent-worktrees')
  const worktrees = new Set(gitWorktrees(main))
  const states = new Map(
    agentState(root)
      .filter(state => state.workspace)
      .map(state => [path.resolve(state.workspace), state])
  )

  const { removed, kept } = sweepWorktrees(main, home, worktrees, states, dryRun)
  pruneWorktrees(main)
  const branches = sweepBranches(main, root, dryRun)
  const runs = sweepRuns(root, { days, dryRun })
  return { removed, branches, kept, runs, ok: kept.length === 0 }
}

/** Remove the worktree directories that are landed or unrecorded, keeping the rest. */
function sweepWorktrees(main, home, worktrees, states, dryRun) {
  const removed = []
  const kept = []
  for (const name of fs.existsSync(home) ? fs.readdirSync(home) : []) {
    const directory = path.join(home, name)
    if (!fs.statSync(directory).isDirectory()) continue
    const listed = worktrees.has(path.resolve(directory))
    const state = states.get(path.resolve(directory))

    if (listed && !(state && state.landed)) {
      kept.push({
        directory,
        why: state ? 'its work is not in HEAD yet' : 'git lists it and no run record explains it'
      })
      continue
    }

    if (dryRun) {
      removed.push({ directory, listed, would: true })
      continue
    }
    try {
      removeSweptWorktree(main, directory, listed)
      removed.push({ directory, listed })
      deleteLandedBranch(main, state?.branch)
    } catch (error) {
      kept.push({ directory, why: String(error.stderr || error.message).trim() })
    }
  }
  return { removed, kept }
}

/** Remove one swept worktree, by git when git lists it and by hand when it does not. */
function removeSweptWorktree(main, directory, listed) {
  if (listed) git(main, ['worktree', 'remove', '--force', directory])
  else fs.rmSync(directory, { recursive: true, force: true })
}

/** Delete a landed lane branch, if it exists and its commits are in HEAD. */
function deleteLandedBranch(main, branch) {
  if (!branch || !branchExists(main, branch) || !inHead(main, branch)) return
  try {
    git(main, ['branch', '-d', branch])
  } catch {
    /* a branch left behind is not a failure to sweep */
  }
}

/**
 * A worktree git lists whose directory a failed removal already deleted keeps
 * answering `git worktree list` until this runs.
 */
function pruneWorktrees(main) {
  try {
    git(main, ['worktree', 'prune'])
  } catch {
    /* prune is advisory */
  }
}

/**
 * A lane branch outlives its worktree when removal succeeded and the branch
 * delete did not, and it is what keeps a landed run reading as unmerged.
 */
function sweepBranches(main, root, dryRun) {
  const branches = []
  const live = new Set(gitWorktrees(main))
  for (const state of agentState(root)) {
    if (!state.branch || !state.branchExists || !state.landed) continue
    if (state.workspace && live.has(path.resolve(state.workspace))) continue
    if (dryRun) {
      branches.push({ branch: state.branch, would: true })
      continue
    }
    try {
      git(main, ['branch', '-d', state.branch])
      branches.push({ branch: state.branch })
    } catch {
      /* keep going */
    }
  }
  return branches
}

/**
 * What an agent may leave in `agent-runs/` and never lose.
 *
 * The two ledgers outlive every round and the README says what the directory
 * is. Everything else there is working output and is swept.
 */
const KEEP_IN_RUNS = new Set(['README.md', 'painpoints.jsonl', 'insights.jsonl'])

/** Default age before a round is swept. Long enough to finish, short enough to stay clean. */
const RUN_DAYS = 7

/**
 * Delete rounds of agent output older than `days`.
 *
 * Agent output accumulates faster than anyone reads it, and a directory nobody
 * can sift through hides the two ledgers that do matter. A finding worth
 * keeping is already a painpoint, an insight, a rule in a guide, or a test —
 * so anything still only in `agent-runs/` after a week was working output.
 *
 * Age is taken from the entry's own modification time, so a round still being
 * written is never swept.
 */
export function sweepRuns(root, { days = RUN_DAYS, dryRun = false } = {}) {
  const home = path.join(mainWorktree(root), 'agent-runs')
  if (!fs.existsSync(home)) return { directory: 'agent-runs', days, removed: [], kept: [] }

  const oldest = Date.now() - days * 24 * 60 * 60 * 1000
  const removed = []
  const kept = []
  for (const name of fs.readdirSync(home)) {
    if (KEEP_IN_RUNS.has(name)) continue
    const entry = path.join(home, name)
    const changed = fs.statSync(entry).mtimeMs
    if (changed > oldest) {
      kept.push({ entry: `agent-runs/${name}`, why: 'newer than the age limit' })
      continue
    }
    if (dryRun) {
      removed.push({ entry: `agent-runs/${name}`, would: true })
      continue
    }
    try {
      fs.rmSync(entry, { recursive: true, force: true })
      removed.push({ entry: `agent-runs/${name}` })
    } catch (error) {
      kept.push({ entry: `agent-runs/${name}`, why: String(error.message).trim() })
    }
  }
  return { directory: 'agent-runs', days, removed, kept }
}

/**
 * The registry's own copy of a run, matched on when it started.
 *
 * An id is reused across sessions, so matching on id alone stamps the oldest
 * record with the newest outcome.
 */
const sameRun = (runs, run) => runs.find(entry => entry.id === run.id && entry.startedAt === run.startedAt)

/**
 * Take a merged lane's worktree and branch away, and say so if it could not.
 *
 * Removal fails while another process holds a file open in the worktree — on
 * Windows a dev server the lane started and never stopped is enough. The merge
 * has already happened by then, so this reports rather than throws, and
 * `agent.sweep` finishes the job once the holder exits.
 */
function removeWorktree(main, run) {
  try {
    git(main, ['worktree', 'remove', '--force', run.workspace])
  } catch (error) {
    return {
      ok: false,
      why:
        `could not remove the worktree at ${run.workspace} — ${String(error.stderr || error.message).trim()}. ` +
        `Stop anything running inside it, then run: node bin/engine.mjs agent.sweep`
    }
  }
  try {
    git(main, ['branch', '-d', run.branch])
  } catch (error) {
    return {
      ok: false,
      why: `worktree removed, but branch ${run.branch} remains — ${String(error.stderr || error.message).trim()}`
    }
  }
  return { ok: true }
}
