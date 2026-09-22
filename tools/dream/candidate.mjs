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

/** One attempt's entry is cut here, so its report cannot fill the whole block. */
const HISTORY_ENTRY_CHARACTERS = 1600

/** The block keeps a place for at least one attempt even when the packet has taken the rest. */
const HISTORY_FLOOR_CHARACTERS = 1200

/** Below this there is room for nothing useful, so the block stops rather than stubbing entries. */
const HISTORY_ENTRY_MINIMUM_CHARACTERS = 240

/**
 * What earlier attempts did, as text the prompt carries.
 *
 * The paper gives a rollout the completed history rather than a summary of it,
 * so each entry keeps the attempt's own report, the files its patch changed and
 * the evaluator's measures. The block is capped: the records stay on disk, and a
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
    const note = `- ${omitted} earlier attempt${omitted === 1 ? '' : 's'} left out to keep this prompt small; their records are under the run's round directories.`
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

/**
 * Every candidate record a run has written, with the round it was made in.
 *
 * Three layouts: the evolutionary loop writes one JSON per candidate under
 * `rounds/r####/`; the Dream-RSI loop writes one per attempt under
 * `rsi/round-###/`; and an older RSI run has only the round's `attempts.json`
 * beside separate patches. Reading all three is what connects an RSI attempt to
 * the next candidate's history, including the attempts already made this round,
 * and keeps a resumed run's earlier history visible after the per-attempt
 * record became the norm.
 */
async function readAttempts(runDirectory) {
  const attempts = []
  const seen = new Set()
  const rounds = path.join(runDirectory, 'rounds')
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

  const rsi = path.join(runDirectory, 'rsi')
  const rsiRounds = (await fs.readdir(rsi).catch(() => [])).filter(name => /^round-\d+$/.test(name)).sort()
  for (const directory of rsiRounds) {
    const round = Number(directory.replace(/^round-/, ''))
    for (const file of (await fs.readdir(path.join(rsi, directory)).catch(() => [])).sort()) {
      // Only an attempt record; the round's grid, rollout, dreaming and attempts
      // summary sit beside it and are not attempts themselves.
      if (!/^rsi-b\d+-r\d+c\d+\.json$/.test(file)) continue
      const record = JSON.parse(await fs.readFile(path.join(rsi, directory, file), 'utf8').catch(() => 'null'))
      if (!record) continue
      if (record.id) seen.add(record.id)
      attempts.push({ ...record, round, patchFile: record.patchFile ? path.join(runDirectory, record.patchFile) : null })
    }
  }

  // A run that predates the per-attempt record has only the round's summary and
  // separate patches. Read those entries too, skipping any the loop above
  // already has, so an old run's history is not invisible.
  for (const directory of rsiRounds) {
    const round = Number(directory.replace(/^round-/, ''))
    const summary = JSON.parse(await fs.readFile(path.join(rsi, directory, 'attempts.json'), 'utf8').catch(() => 'null'))
    if (!Array.isArray(summary)) continue
    for (const entry of summary) {
      const parsed = /^(\d+):(\d+)$/.exec(String(entry.cell ?? ''))
      if (!parsed) continue
      const branch = Number(parsed[1])
      const attempt = Number(parsed[2])
      const id = entry.id ?? rsiAttemptId(round, branch, attempt)
      if (seen.has(id)) continue
      seen.add(id)
      attempts.push({
        ...entry,
        id,
        round,
        depth: entry.depth ?? attempt + 1,
        parent: entry.parent ?? (attempt === 0 ? 'target' : rsiAttemptId(round, branch, attempt - 1)),
        patchFile: entry.patch ? path.join(runDirectory, rsiPatchFile(round, branch, attempt)) : null
      })
    }
  }
  return attempts
}

/** The candidate id an RSI attempt's record uses, from its round and cell. */
const rsiAttemptId = (round, branch, attempt) => `rsi-b${branch}-r${round}c${attempt + 1}`

