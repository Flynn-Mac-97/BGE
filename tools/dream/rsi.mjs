/**
 * The Dream-RSI loop: explore online, freeze the grid, dream, redeploy.
 *
 * This is the paper's figure 1 in code. One round is:
 *
 *   1. plan a grid — how many branches and how deep, from what earlier rollouts
 *      did, never from this round's outcomes, because how wide to work is a
 *      decision about the next rollout;
 *   2. explore online — the current policy names batches, every cell in a batch
 *      becomes a real attempt, and the outcomes build a grid;
 *   3. construct a simulator — the grid joins the pool, and the pool is frozen
 *      for the dreaming phase that follows;
 *   4. dream — the policy is revised M times, every version replayed over every
 *      grid in the pool, and the best average reward is selected;
 *   5. redeploy — the selected policy drives the next round, and the pool grows.
 *
 * Only step 2 costs anything. That is the whole argument of the paper: the
 * expensive work happens once, and every policy tried afterwards is scored by
 * reading what that work recorded.
 *
 * The loop never lands a change. It proposes a patch; applying it is a separate
 * decision.
 *
 * Usage: node tools/dream/rsi.mjs --target "<what to improve>" [--rounds 2] [--versions 3]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyGrid, gridFromRun } from './grid.mjs'
import { addGrid, readPool, poolSummary } from './pool.mjs'
import { dreamPolicies, BETA_GRID } from './dreaming.mjs'
import { loadPolicy, makePolicy } from './policy.mjs'
import { planFromHistory, gridPlan } from './policy-api.mjs'
import { realAttempt, rolloutOnce } from './rollout.mjs'
import { costBands, sumCosts } from './pricing.mjs'
import { loadSetup } from './scoring.mjs'
import { CHECKOUT, designSetup, preflight, recordSetupCheck, startRun, verifySetup } from './setup.mjs'
import { renderReport } from './report.mjs'

/** Rounds of explore-dream-redeploy. */
const DEFAULT_ROUNDS = 2

/** Branches a grid may be planned with, before the runner's caps. */
const HARD_MAX_BRANCH_COUNT = 4

/** Refinements a branch may be planned with. */
const HARD_MAX_REFINE_COUNT = 4

/** How many workers a batch may fill. */
const DEFAULT_MAX_PARALLELISM = 3

/** Where a round's records go. */
const roundDirectory = (runDirectory, round) => path.join(runDirectory, 'rsi', `round-${String(round).padStart(3, '0')}`)

/**
 * The plan for one round, from the rounds before it.
 *
 * `bestAttempt` is the attempt index of the best cell in the last grid, which is
 * what tells `planFromHistory` whether gains are arriving early or late.
 */
export function planRound({ history, fallback = { branchCount: 2, refineCount: 2 }, fixed = null }) {
  // A pinned plan bounds what a first run costs: the number of attempts a round
  // can make is the number of cells, and that is the expensive part.
  if (fixed) return gridPlan({ branchCount: fixed.branchCount, refineCount: fixed.refineCount, reason: 'pinned for this run, so its cost is bounded in advance' })
  return planFromHistory({ history, fallback, hardMaxBranchCount: HARD_MAX_BRANCH_COUNT, hardMaxRefineCount: HARD_MAX_REFINE_COUNT })
}

/**
 * Fill a pool from runs that already recorded attempts.
 *
 * The paper's claim is about accumulated discovery history, not about one
 * rollout: a policy is judged on the pool, so a pool of one grid makes the first
 * dreaming phase a comparison against nothing. Earlier runs in this checkout are
 * real recorded attempts, and this run's own rounds count too.
 *
 * A run whose records are empty, or whose setup was never checked, contributes
 * nothing — `addGrid` refuses an empty grid, and that refusal is the answer, not
 * an error to report.
 */
