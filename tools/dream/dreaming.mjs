/**
 * The dreaming phase: improve the policy over recorded grids, without touching
 * the engine.
 *
 * This is the paper's third stage. The pool is frozen; a development agent
 * revises the policy code; every version is replayed over every grid in the pool
 * and scored by the sweep; the best average is selected and becomes the policy
 * the next online rollout is driven by.
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
import { loadPolicy, policySource } from './policy.mjs'
import { replaySweep, scorePolicy } from './replay.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** How many versions a dreaming phase writes, including the one it starts from. */
const DEFAULT_VERSIONS = 3

/** The betas the evaluator sweeps, as the paper's prompt describes. */
export const BETA_GRID = [0, 0.25, 0.5, 0.75, 1]

/** How long one revision agent may take, in seconds. */
const DEFAULT_REVISION_TIMEOUT_SECONDS = 900

/**
 * What the revising agent is told: the policy, how it scored, and the pool.
 *
 * The replayed trace is summarised rather than dumped. A trace of every probe on
 * every grid is thousands of lines, and an agent that cannot see the shape of
 * what happened will not improve the policy that produced it.
 */
async function revisionPrompt({ checkout, runDirectory, policyFile, source, replay }) {
  const template = await fs.readFile(path.join(checkout, 'tools/dream/prompts/policy.md'), 'utf8')
  const lines = []
  for (const point of replay.points) {
    lines.push(`### beta ${point.beta}: mean reward ${point.reward}`)
    for (const grid of point.replays) {
      lines.push(`- grid ${grid.grid}: reward ${grid.reward}, quality ${grid.quality}, probes ${grid.probes}, rounds ${grid.rounds}, `
        + `bonus ${grid.parallelBonus}${grid.failure ? `, FAILED: ${grid.failure}` : ''}`)
      for (const round of grid.trace.slice(0, 12)) {
        lines.push(`  - round ${round.round}: probed ${round.batch.join(', ')} → attainment ${round.attainment}`)
      }
      if (grid.trace.length > 12) lines.push(`  - … ${grid.trace.length - 12} more rounds`)
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
export async function reviseWithAgent({ checkout, runDirectory, policyFile, source, replay, timeoutSeconds, model }) {
  const prompt = await revisionPrompt({ checkout, runDirectory, policyFile, source, replay })
  const args = [
    path.join(checkout, 'tools/dsh-agent.mjs'),
    '--json',
    '--cwd', checkout,
    '--timeout', String(timeoutSeconds ?? DEFAULT_REVISION_TIMEOUT_SECONDS),
    '--permission-mode', 'workspace-write'
  ]
  if (model) args.push('--model', model)
  args.push(prompt)

  const run = spawnSync(process.execPath, args, { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
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
 * Highest average replay reward, with one exception. A version whose beta sweep
 * is flat has tied its knob to nothing: the online rollout plays exactly one
 * beta, so a policy that ignores beta cannot be steered at all. When such a
 * version wins by a margin small enough to be noise, a version that does respond
 * to its knob is deployed instead, and the record says so.
 *
 * The exception is bounded on purpose. A flat policy that wins by a real margin
 * keeps its win: the reward is the measurement, and degeneracy is a diagnostic
 * about the knob rather than a fault in the route.
 */
export function selectVersion({ versions = [], epsilon = 0.01 } = {}) {
  const scored = versions.filter(version => !version.failure && typeof version.score === 'number')
  if (!scored.length) return { winner: null, rule: 'no version scored' }

  const ranked = [...scored].sort((left, right) => right.score - left.score)
  const best = ranked[0]
  if (!best.degenerate) return { winner: best, rule: 'highest average replay reward' }

  const responsive = ranked.find(version => !version.degenerate && version.score >= best.score - epsilon)
  if (responsive) {
    return {
      winner: responsive,
      rule: `beta changes nothing in the best version, so a version that responds to it was preferred within ${epsilon}`,
      displaced: { version: best.version, score: best.score }
    }
  }
  return { winner: best, rule: 'highest average replay reward; the best version ignores beta, by a margin larger than epsilon' }
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
  versions = DEFAULT_VERSIONS,
  betas = BETA_GRID,
  maxParallelism = 3,
  beta1 = 0.01,
  beta2 = 0.5,
  degenerateEpsilon = 0.01,
  startPolicyFile = null,
  revise = reviseWithAgent,
  timeoutSeconds,
  model
} = {}) {
  const { readPool } = await import('./pool.mjs')
  const grids = await readPool(runDirectory)
  if (!grids.length) return { error: `no grids in ${runDirectory}/pool: there is nothing to dream in` }

  const policyDirectory = path.join(runDirectory, 'policy')
  const replayDirectory = path.join(runDirectory, 'replay')
  await fs.mkdir(policyDirectory, { recursive: true })
  await fs.mkdir(replayDirectory, { recursive: true })

  // Version 0 is the policy as it stands. Written from the shipping source when
  // the run has none yet, so the phase has a floor to measure against.
  const versionFile = version => path.join(policyDirectory, `v${String(version).padStart(3, '0')}.mjs`)
  let currentFile = startPolicyFile
  if (!currentFile) {
    const starter = await policySource('parallel-refine', { into: policyDirectory })
    if (starter.error) return { error: starter.error }
    currentFile = versionFile(0)
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
    const loaded = await loadPolicy(file)
    if (loaded.error) return { version, file: path.relative(checkout, file), failure: loaded.error, score: null }
    const scored = await scorePolicy({ grids, Class: loaded.Class, instance: loaded.policy, betas, maxParallelism, beta1, beta2 })
    // The whole sweep is kept in memory for the next prompt, because a revision
    // is asked to improve on a specific route, not on a number. Only the summary
    // is written to disk: the traces are large and are the input to one decision.
    sweeps.set(version, scored)
    return {
      version,
      file: path.relative(checkout, file).split(path.sep).join('/'),
      // Kept because a run directory and the checkout can be on different
      // drives, where the relative form is an absolute path in disguise and
      // joining it back onto the checkout produces nonsense.
      absolute: file,
      policy: scored.policy,
      score: scored.score,
      bestReward: scored.bestReward,
      bestBeta: scored.bestBeta,
      spread: scored.spread,
      degenerate: scored.degenerate,
      failures: scored.points.reduce((total, point) => total + point.failures, 0),
      perBeta: scored.points.map(point => ({ beta: point.beta, reward: point.reward })),
      // The traces are kept so the run's picture can draw what each version
      // reached against the probes it spent. Without them the replay is a number
      // and the reason for it is gone.
      replays: scored.points.flatMap(point => point.replays.map(replay => ({
        beta: point.beta,
        grid: replay.grid,
        reward: replay.reward,
        probes: replay.probes,
        rounds: replay.rounds,
        quality: replay.quality,
        parallelBonus: replay.parallelBonus,
        failure: replay.failure,
        trace: replay.trace
      })))
    }
  }

  record.versions.push(await evaluate(0, currentFile))
  await fs.writeFile(path.join(replayDirectory, 'v000.json'), `${JSON.stringify(record.versions[0], null, 2)}\n`, 'utf8')

  for (let version = 1; version < versions; version++) {
    const source = await fs.readFile(currentFile, 'utf8')
    const nextFile = versionFile(version)

    // The agent writes the next file itself. It is copied from the current one
    // first, so a revision that fails to write leaves the previous policy in
    // place rather than an empty file that would score as a broken version.
    await fs.writeFile(nextFile, source, 'utf8')
    const revision = await revise({
      checkout,
      runDirectory,
      policyFile: nextFile,
      source,
      replay: sweeps.get(version - 1) ?? { points: [] }
    })

    const evaluated = await evaluate(version, nextFile)
    record.versions.push({
      ...evaluated,
      revision: revision
        ? { ok: revision.ok === true, status: revision.status ?? null, tokens: revision.tokens?.totalTokens ?? null, durationMs: revision.durationMs ?? null, said: (revision.text ?? '').slice(0, 2000) }
        : null
    })
    await fs.writeFile(path.join(replayDirectory, `v${String(version).padStart(3, '0')}.json`), `${JSON.stringify(record.versions[version], null, 2)}\n`, 'utf8')
  }

  const selection = selectVersion({ versions: record.versions, epsilon: degenerateEpsilon })
  const winner = selection.winner
  const floor = record.versions[0]

  record.winner = winner ? { version: winner.version, file: winner.file, score: winner.score, bestBeta: winner.bestBeta } : null
  record.selection = { rule: selection.rule, epsilon: degenerateEpsilon, displaced: selection.displaced ?? null }
  record.improved = Boolean(winner && floor && typeof floor.score === 'number' && winner.score > floor.score)
  record.gain = winner && floor && typeof floor.score === 'number' ? Number((winner.score - floor.score).toFixed(6)) : 0
  record.cost = record.versions
    .map(version => version.revision?.tokens)
    .filter(tokens => typeof tokens === 'number')
    .reduce((total, tokens) => total + tokens, 0)

  if (winner) {
    // The winner is copied to one name the next rollout reads, so "which policy
    // is deployed" is answered in one place rather than by a version number.
    const deployed = path.join(policyDirectory, 'current.mjs')
    await fs.copyFile(winner.absolute, deployed)
    record.deployed = path.relative(checkout, deployed).split(path.sep).join('/')
  }

  await fs.writeFile(path.join(runDirectory, 'dreaming.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

export { CHECKOUT, DEFAULT_VERSIONS }