/** Where an RSI attempt's patch is kept, run-relative. */
const rsiPatchFile = (round, branch, attempt) => path.join('rsi', `r${String(round).padStart(3, '0')}-b${branch}a${attempt}.patch`)

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
  // The evolutionary loop marks the kept candidate. An RSI record carries no
  // such mark, so the highest-scoring attempt stands in for it and the line
  // leading to that attempt is read first either way.
  const scored = attempts.filter(attempt => attempt.verdict === 'scored' && typeof attempt.value === 'number')
  const best = attempts.filter(attempt => attempt.best === true)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0) || (right.depth ?? 0) - (left.depth ?? 0))[0]
    ?? scored.sort((left, right) => right.value - left.value || (right.depth ?? 0) - (left.depth ?? 0))[0]
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
 * One attempt as text: what it changed, what the evaluator measured, and what
 * its agent reported. The measures come before the report, so a long report
 * cannot hide the evaluator's own numbers.
 */
async function attemptText(attempt, room) {
  const verdict = attempt.verdict === 'scored'
    ? 'every task passed'
    : attempt.verdict === 'failed'
      ? `a check failed — ${oneLine(attempt.reason)}`
      : `refused — ${oneLine(attempt.error ?? attempt.reason ?? 'no score was read')}`
  // A cut-off attempt keeps its patch and its measures. Naming the status stops a
  // later candidate from reading its unfinished report as a measured result.
  const cut = attempt.status && attempt.status !== 'completed' ? `, status ${attempt.status}` : ''
  const lines = [`- ${attempt.id} (round ${attempt.round}, depth ${attempt.depth ?? 0}${attempt.best ? ', best' : ''}${cut}): value ${attempt.value}, ${verdict}`]
  const changed = await changedText(attempt)
  if (changed) lines.push(`  changed ${changed}`)
  if (attempt.measures && Object.keys(attempt.measures).length) lines.push(`  measures ${JSON.stringify(attempt.measures)}`)
  if (attempt.report) lines.push(`  report: ${oneLine(attempt.report)}`)
  return trim(lines.join('\n'), room)
}

/** The files an attempt's patch touched and the lines it added and removed, as one line. */
async function changedText(attempt) {
  if (!attempt.patchFile) return null
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

/**
 * Text cut to fit, marked as cut.
 *
 * The cut is at a character, not a line: `oneLine` writes a report as one line,
 * and a line-boundary cut dropped a report whole when it overflowed the entry by
 * a few characters, which is how the measured finding was lost from a live run.
 */
function trim(text, room) {
  if (text.length <= room) return text
  return `${text.slice(0, Math.max(0, room - 2)).trimEnd()} …`
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
      { cwd: checkout, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }
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
  const fixed = filled.length - '{{HISTORY}}'.length - '{{PROBE}}'.length
  const budget = Math.max(HISTORY_FLOOR_CHARACTERS, Math.min(HISTORY_BLOCK_CHARACTERS, PROMPT_BUDGET_CHARACTERS - fixed))
  return filled
    .replaceAll('{{HISTORY}}', await historyLines({ runDirectory, history, budget }))
    .replaceAll('{{PROBE}}', await probeText(runDirectory, setup.project))
}

/**
 * The quick-probe instruction, or nothing when the setup does not price frames.
 *
 * Read from the frozen setup's own text: a setup that calls `browserFrames`
 * measures what a frame costs, so its candidates get the probe. Every other
 * target gets an empty section rather than guidance its task cannot use.
 */
export async function probeText(runDirectory, project) {
  const setup = await fs.readFile(path.join(runDirectory, 'setup.mjs'), 'utf8').catch(() => '')
  if (!setup.includes('browserFrames')) return ''
  return `## Measuring a frame cost quickly

If your target is what a frame costs to draw, do not write a browser probe; this
checkout already carries one:

\`\`\`
node tools/dream/quick-probe.mjs --project "${project}" --level <level the task names> [--profile <file>]
\`\`\`

It starts the same hidden browser the evaluator uses, samples a short warm run,
and prints \`cpuMs\`, \`frameMs\`, \`gpuMs\`, draw calls and triangles, the paths it
measured, and any problem — about a minute, where the full setup takes several.
\`--profile\` also writes a Chrome CPU profile of the sampled frames, so a hotspot
can be named rather than guessed. The probe is exploratory: the frozen setup
decides the score, and a playing-picture check decides the picture. Carry the
numbers you measured and the ideas you rejected into your report; they are what
the next attempt reads instead of repeating your probe.`
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
    // The prompt goes to the harness as a file: Windows caps a command line at
    // about 32767 characters, well under the prompt budget.
    const promptPath = path.join(runDirectory, `${name}.prompt.txt`)
    await fs.writeFile(promptPath, prompt, 'utf8')
    args.push('--task-file', promptPath)

    const run = spawnSync(process.execPath, args, { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
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
