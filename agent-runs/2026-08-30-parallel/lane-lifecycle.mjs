/**
 * A parallel lane, start to finish, against real git.
 *
 * prepare -> work in the worktree -> release (which runs the checks) -> merge
 * (which lands it, runs the deferred checks, and takes the worktree away).
 *
 * Proves the two things that were not true before: release refuses a lane whose
 * checks fail, and merge leaves no worktree and no branch behind so the id can
 * be used again.
 *
 *   node agent-runs/2026-08-30-parallel/lane-lifecycle.mjs
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { prepareAgent, releaseAgent, mergeAgent, readAgentRegistry } from '../../engine/agent-workspace-node.mjs'

const ROOT = 'Z:/Code/browser game engine'
const ID = 'probe-lane'
const git = args => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim()

let failures = 0
const check = (ok, label, detail) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (detail !== undefined) console.log('     ', JSON.stringify(detail)) }
}

const startedOn = git(['rev-parse', 'HEAD'])

/**
 * Undo only what this script did.
 *
 * `git reset --hard` is not a tidy-up, it is a demolition: an early version ran
 * it unconditionally and destroyed the uncommitted edits of whoever was running
 * the script, on a path where the script had not yet changed anything. It only
 * runs now if HEAD actually moved, which means only after a merge landed.
 */
const cleanup = () => {
  try { git(['merge', '--abort']) } catch { /* no merge in progress */ }
  try { git(['worktree', 'remove', '--force', join(ROOT, '.agent-worktrees', ID)]) } catch { /* gone */ }
  try { git(['branch', '-D', `agent/${ID}`]) } catch { /* gone */ }
  if (git(['rev-parse', 'HEAD']) !== startedOn) git(['reset', '--hard', startedOn])
  rmSync(join(ROOT, 'project/.engine/agents.json'), { force: true })
}

try {
  rmSync(join(ROOT, 'project/.engine/agents.json'), { force: true })

  // ---- prepare -------------------------------------------------------------
  const run = await prepareAgent(ROOT, ID, {
    task: 'probe the lane lifecycle',
    files: ['project/types/probe-lane.js'],
    parallel: true
  })
  check(run.mode === 'worktree', 'a parallel task gets a worktree', run.mode)
  check(existsSync(run.workspace), 'and the worktree is on disk', run.workspace)
  check(run.branch === `agent/${ID}`, 'on its own branch', run.branch)

  // ---- a lane that does not pass its checks --------------------------------
  const broken = join(run.workspace, 'project/types/probe-lane.js')
  writeFileSync(broken, 'export default { properties: { mass: ( } }\n')
  execFileSync('git', ['-C', run.workspace, 'add', '-A'], { encoding: 'utf8' })
  execFileSync('git', ['-C', run.workspace, 'commit', '-q', '-m', 'a plugin that does not parse'], { encoding: 'utf8' })

  let refused = null
  try { releaseAgent(ROOT, ID, {}) } catch (error) { refused = error }
  check(refused !== null, 'release REFUSES a lane whose checks fail')
  check(/checks failed/.test(refused?.message || ''), 'and says which one', refused?.message?.slice(0, 90))
  check(readAgentRegistry(ROOT).runs.find(r => r.id === ID)?.status === 'active',
    'the run stays active after a refusal')

  // ---- fix it, then release ------------------------------------------------
  writeFileSync(broken, `/**
 * Probe Lane — a throwaway plugin written by the lane lifecycle proof.
 *
 * It exists only so the lane has a real file to claim, commit and merge.
 */
export default { properties: { mass: 1 } }
`)
  execFileSync('git', ['-C', run.workspace, 'add', '-A'], { encoding: 'utf8' })
  execFileSync('git', ['-C', run.workspace, 'commit', '-q', '-m', 'a plugin that parses'], { encoding: 'utf8' })

  const released = releaseAgent(ROOT, ID, {})
  check(released.status === 'complete', 'release accepts a lane whose checks pass', released.status)
  check(released.checks.every(entry => entry.ok), 'and records what it actually ran',
    released.checks.map(entry => `${entry.command} exit ${entry.exitCode}`))
  check(released.checks.some(entry => entry.command.includes('bin/engine.mjs check')),
    'including the engine check')

  // ---- merge ---------------------------------------------------------------
  const merged = mergeAgent(ROOT, ID)
  check(merged.merged === true, 'merge lands the lane', merged.why)
  check(!existsSync(run.workspace), 'the worktree is gone')
  const branches = git(['branch', '--list', `agent/${ID}`])
  check(branches === '', 'the branch is gone', branches)
  check(readAgentRegistry(ROOT).runs.find(r => r.id === ID)?.status === 'merged', 'the registry says merged')

  // ---- the id is reusable, which it was not before -------------------------
  const again = await prepareAgent(ROOT, ID, { task: 'again', files: ['project/types/probe-lane.js'], parallel: true })
  check(again.mode === 'worktree', 'the same id can be prepared again')
} finally {
  cleanup()
  console.log('worktree, branch and registry cleaned up; HEAD back to', startedOn.slice(0, 7))
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
