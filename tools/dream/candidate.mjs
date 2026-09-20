/**
 * One candidate: a worktree, an agent's attempt, and the score it earned.
 *
 * A candidate is thrown away whatever it scores, so nothing here touches the
 * checkout a person is working in. Its whole result is a patch, kept in the
 * run's directory, plus the numbers: what the attempt spent, what it produced,
 * and what the frozen setup measured.
 *
 * The score comes from the setup loaded at the start of the run, digested, so
 * a candidate that edited a check is refused when the digest is compared rather
 * than trusted to have behaved.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyProject, digestOf, scoreRun } from './scoring.mjs'
import { sessionTokens } from './measures.mjs'
import { costBands } from './pricing.mjs'
import { applyPatch, createWorktree, patchOf, removeWorktree } from './worktree.mjs'
import { DEFAULT_HARNESS, harnessWrapper } from './harness.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** How long one candidate's agent may work, in seconds. */
const DEFAULT_CANDIDATE_TIMEOUT_SECONDS = 900

/**
 * What the whole prompt may cost, in characters.
 *
 * The engine's instruction packet is built first and usually takes most of it,
 * so the history block gets what is left. An attempt's own text is small and
 * fixed, and the packet is bounded by the engine's routing; the history is the
 * part that would grow with every attempt, so the history is what is capped.
 */
const PROMPT_BUDGET_CHARACTERS = 48000

/** The largest history block, however much of the prompt budget is free. */
const HISTORY_BLOCK_CHARACTERS = 12000

/** One attempt's entry is cut here, so one long report cannot fill the block. */
const HISTORY_ENTRY_CHARACTERS = 1200

/** The block keeps a place for at least one attempt even when the packet has taken the rest. */
const HISTORY_FLOOR_CHARACTERS = 1200

/** Below this there is room for nothing useful, so the block stops rather than stubbing entries. */
const HISTORY_ENTRY_MINIMUM_CHARACTERS = 240

/**
 * What earlier attempts did, as text the prompt carries.
 *
 * The paper gives a rollout the completed history rather than a summary of it,
 * so each entry keeps the attempt's own report and the files its patch changed,
 * not only its number. The block is capped: the records stay on disk, and a
 * block that will not hold every attempt names how many it left out.
 */
export async function historyLines({ runDirectory = null, history = [], budget = HISTORY_BLOCK_CHARACTERS } = {}) {
  const attempts = runDirectory ? await readAttempts(runDirectory) : []
  if (!attempts.length) return summarize(history).slice(0, budget)

  const lines = []
  let used = 0
  let omitted = 0
  for (const attempt of byRelevance(attempts)) {
    const room = Math.min(HISTORY_ENTRY_CHARACTERS, budget - used)
    if (room < HISTORY_ENTRY_MINIMUM_CHARACTERS) {
      omitted++
      continue
    }
    const text = await attemptText(attempt, room)
    lines.push(text)
    used += text.length + 1
  }

  if (omitted) {
    const note = `- ${omitted} earlier attempt${omitted === 1 ? '' : 's'} left out to keep this prompt small; their records are under \`rounds/r*/\` in the run directory.`
    if (used + note.length <= budget) lines.push(note)
  }
  return lines.join('\n')
}

/** The one-line-per-attempt block, used when no round records are on disk. */
function summarize(history = []) {
  if (!history.length) return 'No candidate has run yet. The target as it stands is the one to beat.'
  return history
    .map(entry => `- ${entry.id}: value ${entry.value}, ${entry.pass ? 'every task passed' : `score zero — ${entry.reason}`}`)
    .join('\n')
}

/** Every candidate record a run has written, with the round it was made in. */
async function readAttempts(runDirectory) {
  const rounds = path.join(runDirectory, 'rounds')
  const attempts = []
  for (const directory of (await fs.readdir(rounds).catch(() => [])).sort()) {
    const round = Number(directory.replace(/^r/, ''))
    const files = (await fs.readdir(path.join(rounds, directory)).catch(() => [])).sort()
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'round.json') continue
      // A record being written at this moment reads as nothing and is skipped;
      // the attempt after it will see the record whole.
      const record = JSON.parse(await fs.readFile(path.join(rounds, directory, file), 'utf8').catch(() => 'null'))
      if (!record) continue
      attempts.push({
        ...record,
        round: Number.isFinite(round) ? round : null,
        patchFile: path.join(rounds, directory, `${record.id}.patch`)
      })
    }
  }
  return attempts
}

