/**
 * The worktrees a dream run works in.
 *
 * A candidate is a version of the target to be tried and thrown away, so it
 * needs its own checkout: one candidate's edits must not be visible to the next
 * one's score, and none of them may touch the checkout a person is working in.
 *
 * Worktrees sit in `.agent-worktrees/`, inside the checkout, so a candidate
 * resolves `node_modules` by walking up to the checkout root. A copy of the
 * checkout would need its own install; a worktree needs nothing.
 *
 * Everything starts at HEAD, which is why a run refuses a tree with uncommitted
 * changes: a candidate cannot see work that is not committed, so it would be
 * scored against a target that is not the target.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { mainWorktree, readAgentRegistry } from '../../engine/agent-workspace-node.mjs'

/** Where worktrees live, relative to the checkout. */
const WORKTREES = '.agent-worktrees'

/**
 * Run one git command in a checkout and return its output.
 *
 * The buffer is raised far past node's one megabyte default: a candidate's diff
 * is read through here, and a large one threw ENOBUFS, which lost the round's
 * patch and with it every round that built on it.
 */
export function git(checkout, args) {
  return execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, windowsHide: true
  })
}

/**
 * Whether the tracked tree is clean enough to branch from.
 *
 * Untracked files are allowed: scratch and run output live in `agent-runs/`,
 * which is ignored, and a candidate never needs them.
 */
export function baselineState(checkout) {
  const dirty = git(checkout, ['status', '--porcelain', '--untracked-files=no']).trim()
  return { clean: dirty === '', dirty }
}

/**
 * Whether another agent holds a live lane.
 *
 * A dream run edits the engine on its own, without claiming files, so it stays
 * out of the way of a lane rather than racing it.
 */
export function laneIsLive(checkout) {
  const live = readAgentRegistry(mainWorktree(checkout)).runs.find(run => run.status === 'active')
  return live ? { id: live.id, files: live.files ?? [] } : null
}

/** Make one worktree at HEAD, on its own branch. */
export function createWorktree(checkout, name) {
  const workspace = path.join(checkout, WORKTREES, `dream-${name}`)
  const branch = `dream/${name}`
  if (fs.existsSync(workspace)) {
    return { error: `the worktree ${workspace} already exists; remove it before reusing the name ${name}` }
  }
  try {
    git(checkout, ['worktree', 'add', '-b', branch, workspace, 'HEAD'])
  } catch (error) {
    return { error: `could not create the worktree ${branch} — ${String(error.stderr || error.message).trim()}` }
  }
  return { workspace, branch }
}

/** Take one worktree and its branch away. Reports what is left rather than throwing. */
export function removeWorktree(checkout, name) {
  const workspace = path.join(checkout, WORKTREES, `dream-${name}`)
  const branch = `dream/${name}`
  const problems = []
  try {
    git(checkout, ['worktree', 'remove', '--force', workspace])
  } catch (error) {
    problems.push(`worktree: ${String(error.stderr || error.message).trim()}`)
  }
  try {
    git(checkout, ['branch', '-D', branch])
  } catch (error) {
    problems.push(`branch: ${String(error.stderr || error.message).trim()}`)
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Replace one literal string in one file.
 *
 * Exactly one occurrence, or nothing changes. A control that silently rewrote
 * the wrong occurrence would report a breakage it did not cause, and a target
 * edit that matched twice would change more than the candidate intended.
 */
export function replaceOnce(file, find, replace) {
  if (!fs.existsSync(file)) return { error: `no file at ${file}` }
  const text = fs.readFileSync(file, 'utf8')
  const first = text.indexOf(find)
  if (first < 0) return { error: `${path.basename(file)} does not contain the string to replace` }
  if (text.indexOf(find, first + find.length) >= 0) {
    return { error: `${path.basename(file)} contains the string to replace more than once` }
  }
  fs.writeFileSync(file, text.slice(0, first) + replace + text.slice(first + find.length), 'utf8')
  return { ok: true }
}

/** Everything a candidate changed, as a patch, for the run's record. */
export function patchOf(workspace) {
  git(workspace, ['add', '--intent-to-add', '.'])
  return git(workspace, ['diff', '--no-color', '--binary'])
}

/**
 * Start a candidate from the best version so far rather than from the target.
 *
 * Without this every round would retry the same problem from scratch and the
 * run could never build on its own result. The patch is the whole lineage: a
 * candidate is the target plus its parent's diff.
 */
export function applyPatch(workspace, patchFile) {
  try {
    git(workspace, ['apply', '--whitespace=nowarn', patchFile])
  } catch (error) {
    return { error: `could not apply ${path.basename(patchFile)} — ${String(error.stderr || error.message).trim()}` }
  }
  return { ok: true }
}
