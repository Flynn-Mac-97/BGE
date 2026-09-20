/**
 * The Dream-RSI loop: explore online, freeze the grid, dream, redeploy.
 *
 * This is the paper's figure 1 in code. One round is:
 *
 *   1. plan a grid — the policy chooses how many branches and how deep from
 *      earlier rollouts, never from this round's outcomes, because how wide to
 *      work is a decision about the next rollout. The runner uses its own
 *      history rule only when the policy has no `plan_grid`, validates the plan
 *      against the caps, and records which side chose;
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
import { renderRsiPictures } from './rsi-pictures.mjs'

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

/** Which asker a refused plan is named by, so an error says who asked. */
const PLAN_SOURCE_LABEL = {
  policy: 'the policy',
  runner: 'the runner',
  pinned: 'the pinned plan'
}

/**
 * What a policy may read before it plans a grid.
 *
 * Only prefix-safe facts: completed earlier rounds, the fallback, the hard caps,
 * the worker cap, and the replay support fields. The current round's outcomes
 * are absent, so a plan is a decision about the next rollout rather than a
 * reaction to this one.
 */
export function planContext({
  history = [],
  fallback,
  hardMaxBranchCount,
  hardMaxRefineCount,
  maxParallelism,
  traceBranchCount = null,
  traceRefineCount = null
}) {
  return { history, fallback, hardMaxBranchCount, hardMaxRefineCount, maxParallelism, traceBranchCount, traceRefineCount }
}

/**
 * A plan the runner will use: whole numbers inside the caps, with a reason.
 *
 * Refused rather than repaired. The paper forbids the runner from choosing the
 * grid, so a policy that cannot state a legal plan stops the round instead of
 * having one invented for it. Returns the plan or `{ error }`.
 */
export function validatePlan({ plan, hardMaxBranchCount, hardMaxRefineCount, source }) {
  const label = PLAN_SOURCE_LABEL[source] ?? 'the plan'
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { error: `${label} returned no grid plan` }

  const checked = gridPlan({ branchCount: plan.branchCount, refineCount: plan.refineCount, reason: plan.reason })
  if (checked.error) return { error: `${label}'s grid plan is invalid: ${checked.error}` }
  if (checked.branchCount < 1) return { error: `${label}'s grid plan asks for ${checked.branchCount} branches, below the minimum of 1` }
  if (checked.branchCount > hardMaxBranchCount) return { error: `${label}'s grid plan asks for ${checked.branchCount} branches, over the hard cap of ${hardMaxBranchCount}` }
  if (checked.refineCount < 0) return { error: `${label}'s grid plan asks for ${checked.refineCount} refinements, below the minimum of 0` }
  if (checked.refineCount > hardMaxRefineCount) return { error: `${label}'s grid plan asks for ${checked.refineCount} refinements, over the hard cap of ${hardMaxRefineCount}` }
  return { ...checked, source }
}

/**
 * The plan for one round.
 *
 * The policy plans its own grid, as the paper requires; the runner's history
 * rule answers only when the policy has no `plan_grid`. A pinned plan wins over
 * both, because it is how a first run's cost is known in advance.
 */