export async function seedPool({ checkout, runDirectory, limit = 3 }) {
  const runs = path.join(checkout, 'agent-runs')
  const names = (await fs.readdir(runs).catch(() => [])).filter(name => name.startsWith('dream-')).sort()
  const seeded = []

  for (const name of names.slice(-limit)) {
    const directory = path.join(runs, name)
    if (path.resolve(directory) === path.resolve(runDirectory)) continue
    const converted = await gridFromRun(directory, { branchCount: HARD_MAX_BRANCH_COUNT })
    if (converted.error || !converted.grid) continue
    const added = await addGrid(runDirectory, converted.grid)
    if (!added.error) seeded.push({ run: name, attempts: converted.attempts, pool: added.file })
  }

  // This run's own evolutionary records, when it has any: a run that already
  // tried attempts has a grid worth dreaming in before its first RSI round.
  const own = await gridFromRun(runDirectory, { branchCount: HARD_MAX_BRANCH_COUNT })
  if (!own.error && own.grid && own.attempts > 0) {
    const added = await addGrid(runDirectory, own.grid)
    if (!added.error) seeded.push({ run: path.basename(runDirectory), attempts: own.attempts, pool: added.file })
  }

  return seeded
}

/** The attempt index of the best scored cell in a grid, or null. */
export function bestAttemptOf(grid) {
  const scored = Object.values(grid.cells)
    .filter(cell => typeof cell.outcome?.score === 'number')
    .sort((left, right) => right.outcome.score - left.outcome.score)
  return scored.length ? scored[0].attempt : null
}

/**
 * Run one target through the whole loop.
 *
 * A setup is designed and checked first when the run has none, so the loop has
 * something frozen to score against. Every round then follows the same three
 * stages, and the policy a round starts with is the one the last round's
 * dreaming phase deployed.
 */
