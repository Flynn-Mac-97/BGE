/**
 * The dreaming phase: improve the policy over recorded grids, without touching
 * the engine.
 *
 * This is the paper's third stage. The pool is frozen; a development agent
 * revises the policy code; every version is replayed over every grid in the pool
 * and scored by the sweep; the highest valid reward is selected, the incumbent
 * included, and becomes the policy the next online rollout is driven by.
 *
 * The order matters and is the paper's. Revisions are made against a frozen
 * pool, so the score of version 3 and the score of version 7 mean the same thing.
 * If the pool grew between them, a version could win by having an easier grid.
 *
 * Nothing here runs an attempt. The only agent called is the policy-development
 * agent, and it edits one file. That is the whole point of the stage: the
 * expensive part — trying attempts — happened once, online, and is now read.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionTokens } from './measures.mjs'
import { costBands, sumCosts } from './pricing.mjs'
import { loadPolicy, policySource } from './policy.mjs'
import { replaySweep, scorePolicy } from './replay.mjs'
import { DEFAULT_HARNESS, harnessWrapper } from './harness.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** How many versions a dreaming phase writes, including the one it starts from. */
const DEFAULT_VERSIONS = 3

/** The betas the evaluator sweeps, as the paper's prompt describes. */
export const BETA_GRID = [0, 0.25, 0.5, 0.75, 1]

/** How long one revision agent may take, in seconds. */
const DEFAULT_REVISION_TIMEOUT_SECONDS = 900

/** How many replay rounds per grid the prompt carries. */
const TRACE_ROUNDS = 12

/**
 * Budget for the earlier revisions in the prompt: the last few, with a short
 * report each.
 *
 * The counts are capped so the prompt cannot grow with the number of revisions,
 * a cost every later revision would pay.
 */
const HISTORY_LIMIT = 4
const HISTORY_REPORT_CHARS = 400

/**
 * One earlier version, reduced to what the next revision needs: what it changed
 * and what the sweep gave it. Its route is dropped; the route that decides the
 * next change is the last version's, which the prompt carries in full.
 */
function earlierVersion(version) {
  return {
    version: version.version,
    policy: version.policy,
    score: version.score,
    bestBeta: version.bestBeta,
    failure: version.failure ?? null,
    said: version.revision?.said ?? ''
  }
}

/** The earlier-revision lines, oldest first, cut to HISTORY_LIMIT versions. */
function earlierRevisionLines(versions) {
  if (!versions.length) return ['(none — this is the first revision)']
  const lines = []
  for (const version of versions.slice(-HISTORY_LIMIT)) {
    const score = typeof version.score === 'number' ? version.score : 'none'
    const beta = typeof version.bestBeta === 'number' ? `, best at beta ${version.bestBeta}` : ''
    lines.push(`- version ${version.version}: score ${score}${beta}${version.failure ? `, FAILED: ${version.failure}` : ''}`)
    const said = String(version.said ?? '').trim()
    if (version.version === 0) lines.push('  started the phase; no revision was applied')
    else if (said) lines.push(`  changed: ${said.slice(0, HISTORY_REPORT_CHARS)}`)
    else lines.push('  changed: (the reviser reported nothing)')
  }
  return lines
}

/**
 * What the revising agent is told: the route the last version took, what earlier
 * revisions changed and scored, the source, and the file it writes.
 *
 * The paper hands the development agent the current trajectories together with
 * feedback from earlier revisions, so a change that already lost is not made
 * again. Both are cut to a fixed budget rather than dumped: a trace of every
 * probe on every grid is thousands of lines, and an agent that cannot see the
 * shape of what happened will not improve the policy that produced it.
 */
