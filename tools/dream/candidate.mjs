/**
 * One candidate: a worktree, an agent's attempt, and the score it earned.
 *
 * A candidate is thrown away whatever it scores, so nothing here touches the
 * checkout a person is working in. Its whole result is a patch, kept in the
 * run's directory, plus the numbers: what the attempt spent and what the frozen
 * setup measured.
 *
 * The score comes from the setup loaded at the start of the run, digested, so
 * a candidate that edited a check is refused when the digest is compared rather
 * than trusted to have behaved.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyProject, digestOf, scoreRun } from './scoring.mjs'
import { sessionTokens } from './measures.mjs'
import { applyPatch, createWorktree, patchOf, removeWorktree } from './worktree.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** How long one candidate's agent may work, in seconds. */
const DEFAULT_CANDIDATE_TIMEOUT_SECONDS = 900

/** What the previous candidates measured, as lines a prompt can carry. */
function historyLines(history = []) {
  if (!history.length) return 'No candidate has run yet. The target as it stands is the one to beat.'
  return history
    .map(entry => `- ${entry.id}: value ${entry.value}, ${entry.pass ? 'every task passed' : `refused — ${entry.reason}`}`)
    .join('\n')
}

/** What one candidate's agent is told: the target, the limits, and the score so far. */
async function candidatePrompt({ checkout, runDirectory, setup, workspace, target, files, history }) {
  const template = await fs.readFile(path.join(checkout, 'tools/dream/prompts/candidate.md'), 'utf8')
  const measures = setup.tasks
    .map(task => `- ${task.id}: ${task.question}`)
    .join('\n')
  const weights = Object.entries(setup.weights ?? {})
    .map(([measure, weight]) => `${weight} per ${measure}`)
    .join(', ')

  return template
    .replaceAll('{{TARGET}}', String(target))
    .replaceAll('{{RUN_DIR}}', path.relative(checkout, runDirectory).split(path.sep).join('/'))
    .replaceAll('{{PROJECT}}', setup.project)
    .replaceAll('{{WORKSPACE}}', workspace)
    .replaceAll('{{FILES}}', files.length ? files.map(file => `- \`${file}\``).join('\n') : '- The files the target lives in. Find them; the target names no file.')
    .replaceAll('{{MEASURES}}', `${measures}\n\nWeights: ${weights || 'none declared'}`)
    .replaceAll('{{HISTORY}}', historyLines(history))
}

/**
 * Run one candidate and score it.
 *
 * The patch is written before the score is read, so a candidate that fails
 * still leaves what it tried in the run's record rather than only in a log.
 */
export async function runCandidate({
  checkout = CHECKOUT,
  runDirectory,
  setup,
  attempt,
  id,
  target,
  files = [],
  history = [],
  parent = null,
  depth = 0,
  timeoutSeconds = DEFAULT_CANDIDATE_TIMEOUT_SECONDS,
  model
} = {}) {
  const name = `${id}-c${attempt}`
  const record = {
    id: name,
    attempt,
    parent: parent?.id ?? 'target',
    depth: (parent?.depth ?? 0) + 1,
    status: 'failed',
    value: 0,
    verdict: 'refused',
    reason: null,
    measures: null,
    tokens: null,
    durationMs: 0,
    report: null,
    patch: null
  }

  const made = createWorktree(checkout, name)
  if (made.error) {
    record.reason = made.error
    return record
  }

  // A candidate starts from the best version so far, so a round builds on the
  // last one instead of retrying the target from scratch.
  if (parent?.patch) {
    const applied = applyPatch(made.workspace, parent.patch)
    if (applied.error) {
      record.reason = applied.error
      removeWorktree(checkout, name)
      return record
    }
  }

  const started = Date.now()
  try {
    const prompt = await candidatePrompt({ checkout, runDirectory, setup, workspace: made.workspace, target, files, history })
    const args = [
      path.join(checkout, 'tools/dsh-agent.mjs'),
      '--json',
      '--cwd', made.workspace,
      '--timeout', String(timeoutSeconds),
      '--permission-mode', 'workspace-write'
    ]
    if (model) args.push('--model', model)
    args.push(prompt)

    const run = spawnSync(process.execPath, args, { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    let envelope = null
    try {
      envelope = JSON.parse(String(run.stdout))
    } catch {
      record.reason = `the attempt printed no envelope: ${String(run.stderr || run.error?.message || '').trim().slice(0, 200)}`
    }

    if (envelope) {
      record.report = envelope.text ?? ''
      record.tokens = envelope.sessionDir ? sessionTokens(envelope.sessionDir) : { error: 'the harness reported no session' }
      record.status = envelope.status

      const project = await copyProject(path.resolve(made.workspace, setup.project))
      let score
      try {
        score = await scoreRun({
          checkout: made.workspace,
          project,
          tasks: setup.tasks,
          weights: setup.weights ?? {},
          name: setup.name,
          id: name,
          suiteHash: digestOf({ name: setup.name, tasks: setup.tasks, weights: setup.weights ?? {} })
        })
      } finally {
        await fs.rm(project, { recursive: true, force: true })
      }
      record.value = score.value
      record.verdict = score.verdict
      record.measures = score.totals?.measures ?? null
      record.reason = score.reason
    }

    // A worktree whose files changed but whose index knows nothing of them
    // would diff empty, so the patch is taken against the intent-to-add index.
    record.patch = patchOf(made.workspace)
  } catch (error) {
    record.reason = record.reason ?? `the attempt threw — ${error?.message || error}`
  } finally {
    record.durationMs = Date.now() - started
    removeWorktree(checkout, name)
  }

  return record
}

export { CHECKOUT, DEFAULT_CANDIDATE_TIMEOUT_SECONDS }