/**
 * The order the block reads attempts in: most relevant first.
 *
 * The paper's node holds the evolution history from the root to that node, so
 * the line of attempts leading to the best version comes first, the best itself
 * and then its parents, nearest first, because a candidate continues from its
 * parent's workspace. Failed checks follow, because their reports say what
 * broke; then the scored attempts by value, and refusals last.
 */
function byRelevance(attempts) {
  const byId = new Map(attempts.map(attempt => [attempt.id, attempt]))
  const ordered = []
  const seen = new Set()
  const best = attempts
    .filter(attempt => attempt.best === true)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0) || (right.depth ?? 0) - (left.depth ?? 0))[0]
  for (let walk = best; walk && !seen.has(walk.id); walk = byId.get(walk.parent)) {
    seen.add(walk.id)
    ordered.push(walk)
  }

  const rank = attempt => (attempt.verdict === 'failed' ? 0 : attempt.verdict === 'scored' ? 1 : 2)
  const rest = attempts
    .filter(attempt => !seen.has(attempt.id))
    .sort((left, right) => rank(left) - rank(right) || (right.value ?? 0) - (left.value ?? 0) || (right.round ?? 0) - (left.round ?? 0) || String(left.id).localeCompare(String(right.id)))
  return [...ordered, ...rest]
}

/**
 * One attempt as text: what it changed, what its agent reported, what the
 * evaluator measured. The report and the measures are cut last, so an
 * oversized report never hides the change or the score.
 */
async function attemptText(attempt, room) {
  const verdict = attempt.verdict === 'scored'
    ? 'every task passed'
    : attempt.verdict === 'failed'
      ? `a check failed — ${oneLine(attempt.reason)}`
      : `refused — ${oneLine(attempt.error ?? attempt.reason ?? 'no score was read')}`
  const lines = [`- ${attempt.id} (round ${attempt.round}, depth ${attempt.depth ?? 0}${attempt.best ? ', best' : ''}): value ${attempt.value}, ${verdict}`]
  const changed = await changedText(attempt)
  if (changed) lines.push(`  changed ${changed}`)
  if (attempt.report) lines.push(`  report: ${oneLine(attempt.report)}`)
  if (attempt.measures && Object.keys(attempt.measures).length) lines.push(`  measures ${JSON.stringify(attempt.measures)}`)
  return trim(lines.join('\n'), room)
}

/** The files an attempt's patch touched and the lines it added and removed, as one line. */
async function changedText(attempt) {
  const patch = await fs.readFile(attempt.patchFile, 'utf8').catch(() => null)
  if (!patch) return null
  const summary = patchSummary(patch)
  if (!summary.files.length && !summary.added && !summary.removed) return null
  const named = summary.files.slice(0, 6).join(', ')
  const more = summary.files.length > 6 ? ` and ${summary.files.length - 6} more` : ''
  return `${named || 'files'} (+${summary.added} -${summary.removed})${more}`
}

/**
 * What a patch changed: the files it names and the lines it adds and removes.
 *
 * The patch itself stays in the round's directory. A record keeps this summary
 * so a reader can tell what an attempt produced without opening the whole diff.
 */
export function patchSummary(patch) {
  const files = new Set()
  let added = 0
  let removed = 0
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const name = line.slice(4).trim().replace(/^[ab]\//, '')
      if (name && name !== '/dev/null') files.add(name)
      continue
    }
    if (line.startsWith('+')) added++
    if (line.startsWith('-')) removed++
  }
  return { files: [...files], added, removed }
}

/** Text cut to fit, on a line boundary, marked as cut. */
function trim(text, room) {
  if (text.length <= room) return text
  const cut = text.slice(0, Math.max(0, room - 2))
  const at = cut.lastIndexOf('\n')
  return `${(at > 0 ? cut.slice(0, at) : cut).trimEnd()} …`
}

/** One line of text, with the report's own lines kept apart. */
function oneLine(text) {
  return String(text ?? '').trim().split(/\s*\n\s*/).filter(Boolean).join(' / ')
}

/**
 * The engine's instruction packet for this target, as text the prompt carries.
 *
 * A candidate that is handed no packet rediscovers the checkout by writing its
 * own probe scripts, which spends its budget on work the engine already did.
 * A packet that fails to build is reported in place of the rules, so the
 * attempt still runs and the record says what was missing.
 */
function packetText(checkout, target, files) {
  try {
    const output = execFileSync(
      process.execPath,
      ['bin/engine.mjs', 'agent.context', JSON.stringify({ task: String(target), files })],
      { cwd: checkout, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 }
    )
    const envelope = JSON.parse(output)
    return envelope.text ?? output
  } catch (error) {
    return `The packet could not be built: ${String(error?.message || error).slice(0, 200)}`
  }
}