export async function revisionPrompt({ checkout, runDirectory, policyFile, source, replay, history = [] }) {
  const template = await fs.readFile(path.join(checkout, 'tools/dream/prompts/policy.md'), 'utf8')
  const lines = [
    'Earlier revisions, newest last, with what each changed and scored:',
    ...earlierRevisionLines(history),
    '',
    'The route the last version took:'
  ]
  for (const point of replay.points) {
    lines.push(`### beta ${point.beta}: mean reward ${point.reward}`)
    for (const grid of point.replays) {
      lines.push(`- grid ${grid.grid}: reward ${grid.reward}, quality ${grid.quality}, probes ${grid.probes}, rounds ${grid.rounds}, `
        + `bonus ${grid.parallelBonus}${grid.failure ? `, FAILED: ${grid.failure}` : ''}`)
      for (const round of grid.trace.slice(0, TRACE_ROUNDS)) {
        lines.push(`  - round ${round.round}: probed ${round.batch.join(', ')} → attainment ${round.attainment}`)
      }
      if (grid.trace.length > TRACE_ROUNDS) lines.push(`  - … ${grid.trace.length - TRACE_ROUNDS} more rounds`)
    }
  }

  return template
    .replaceAll('{{POLICY_FILE}}', path.relative(checkout, policyFile).split(path.sep).join('/'))
    .replaceAll('{{RUN_DIR}}', path.relative(checkout, runDirectory).split(path.sep).join('/'))
    .replaceAll('{{REPLAY}}', lines.join('\n'))
    .replaceAll('{{SOURCE}}', source)
}

/**
 * Ask the development agent for the next version.
 *
 * The default reviser spawns one agent in the checkout with write access. It is
 * injectable so the phase can be tested without spending tokens, and so a run
 * can be driven by a scripted reviser when the point is the machinery rather
 * than the model.
 */