export function planRound({
  policy = null,
  history = [],
  fallback = { branchCount: 2, refineCount: 2 },
  fixed = null,
  hardMaxBranchCount = HARD_MAX_BRANCH_COUNT,
  hardMaxRefineCount = HARD_MAX_REFINE_COUNT,
  maxParallelism = DEFAULT_MAX_PARALLELISM,
  traceBranchCount = null,
  traceRefineCount = null
} = {}) {
  // A pinned plan bounds what a first run costs: the number of attempts a round
  // can make is the number of cells, and that is the expensive part.
  if (fixed) {
    return validatePlan({
      plan: { ...fixed, reason: 'pinned for this run, so its cost is bounded in advance' },
      hardMaxBranchCount,
      hardMaxRefineCount,
      source: 'pinned'
    })
  }

  if (typeof policy?.plan_grid === 'function') {
    const context = planContext({ history, fallback, hardMaxBranchCount, hardMaxRefineCount, maxParallelism, traceBranchCount, traceRefineCount })
    const asked = policy.plan_grid(context)
    // The paper's plan_grid is synchronous: it runs before the grid exists and
    // reads no outcome. A promise means it is deciding from something else.
    if (asked && typeof asked.then === 'function') {
      return { error: `${PLAN_SOURCE_LABEL.policy}'s plan_grid returned a promise; a grid plan is chosen before the round starts` }
    }
    return validatePlan({ plan: asked, hardMaxBranchCount, hardMaxRefineCount, source: 'policy' })
  }

  const planned = planFromHistory({ history, fallback, hardMaxBranchCount, hardMaxRefineCount })
  if (planned.error) return { error: planned.error }
  return validatePlan({ plan: planned, hardMaxBranchCount, hardMaxRefineCount, source: 'runner' })
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
 * What a grid's cells actually opened: how many branches hold a cell, and the
 * deepest attempt reached. The plan is the bound; this is what the policy used.
 */
export function openedGridOf(grid) {
  const cells = Object.values(grid?.cells ?? {})
  const branches = new Set(cells.map(cell => cell.branch))
  const depth = cells.reduce((highest, cell) => Math.max(highest, cell.attempt), 0)
  return { width: branches.size, depth }
}

/**
 * One round as the next plan's context reads it.
 *
 * A resumed run builds this from the round's files and a live run builds it from
 * the round in memory, so both read the same facts: planned and effective grids,
 * opened width and depth, probes, decision rounds, score and beta.
 */
export function historyOfRound({ number, rollout, grid }) {
  const opened = openedGridOf(grid)
  return {
    number,
    plannedBranchCount: rollout?.plan?.branchCount ?? null,
    plannedRefineCount: rollout?.plan?.refineCount ?? null,
    planSource: rollout?.plan?.source ?? null,
    planReason: rollout?.plan?.reason ?? null,
    effectiveBranchCount: rollout?.effective?.branchCount ?? null,
    effectiveRefineCount: rollout?.effective?.refineCount ?? null,
    openedWidth: opened.width,
    openedDepth: opened.depth,
    probes: rollout?.rollout?.probes ?? null,
    decisionRounds: rollout?.rollout?.rounds ?? null,
    attained: rollout?.rollout?.attained ?? null,
    beta: rollout?.policy?.beta ?? null,
    bestAttempt: grid ? bestAttemptOf(grid) : null
  }
}

/**
 * What a Dream-RSI run has already done, from its own round records.
 *
 * The evolutionary loop's `recordedState` reads `rounds/r####`, which a
 * Dream-RSI run never writes — its rounds are `rsi/round-###`. Reading the wrong
 * layout is not a small mistake: a resumed run numbered its next round one, wrote
 * over the round already recorded, and lost it. So this run numbers its rounds
 * from its own records, and no number is ever reused.
 */
export async function recordedRsiRounds(runDirectory) {
  const roundsDirectory = path.join(runDirectory, 'rsi')
  const rounds = []
  for (const name of (await fs.readdir(roundsDirectory).catch(() => [])).sort()) {
    const match = /^round-(\d+)$/.exec(name)
    if (!match) continue
    const read = async file => JSON.parse(await fs.readFile(path.join(roundsDirectory, name, file), 'utf8').catch(() => 'null'))
    const rollout = await read('rollout.json')
    const grid = await read('grid.json')
    // The manifest rides beside the summary because a resumed run's own summary
    // is rebuilt from this read rather than from a second projection.
    rounds.push({ ...historyOfRound({ number: Number(match[1]), rollout, grid }), name, rollout })
  }
  return rounds.sort((left, right) => left.number - right.number)
}

/**
 * The best attempt across every grid in the pool.
 *
 * Read after every round rather than only at the end, because a watcher that
 * sees yesterday's best while the pool already holds a better one is being told
 * something untrue.
 */
export function bestCellOf(grids) {
  let best = null
  for (const grid of grids) {
    for (const [id, cell] of Object.entries(grid.cells ?? {})) {
      if (typeof cell.outcome?.score !== 'number') continue
      if (!best || cell.outcome.score > best.score) {
        best = { grid: grid.id, cell: id, score: cell.outcome.score, patchPath: cell.patchPath ?? null, measures: cell.outcome.measures ?? null }
      }
    }
  }
  return best
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
  beta1 = 0.01,
  beta2 = 0.5,
  maxParallelism = DEFAULT_MAX_PARALLELISM,
  timeoutSeconds,
  model,
  harness,
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
    const design = await designSetup({ checkout, runDirectory: directory, target, timeoutSeconds, model, harness })
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
  // Built per round, so an attempt's patch carries the round it belongs to.
  const makeAttemptFactory = round => attempt ?? realAttempt({
    checkout,
    runDirectory: directory,
    setup,
    target: targetText,
    files: targetRecord.files ?? [],
    setupHash: checkRecord.digest,
    timeoutSeconds,
    model,
    harness,
    round
  })

  const policyDirectory = path.join(directory, 'policy')
  // Rounds already recorded, and the number this invocation may start at. Both
  // come from the run's own layout, so a resume continues rather than restarting.
  const priorRounds = await recordedRsiRounds(directory)
  const firstRound = priorRounds.reduce((highest, round) => Math.max(highest, round.number), 0) + 1
  const history = priorRounds.filter(round => round.plannedBranchCount !== null)
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
  for (let round = firstRound; round < firstRound + rounds; round++) {
    if (await fs.access(path.join(directory, 'stop')).then(() => true, () => false)) {
      stopped = true
      await writeStatus({ phase: 'stopped', round: round - 1 })
      break
    }

    // Belt and braces on the numbering: a round that is already recorded is never
    // written over, whatever put it there.
    const taken = await fs.access(path.join(roundDirectory(directory, round), 'rollout.json')).then(() => true, () => false)
    if (taken) {
      const why = `round ${round} is already recorded in ${roundDirectory(directory, round)}; a run never overwrites a round it paid for`
      await writeStatus({ phase: 'refused', why })
      return { runDirectory: directory, error: why, rounds: record.rounds }
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

    // The policy plans the grid, as the paper requires. The runner's history
    // rule answers only when the policy has no `plan_grid` at all, and a plan
    // outside the caps stops the round rather than being clamped in silence.
    const plan = planRound({ policy, history, fallback: { branchCount: 2, refineCount: 2 }, fixed: fixedPlan, maxParallelism })
    if (plan.error) {
      await writeStatus({ phase: 'plan-failed', why: plan.error })
      return { runDirectory: directory, error: plan.error }
    }

    await writeStatus({ phase: 'exploring', round, plan, policy: policy.NAME })

    const grid = emptyGrid({
      id: `${path.basename(directory)}-r${round}`,
      target: targetText,
      baseline,
      branchCount: plan.branchCount,
      refineCount: plan.refineCount
    })

    // The grid is written after every attempt, not only when the round ends. A
    // rollout is the expensive part of the loop, and one that can only be watched
    // after it finishes is one nobody can stop in time.
    await fs.mkdir(roundDirectory(directory, round), { recursive: true })
    const liveGrid = path.join(roundDirectory(directory, round), 'grid.json')
    const writeGrid = () => fs.writeFile(liveGrid, `${JSON.stringify(grid, null, 2)}\n`, 'utf8')
    await writeGrid()

    const rollout = await rolloutOnce({
      grid,
      policy,
      maxParallelism,
      attempt: makeAttemptFactory(round),
      onAttempt: writeGrid
    })
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
      // The plan is the bound; `effective` is the grid the runner made from it.
      // They differ only when a later runner clamps a plan, but the record keeps
      // both so a cross-cycle rule reads the pair rather than inferring it.
      effective: { branchCount: grid.branchCount, refineCount: grid.refineCount },
      opened: openedGridOf(grid),
      policy: { name: policy.NAME, beta: policy.beta ?? null },
      rollout: { probes: rollout.probes, rounds: rollout.rounds, attained: rollout.attained, failure: rollout.failure, durationMs: rollout.durationMs },
      pool: added,
      grid: path.relative(checkout, path.join(directory, 'pool', path.basename(added.file))).split(path.sep).join('/')
    }
    await fs.writeFile(path.join(roundDirectory(directory, round), 'rollout.json'), `${JSON.stringify(roundRecord, null, 2)}\n`, 'utf8')

    // What each attempt cost, per cell. The grid keeps the score; this keeps the
    // token breakdown and the session it came from, so a finished run can be
    // priced without the grid having to carry the money as well as the outcome.
    const attempts = rollout.records.map(made => ({
      cell: made.id,
      verdict: made.record?.verdict ?? null,
      value: made.record?.value ?? null,
      reason: made.record?.reason ?? null,
      measures: made.record?.measures ?? null,
      tokens: made.record?.tokens ?? null,
      cost: made.record?.cost ?? null,
      durationMs: made.record?.durationMs ?? null,
      session: made.record?.sessionDirectory ?? null,
      patch: made.patchPath ? path.relative(checkout, made.patchPath).split(path.sep).join('/') : null,
      report: made.record?.report ?? null
    }))
    await fs.writeFile(path.join(roundDirectory(directory, round), 'attempts.json'), `${JSON.stringify(attempts, null, 2)}\n`, 'utf8')

    await writeStatus({ phase: 'dreaming', round, policy: policy.NAME, pool: poolSummary(await readPool(directory)) })

    const dreamed = await dreamPolicies({
      checkout,
      runDirectory: directory,
      versions,
      betas,
      maxParallelism,
      beta1,
      beta2,
      startPolicyFile: hasPolicy ? currentPolicyFile : null,
      ...(revise ? { revise } : { timeoutSeconds, model, harness })
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
      ...historyOfRound({ number: round, rollout: roundRecord, grid }),
      name: path.basename(roundDirectory(directory, round)),
      policy: dreamed.winner ? dreamed.winner.file : null,
      policyScore: dreamed.winner ? dreamed.winner.score : null
    })

    // The pictures are rewritten every round, so the page and the document follow
    // the run while it goes rather than describing it only once it stops.
    await renderRsiPictures(directory)
    await writeStatus({
      phase: 'running',
      round,
      pool: poolSummary(await readPool(directory)),
      policy: dreamed.winner?.file ?? null,
      best: bestCellOf(await readPool(directory)),
      roundBest: history[history.length - 1]
    })
  }

  // The winner is the best attempted version across every grid this run made.
  const grids = await readPool(directory)
  const best = bestCellOf(grids)

  // Every round the run has ever recorded, not only the ones this invocation
  // made. A resumed run that wrote its own two rounds into the summary left the
  // earlier invocation's rounds out of it, and the document then described a run
  // that had only ever done what the last invocation saw.
  const everyRound = await recordedRsiRounds(directory)
  const withDreaming = []
  for (const round of everyRound) {
    const dreaming = JSON.parse(await fs.readFile(path.join(roundDirectory(directory, round.number), 'dreaming.json'), 'utf8').catch(() => 'null'))
    withDreaming.push({ ...(round.rollout ?? { round: round.number }), dreaming: dreaming ?? undefined })
  }
  if (withDreaming.length) record.rounds = withDreaming

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
  await renderRsiPictures(directory)
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
    beta1: argument('beta1') ? Number(argument('beta1')) : 0.01,
    beta2: argument('beta2') ? Number(argument('beta2')) : 0.5,
    timeoutSeconds: argument('timeout') ? Number(argument('timeout')) : undefined,
    model: argument('model'),
    harness: argument('harness'),
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