/** What one candidate's agent is told: the target, the limits, and the score so far. */
async function candidatePrompt({ checkout, runDirectory, setup, workspace, target, files, history }) {
  const template = await fs.readFile(path.join(checkout, 'tools/dream/prompts/candidate.md'), 'utf8')
  const measures = setup.tasks
    .map(task => `- ${task.id}${task.holdout ? ' (holdout)' : ''}: ${task.question}`)
    .join('\n')
  const weights = Object.entries(setup.weights ?? {})
    .map(([measure, weight]) => `${weight} per ${measure}${weight < 0 ? ' (quality gain)' : ''}`)
    .join(', ')

  const filled = template
    .replaceAll('{{TARGET}}', String(target))
    .replaceAll('{{RUN_DIR}}', path.relative(checkout, runDirectory).split(path.sep).join('/'))
    .replaceAll('{{OBJECTIVE}}', setup.objective ?? 'a higher value is a better target')
    // Absolute, because the command is run from the candidate's own worktree,
    // and a run directory is inside the checkout the worktree branches from and
    // therefore not present in it.
    .replaceAll('{{SETUP}}', path.join(runDirectory, 'setup.mjs'))
    .replaceAll('{{PROJECT}}', setup.project)
    .replaceAll('{{WORKSPACE}}', workspace)
    .replaceAll('{{FILES}}', files.length ? files.map(file => `- \`${file}\``).join('\n') : '- The files the target lives in. Find them; the target names no file.')
    .replaceAll('{{MEASURES}}', `${measures}\n\nWeights: ${weights || 'none declared'}`)
    .replaceAll('{{PACKET}}', packetText(checkout, target, files))

  // The packet is inside `filled`, so it is counted before the history is sized:
  // what the fixed part does not use is all the history may have, up to its own
  // cap and never below one attempt's entry.
  const fixed = filled.length - '{{HISTORY}}'.length
  const budget = Math.max(HISTORY_FLOOR_CHARACTERS, Math.min(HISTORY_BLOCK_CHARACTERS, PROMPT_BUDGET_CHARACTERS - fixed))
  return filled.replaceAll('{{HISTORY}}', await historyLines({ runDirectory, history, budget }))
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
  round = 1,
  id,
  target,
  files = [],
  history = [],
  parent = null,
  depth = 0,
  timeoutSeconds = DEFAULT_CANDIDATE_TIMEOUT_SECONDS,
  model,
  harness = DEFAULT_HARNESS
} = {}) {
  // The round is part of the name: attempt numbers restart every round, and two
  // candidates answering to one id would draw on top of each other in the tree
  // and be mistaken for each other in the record.
  const name = `${id}-r${round}c${attempt}`
  const record = {
    id: name,
    attempt,
    parent: parent?.id ?? 'target',
    depth: (parent?.depth ?? 0) + 1,
    status: 'failed',
    value: 0,
    verdict: 'refused',
    evaluated: false,
    valid: false,
    nValid: 0,
    nTotal: 0,
    failClass: 'harness',
    error: null,
    reason: null,
    measures: null,
    diagnostics: null,
    changes: null,
    tokens: null,
    sessionDirectory: null,
    cost: null,
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
      harnessWrapper(checkout, harness),
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
      // The transcript's directory is kept so a cost can be recomputed against a
      // new price table without rerunning the candidate.
      record.sessionDirectory = envelope.sessionDir ?? null
      record.cost = costBands(record.tokens)
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
      record.evaluated = score.evaluated
      record.valid = score.valid
      record.nValid = score.nValid
      record.nTotal = score.nTotal
      record.failClass = score.failClass
      record.error = score.error
      record.measures = score.totals?.measures ?? null
      // The paper's node carries the evaluation diagnostics, not only the score:
      // which check failed, and what each one measured. Replay reads them.
      record.diagnostics = { suite: score.suite, tasks: score.tasks, totals: score.totals }
      record.reason = score.reason
    }

    // A worktree whose files changed but whose index knows nothing of them
    // would diff empty, so the patch is taken against the intent-to-add index.
    record.patch = patchOf(made.workspace)
    record.changes = record.patch ? patchSummary(record.patch) : null
  } catch (error) {
    record.reason = record.reason ?? `the attempt threw — ${error?.message || error}`
  } finally {
    record.durationMs = Date.now() - started
    removeWorktree(checkout, name)
  }

  return record
}

export { CHECKOUT, DEFAULT_CANDIDATE_TIMEOUT_SECONDS }