export async function reviseWithAgent({ checkout, runDirectory, policyFile, source, replay, history, timeoutSeconds, model, harness = DEFAULT_HARNESS }) {
  const prompt = await revisionPrompt({ checkout, runDirectory, policyFile, source, replay, history })
  // The prompt is a file, not an argument: Windows caps a command line well
  // under a revision prompt, the same limit the candidate path already avoids.
  const promptPath = `${policyFile}.prompt.txt`
  await fs.writeFile(promptPath, prompt, 'utf8')
  const args = [
    harnessWrapper(checkout, harness),
    '--json',
    '--cwd', checkout,
    '--timeout', String(timeoutSeconds ?? DEFAULT_REVISION_TIMEOUT_SECONDS),
    '--permission-mode', 'workspace-write',
    '--task-file', promptPath
  ]
  if (model) args.push('--model', model)

  const run = spawnSync(process.execPath, args, { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  let envelope = null
  try {
    envelope = JSON.parse(String(run.stdout))
  } catch {
    return { ok: false, status: 'unreadable', detail: String(run.stderr || run.error?.message || '').trim().slice(0, 300) }
  }
  return {
    ok: envelope.ok === true,
    status: envelope.status,
    text: envelope.text ?? '',
    durationMs: envelope.durationMs,
    tokens: envelope.sessionDir ? sessionTokens(envelope.sessionDir) : null
  }
}

/**
 * Which version a dreaming phase deploys.
 *
 * The highest replay score among versions that loaded and replayed without a
 * failure. The paper's candidate set includes the current policy, so version 0
 * is always in the running and a tie goes to the lower version: the selected
 * policy is never worse than the one it started from. A flat beta sweep is
 * recorded as a diagnostic, never a reason to lower the incumbent's score.
 */
export function selectVersion({ versions = [] } = {}) {
  const valid = versions.filter(version => version.valid === true && typeof version.score === 'number')
  if (!valid.length) return { winner: null, rule: 'no valid version scored' }

  const ranked = [...valid].sort((left, right) => right.score - left.score || left.version - right.version)
  return { winner: ranked[0], rule: 'highest valid replay score; a tie keeps the incumbent' }
}

/**
 * Run the dreaming phase.
 *
 * The pool is read once and held for the whole phase. Version 0 is the policy the
 * run already has, so the phase always has a baseline to beat, and the selection
 * compares versions on the same frozen grids.
 */
export async function dreamPolicies({
  checkout = CHECKOUT,
  runDirectory,
  // Names this phase's version and replay files. One run has many phases, and a
  // phase that reused the last one's file names would overwrite its records and
  // score one file while playing another.
  phase = 'phase',
  versions = DEFAULT_VERSIONS,
  betas = BETA_GRID,
  maxParallelism = 3,
  beta1 = 0.01,
  beta2 = 0.5,
  startPolicyFile = null,
  revise = reviseWithAgent,
  timeoutSeconds,
  model,
  harness = DEFAULT_HARNESS
} = {}) {
  const { readPool } = await import('./pool.mjs')
  const grids = await readPool(runDirectory)
  if (!grids.length) return { error: `no grids in ${runDirectory}/pool: there is nothing to dream in` }

  const policyDirectory = path.join(runDirectory, 'policy')
  const replayDirectory = path.join(runDirectory, 'replay')
  await fs.mkdir(policyDirectory, { recursive: true })
  await fs.mkdir(replayDirectory, { recursive: true })

  // Version 0 is the policy as it stands. It is written into this phase's own
  // file even when the run already has one, so the phase archives the policy it
  // started from rather than leaving it only under the name `current.mjs`,
  // which the phase's winner overwrites.
  const versionName = version => `${phase}-v${String(version).padStart(3, '0')}`
  const versionFile = version => path.join(policyDirectory, `${versionName(version)}.mjs`)
  const startedFrom = startPolicyFile
  let currentFile = versionFile(0)
  if (startedFrom) {
    await fs.copyFile(startedFrom, currentFile)
  } else {
    const starter = await policySource('parallel-refine', { into: policyDirectory })
    if (starter.error) return { error: starter.error }
    await fs.writeFile(currentFile, starter.source, 'utf8')
  }

  const record = {
    pool: { grids: grids.length, cells: grids.reduce((total, grid) => total + Object.keys(grid.cells).length, 0) },
    betas,
    beta1,
    beta2,
    maxParallelism,
    versions: [],
    startedAt: new Date().toISOString()
  }

  const sweeps = new Map()
  const evaluate = async (version, file) => {
    const relative = path.relative(checkout, file).split(path.sep).join('/')
    let loaded
    try {
      loaded = await loadPolicy(file)
    } catch (error) {
      loaded = { error: `the policy would not load: ${error?.message || error}` }
    }
    // A version that will not load, or whose replay throws, is invalid: its
    // score is partial and it may never win. It is recorded so the next revision
    // can read what happened, and it never aborts the phase.
    if (loaded.error) return { version, file: relative, valid: false, failure: loaded.error, score: null }
    let scored
    try {
      scored = await scorePolicy({ grids, Class: loaded.Class, instance: loaded.policy, betas, maxParallelism, beta1, beta2 })
    } catch (error) {
      return { version, file: relative, valid: false, failure: `the policy failed to run: ${error?.message || error}`, score: null }
    }
    // The whole sweep is kept in memory for the next prompt, because a revision
    // is asked to improve on a specific route, not on a number. Only the summary
    // is written to disk: the traces are large and are the input to one decision.
    sweeps.set(version, scored)
    const failures = scored.points.reduce((total, point) => total + point.failures, 0)
    return {
      version,
      file: relative,
      valid: failures === 0,
      // Kept because a run directory and the checkout can be on different
      // drives, where the relative form is an absolute path in disguise and
      // joining it back onto the checkout produces nonsense.
      absolute: file,
      policy: scored.policy,
      objective: scored.objective,
      score: scored.score,
      bestReward: scored.bestReward,
      bestBeta: scored.bestBeta,
      spread: scored.spread,
      degenerate: scored.degenerate,
      failures,
      perBeta: scored.points.map(point => ({ beta: point.beta, reward: point.reward })),
      // The traces are kept so the run's picture can draw what each version
      // reached against the probes it spent. Without them the replay is a number
      // and the reason for it is gone.
      replays: scored.points.flatMap(point => point.replays.map(replay => ({
        beta: point.beta,
        grid: replay.grid,
        // The objective travels with every number it produced. A reward scored
        // under `pareto` is not comparable with one scored under `legacy`, and a
        // record that does not say which would be compared with the wrong runs.
        objective: replay.objective,
        reward: replay.reward,
        // The coefficients that produced the reward, so a record can be
        // recomputed rather than trusted, and two runs priced differently are
        // never compared as if they were the same number.
        beta1: replay.beta1,
        beta2: replay.beta2,
        lambda: replay.lambda,
        auc: replay.auc,
        parallelPenalty: replay.parallelPenalty,
        paretoReward: replay.paretoReward,
        legacyReward: replay.legacyReward,
        attempts: replay.attempts,
        probes: replay.probes,
        rounds: replay.rounds,
        quality: replay.quality,
        parallelBonus: replay.parallelBonus,
        failure: replay.failure,
        trace: replay.trace
      })))
    }
  }

  const writeVersion = version => fs.writeFile(path.join(replayDirectory, `${versionName(version)}.json`), `${JSON.stringify(record.versions[version], null, 2)}\n`, 'utf8')

  record.versions.push(await evaluate(0, currentFile))
  await writeVersion(0)

  for (let version = 1; version < versions; version++) {
    const source = await fs.readFile(currentFile, 'utf8')
    const nextFile = versionFile(version)

    // The agent writes the next file itself. It is copied from the current one
    // first, so a revision that fails to write leaves the previous policy in
    // place rather than an empty file that would score as a broken version.
    await fs.writeFile(nextFile, source, 'utf8')
    let revision
    try {
      revision = await revise({
        checkout,
        runDirectory,
        policyFile: nextFile,
        source,
        replay: sweeps.get(version - 1) ?? { points: [] },
        // Every version scored so far, including the one being replaced: the
        // paper gives the development agent the feedback from earlier revisions,
        // and without it a failed change is invisible to the next revision.
        history: record.versions.map(earlierVersion),
        timeoutSeconds,
        model,
        harness
      })
    } catch (error) {
      // A reviser that throws must not discard a valid incumbent. The next file
      // already holds the previous policy, so this version ties it and the
      // incumbent is deployed; the failure is recorded for the next revision.
      revision = { ok: false, status: 'threw', text: `the reviser threw: ${error?.message || error}`, durationMs: 0, tokens: null }
    }

    const evaluated = await evaluate(version, nextFile)
    record.versions.push({
      ...evaluated,
      revision: revision
        ? { ok: revision.ok === true, status: revision.status ?? null, tokens: revision.tokens ?? null, durationMs: revision.durationMs ?? null, said: (revision.text ?? '').slice(0, 2000) }
        : null
    })
    await writeVersion(version)
    // The next revision starts from this one, as the paper's pi^{m+1} chain
    // does, rather than from the phase's original file.
    currentFile = nextFile
  }

  const selection = selectVersion({ versions: record.versions })
  const winner = selection.winner
  const floor = record.versions[0]

  record.winner = winner ? { version: winner.version, file: winner.file, score: winner.score, bestBeta: winner.bestBeta } : null
  record.selection = { rule: selection.rule }
  record.improved = Boolean(winner && floor && typeof floor.score === 'number' && winner.score > floor.score)
  record.gain = winner && floor && typeof floor.score === 'number' ? Number((winner.score - floor.score).toFixed(6)) : 0
  // What the revising agents cost, priced from their own transcripts so the run
  // report includes the offline half of what it spent.
  record.revisionCosts = record.versions
    .map(version => (version.revision?.tokens ? costBands(version.revision.tokens) : null))
    .filter(Boolean)
  record.cost = sumCosts(record.revisionCosts)

  if (winner) {
    // The winner is copied to one name the next rollout reads, so "which policy
    // is deployed" is answered in one place rather than by a version number. An
    // incumbent that was already loaded from `current.mjs` is that name's own
    // file, and copying it onto itself is skipped.
    const deployed = path.join(policyDirectory, 'current.mjs')
    if (path.resolve(winner.absolute) !== path.resolve(deployed)) await fs.copyFile(winner.absolute, deployed)
    record.deployed = path.relative(checkout, deployed).split(path.sep).join('/')
  }

  await fs.writeFile(path.join(runDirectory, 'dreaming.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

export { CHECKOUT, DEFAULT_VERSIONS }