export async function rsiRun({
  checkout = CHECKOUT,
  target,
  runDirectory = null,
  rounds = DEFAULT_ROUNDS,
  versions = 3,
  betas = BETA_GRID,
  lambda = 0.5,
  maxParallelism = DEFAULT_MAX_PARALLELISM,
  timeoutSeconds,
  model,
  attempt = null,
  revise = undefined,
  fixedPlan = null,
  seed = 0
} = {}) {
  // The clean-baseline guard is about real candidates: each one is a worktree
  // branched from HEAD, so work that is not committed is work it cannot see. An
  // injected attempt makes no worktree, so the guard would refuse a run that
  // touches nothing — and would make the loop untestable without committing.
  if (!attempt) {
    const ready = preflight(checkout)
    if (ready.error) return { error: ready.error }
  }

  let directory = runDirectory
  if (!directory) {
    const started = await startRun({ checkout, target })
    directory = started.runDirectory
  }

  const writeStatus = async status => {
    const file = path.join(directory, 'rsi.json')
    const before = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'))
    const record = { ...(before ?? {}), ...status, pid: process.pid, at: new Date().toISOString() }
    await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    return record
  }

  await writeStatus({ phase: 'setup', target, round: 0 })

  // A stop file outlives the process it was meant for. Left in place it turns a
  // fresh run into a silent no-op that exits 0 — which reads as success. So it is
  // named here and the run is refused, rather than doing nothing politely.
  const stopFile = path.join(directory, 'stop')
  if (await fs.access(stopFile).then(() => true, () => false)) {
    const why = `a stop file is already in this run directory, from an earlier stop request: remove ${stopFile} to run again`
    await writeStatus({ phase: 'refused', why })
    return { runDirectory: directory, error: why }
  }

  const setupPath = path.join(directory, 'setup.mjs')
  if (!(await fs.access(setupPath).then(() => true, () => false))) {
    const design = await designSetup({ checkout, runDirectory: directory, target, timeoutSeconds, model })
    await fs.writeFile(path.join(directory, 'design.json'), `${JSON.stringify(design, null, 2)}\n`, 'utf8')
    if (!design.ok) {
      await writeStatus({ phase: 'setup-failed', why: `the design agent did not finish: ${design.status}` })
      return { runDirectory: directory, error: `the design agent did not finish: ${design.status}`, design }
    }
    const check = await verifySetup({ checkout, runDirectory: directory })
    await fs.writeFile(path.join(directory, 'setup-check.raw.json'), `${JSON.stringify(check, null, 2)}\n`, 'utf8')
    if (!check.ok) {
      await writeStatus({ phase: 'setup-failed', why: check.reason })
      return { runDirectory: directory, error: check.reason, design, check }
    }
    await recordSetupCheck(directory, check, setupPath)
  }

  const loaded = await loadSetup(setupPath)
  if (loaded.error) {
    await writeStatus({ phase: 'setup-failed', why: loaded.error })
    return { runDirectory: directory, error: loaded.error }
  }
  const { setup } = loaded
  const checkRecord = JSON.parse(await fs.readFile(path.join(directory, 'setup-check.json'), 'utf8'))
  const targetRecord = JSON.parse(await fs.readFile(path.join(directory, 'target.json'), 'utf8'))
  const targetText = target ?? targetRecord.target
  const baseline = { value: checkRecord.working.value, measures: checkRecord.working.totals?.measures ?? {} }

  // The attempt a rollout makes. Real by default: a worktree, an agent and a
  // score. Injectable so the loop can be exercised without spending anything.
  const makeAttempt = attempt ?? realAttempt({
    checkout,
    runDirectory: directory,
    setup,
    target: targetText,
    files: targetRecord.files ?? [],
    setupHash: checkRecord.digest,
    timeoutSeconds,
    model
  })

  const policyDirectory = path.join(directory, 'policy')
  const history = []
  const spent = []
  const record = {
    target: targetText,
    baseline,
    setup: { name: setup.name, digest: checkRecord.digest },
    rounds: [],
    startedAt: new Date().toISOString()
  }

  // Seeding happens once. On a resume the pool already holds the grids it was
  // given, and seeding again would double every grid it lists.
  if (seed > 0 && (await readPool(directory)).length === 0) {
    record.seeded = await seedPool({ checkout, runDirectory: directory, limit: seed })
  }

  let stopped = false
  for (let round = 1; round <= rounds; round++) {
    if (await fs.access(path.join(directory, 'stop')).then(() => true, () => false)) {
      stopped = true
      await writeStatus({ phase: 'stopped', round: round - 1 })
      break
    }

    const plan = planRound({ history, fallback: { branchCount: 2, refineCount: 2 }, fixed: fixedPlan })
    if (plan.error) {
      await writeStatus({ phase: 'plan-failed', why: plan.error })
      return { runDirectory: directory, error: plan.error }
    }

    // The policy this round plays: the one dreaming deployed last round, or the
    // shipping one for the first round.
    const currentPolicyFile = path.join(policyDirectory, 'current.mjs')
    const hasPolicy = await fs.access(currentPolicyFile).then(() => true, () => false)
    const policy = hasPolicy
      ? (await loadPolicy(currentPolicyFile)).policy
      : makePolicy('parallel-refine', 0.6)
    if (!policy) {
      await writeStatus({ phase: 'policy-failed', round })
      return { runDirectory: directory, error: `the deployed policy at ${currentPolicyFile} will not load` }
    }

    await writeStatus({ phase: 'exploring', round, plan, policy: policy.NAME })

    const grid = emptyGrid({
      id: `${path.basename(directory)}-r${round}`,
      target: targetText,
      baseline,
      branchCount: plan.branchCount,
      refineCount: plan.refineCount
    })

    const rollout = await rolloutOnce({ grid, policy, maxParallelism, attempt: makeAttempt })
    for (const made of rollout.records) {
      if (made.record?.cost) spent.push(made.record.cost)
      else if (made.record?.tokens) spent.push(costBands(made.record.tokens))
    }

    const added = await addGrid(directory, grid)
    if (added.error) {
      await writeStatus({ phase: 'pool-failed', round, why: added.error })
      return { runDirectory: directory, error: added.error }
    }

    await fs.mkdir(roundDirectory(directory, round), { recursive: true })
    const roundRecord = {
      round,
      plan,
      policy: { name: policy.NAME, beta: policy.beta ?? null },
      rollout: { probes: rollout.probes, rounds: rollout.rounds, attained: rollout.attained, failure: rollout.failure, durationMs: rollout.durationMs },
      pool: added,
      grid: path.relative(checkout, path.join(directory, 'pool', path.basename(added.file))).split(path.sep).join('/')
    }
    await fs.writeFile(path.join(roundDirectory(directory, round), 'rollout.json'), `${JSON.stringify(roundRecord, null, 2)}\n`, 'utf8')

    await writeStatus({ phase: 'dreaming', round, policy: policy.NAME, pool: poolSummary(await readPool(directory)) })

    const dreamed = await dreamPolicies({
      checkout,
      runDirectory: directory,
      versions,
      betas,
      maxParallelism,
      lambda,
      startPolicyFile: hasPolicy ? currentPolicyFile : null,
      ...(revise ? { revise } : { timeoutSeconds, model })
    })
    if (dreamed.error) {
      await writeStatus({ phase: 'dreaming-failed', round, why: dreamed.error })
      return { runDirectory: directory, error: dreamed.error, rounds: record.rounds }
    }

    roundRecord.dreaming = {
      pool: dreamed.pool,
      versions: dreamed.versions.map(version => ({ version: version.version, policy: version.policy, score: version.score, failure: version.failure ?? null, degenerate: version.degenerate })),
      winner: dreamed.winner,
      improved: dreamed.improved,
      gain: dreamed.gain,
      deployed: dreamed.deployed
    }
    await fs.writeFile(path.join(roundDirectory(directory, round), 'dreaming.json'), `${JSON.stringify(roundRecord.dreaming, null, 2)}\n`, 'utf8')
    record.rounds.push(roundRecord)

    history.push({
      round,
      plannedBranchCount: plan.branchCount,
      plannedRefineCount: plan.refineCount,
      bestAttempt: bestAttemptOf(grid),
      attained: rollout.attained,
      policy: dreamed.winner ? dreamed.winner.file : null,
      policyScore: dreamed.winner ? dreamed.winner.score : null
    })

    await writeStatus({
      phase: 'running',
      round,
      pool: poolSummary(await readPool(directory)),
      policy: dreamed.winner?.file ?? null,
      best: history[history.length - 1]
    })
  }

  // The winner is the best attempted version across every grid this run made.
  const grids = await readPool(directory)
  let best = null
  for (const grid of grids) {
    for (const [id, cell] of Object.entries(grid.cells ?? {})) {
      if (typeof cell.outcome?.score !== 'number') continue
      if (!best || cell.outcome.score > best.score) {
        best = { grid: grid.id, cell: id, score: cell.outcome.score, patchPath: cell.patchPath ?? null, measures: cell.outcome.measures ?? null }
      }
    }
  }

  record.pool = poolSummary(grids)
  record.best = best
  record.baseline = baseline
  record.improvement = best ? Number((best.score - baseline.value).toFixed(6)) : 0
  record.cost = sumCosts(spent)
  record.policies = history

  if (best?.patchPath) {
    await fs.copyFile(best.patchPath, path.join(directory, 'winner.patch'))
    record.winnerPatch = 'winner.patch'
  }

  await fs.writeFile(path.join(directory, 'rsi-summary.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  await writeStatus({ phase: stopped ? 'stopped' : 'done', pool: record.pool, best })
  await renderReport(directory)
  return { runDirectory: directory, ...record }
}

// Run directly: one target through the whole loop.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argument = name => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : undefined
  }
  const target = argument('target')
  const runDirectory = argument('run')
  if (!target && !runDirectory) {
    process.stderr.write('usage: node tools/dream/rsi.mjs --target "<what to improve>" [--rounds 2] [--versions 3]\n')
    process.exit(2)
  }

  const result = await rsiRun({
    target,
    runDirectory: runDirectory ? path.resolve(runDirectory) : null,
    rounds: Number(argument('rounds') ?? DEFAULT_ROUNDS),
    versions: Number(argument('versions') ?? 3),
    maxParallelism: Number(argument('parallelism') ?? DEFAULT_MAX_PARALLELISM),
    lambda: argument('lambda') ? Number(argument('lambda')) : 0.5,
    timeoutSeconds: argument('timeout') ? Number(argument('timeout')) : undefined,
    model: argument('model'),
    seed: Number(argument('seed') ?? 0),
    // Pinning the plan is how a first run keeps its cost knowable: cells are
    // attempts, and attempts are the expensive part.
    fixedPlan: argument('branches') || argument('refinements')
      ? { branchCount: Number(argument('branches') ?? 2), refineCount: Number(argument('refinements') ?? 1) }
      : null
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.error ? 1 : 0
}

export { CHECKOUT, DEFAULT_ROUNDS, DEFAULT_MAX_PARALLELISM, HARD_MAX_BRANCH_COUNT, HARD_MAX_REFINE_COUNT }
