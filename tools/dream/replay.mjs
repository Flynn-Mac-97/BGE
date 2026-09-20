/**
 * The replay simulator: score a policy over recorded attempts, without running
 * anything.
 *
 * This is the paper's central claim made into code. A completed discovery
 * history already holds the outcome of every attempt that was made, so a policy
 * can be tried against it by revealing outcomes that are already written down.
 * No agent is called, no engine process starts, no token is spent — a replay of
 * a thousand probes is arithmetic over a record.
 *
 * A policy sees only what it has revealed. Unrevealed scores are not hidden by
 * convention here, they are absent: the question hands out observations of
 * revealed cells and legal moves, and holds the record itself in its closure.
 * A policy that asked for an unrevealed cell would have to reach past the
 * question to do it, and the question does not offer the record.
 *
 * A legal cell the run never reached reveals `evaluated: false`. That is not a
 * failure of the policy but it is not free either: the probe is spent and the
 * attainment does not move, which is what the paper means by a route outside the
 * recorded support earning no reward.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gridCeiling, legalActions, observationOf } from './grid.mjs'
import { readPool } from './pool.mjs'
import { loadPolicy } from './policy.mjs'

/** The objective the paper's evaluator ranks by. `legacy` keeps the body-of-paper equation. */
export const DEFAULT_OBJECTIVE = 'pareto'

/** Every objective a sweep may use. Their numbers are not comparable with each other. */
export const OBJECTIVES = ['pareto', 'legacy']

/**
 * The evaluator's price on parallel waste.
 *
 * `pareto.auc` and `parallel_penalty` both lie in [0, 1], a serial policy pays
 * nearly 1 and a full batch of W pays near 1/W. Half a unit of area is a stated
 * default fixed by the evaluator; a policy cannot set it.
 */
export const DEFAULT_LAMBDA = 0.5

/**
 * The sequential rounds a batch of `cellCount` cells costs on `workerCount` workers.
 *
 * The paper charges one decision round per batch and `ceil(k / W)` effective
 * sequential rounds. The question refuses a batch above the worker count, so the
 * formula also states what a plan larger than the workers would cost.
 */
export function effectiveSequentialRounds(cellCount, workerCount) {
  const workers = Math.max(1, Math.floor(Number(workerCount) || 1))
  const cells = Math.max(0, Math.floor(Number(cellCount) || 0))
  return Math.ceil(cells / workers)
}

/**
 * The question a policy is solved against.
 *
 * The names are the paper's, deliberately: `observed`, `legal_actions`,
 * `legal_roots`, `opened_branches`, `meta`, `probe_batch`, `baseline_score`,
 * `max_parallelism`. A policy written against the paper's prompt has a chance of
 * being read by this, and a person comparing the two is comparing like names.
 */
export function makeQuestion({ grid, maxParallelism = 3, onReveal = null }) {
  const revealed = new Map()
  const history = []
  let probes = 0
  let sequentialRounds = 0
  let bestSoFar = grid.baseline?.value ?? 0

  const legalNow = () => legalActions({ ...grid, cells: Object.fromEntries(revealed) })

  const cellAt = id => {
    const [branch, attempt] = String(id).split(':').map(Number)
    return { branch, attempt }
  }

  /** The order a cell was revealed in, which is what `seq` means to a policy. */
  const seqOf = id => [...revealed.keys()].indexOf(String(id))

  const question = {
    baseline_score: grid.baseline?.value ?? 0,
    max_parallelism: maxParallelism,

    /**
     * Bookkeeping, and the paper forbids deciding from it.
     *
     * A policy that stops because `best_so_far` looks good, or that widens
     * because `budget_spent` looks cheap, is reading the evaluator's own numbers
     * rather than what it revealed. They are here so such a policy gets a number
     * instead of an error, and so the rule is stated where its author will see it.
     */
    get best_so_far() {
      return bestSoFar
    },
    get budget_spent() {
      return probes
    },

    reset() {
      revealed.clear()
      history.length = 0
      probes = 0
      sequentialRounds = 0
      bestSoFar = grid.baseline?.value ?? 0
    },

    /**
     * Revealed cells, keyed by cell id as the paper's API returns them.
     *
     * The record behind them is not reachable from here: unrevealed outcomes are
     * absent rather than hidden, so a policy cannot read the answer it has not
     * paid for even by accident.
     */
    observed() {
      const observed = {}
      for (const [id, cell] of revealed) observed[id] = observationOf(cell, grid)
      return observed
    },

    legal_actions() {
      return legalNow()
    },

    legal_roots() {
      return this.legal_actions().filter(id => cellAt(id).attempt === 0)
    },

    opened_branches() {
      return [...new Set([...revealed.values()].map(cell => cell.branch))].sort((left, right) => left - right)
    },

    /** What the record says about one revealed cell, and nothing about the rest. */
    meta(id) {
      const key = String(id)
      const cell = revealed.get(key)
      const { branch, attempt } = cellAt(key)
      return {
        branch,
        attempt,
        parent_id: attempt === 0 ? 'baseline' : `${branch}:${attempt - 1}`,
        seq: cell ? seqOf(key) : null,
        tags: attempt === 0 ? ['root'] : ['refine'],
        revealed: Boolean(cell),
        outcome: cell?.outcome ? { ...cell.outcome } : null
      }
    },

    /**
     * Reveal a batch of cells.
     *
     * Refused rather than repaired: a batch naming a cell that is not legal, or
     * one already revealed, is a policy bug, and a simulator that quietly fixed
     * it would report a reward for a route no policy could have taken.
     */
    probe_batch(cells, onRevealOne = null) {
      const wanted = [].concat(cells).map(String)
      if (!wanted.length) return []
      if (wanted.length > maxParallelism) {
        throw new Error(`a batch of ${wanted.length} exceeds max_parallelism ${maxParallelism}`)
      }
      const legal = new Set(legalNow())
      for (const id of wanted) {
        if (!legal.has(id)) throw new Error(`${id} is not a legal action`)
      }
      if (new Set(wanted).size !== wanted.length) throw new Error('a batch names the same cell twice')

      const answers = []
      for (const id of wanted) {
        const { branch, attempt } = cellAt(id)
        const recorded = grid.cells[id]
        revealed.set(id, recorded ?? { branch, attempt, outcome: null })
        probes++
        const value = recorded?.outcome?.score
        if (typeof value === 'number' && value > bestSoFar) bestSoFar = Number(value.toFixed(6))
        const answer = { id, ...question.meta(id) }
        answers.push(answer)
        // The paper's `on_reveal` fires per revealed cell, which is where a
        // policy records its curve: attainment after each probe, not per batch.
        // The evaluator reads the same moments through `onReveal` to compute the
        // area under the attainment curve.
        onRevealOne?.(answer)
        onReveal?.(answer, { probes, sequentialRounds })
      }

      const effective = effectiveSequentialRounds(wanted.length, maxParallelism)
      sequentialRounds += effective
      // The attainment is stored per round as it stood then. Reading it later
      // from the final reveal set would report the best score of the whole replay
      // against every round, and a curve that never climbs.
      history.push({ cells: wanted, effective, probes, sequentialRounds, attainment: bestSoFar })
      return answers
    },

    /** What the replay spent, for the objective and for the trace. */
    usage() {
      return { probes, sequentialRounds, rounds: history.length }
    },

    trace() {
      return history.map((round, index) => ({
        round: index + 1,
        batch: round.cells,
        effectiveSequentialRounds: round.effective,
        probesSoFar: round.probes,
        attainment: round.attainment
      }))
    }
  }

  question.reset()
  return question
}

/**
 * The area under the attainment-against-probes curve.
 *
 * Attainment is a step function of the probes spent: after probe `p` it is the
 * best revealed score, normalised so the baseline is 0 and the grid's ceiling is
 * 1. The area under a step is the mean height over the probes, which is what
 * makes reaching the same score in fewer probes score higher.
 */
function attainmentAuc({ curve, baseline, ceiling }) {
  const span = ceiling - baseline
  if (!(span > 0) || !curve.length) return 0
  const height = point => Math.min(1, Math.max(0, (point.attainment - baseline) / span))
  const total = curve.reduce((sum, point) => sum + height(point), 0)
  return Number((total / curve.length).toFixed(6))
}

/**
 * Score one policy over one recorded grid.
 *
 * Two objectives are computed side by side and kept apart. The paper's ranks a
 * route by `pareto.auc - lambda * parallel_penalty`: the mean attainment over the
 * probes spent, less the price of not filling the workers. The other is the
 * equation the body of the paper states, kept because earlier sweeps were
 * recorded with it and its numbers are not comparable with the paper's.
 *
 * Only one of them is called `reward`, and `objective` names which, so a sweep
 * recorded under one is never compared with a sweep made under the other.
 */
export async function replayGrid({
  grid,
  policy,
  maxParallelism = 3,
  maxRounds = 50,
  objective = DEFAULT_OBJECTIVE,
  lambda = DEFAULT_LAMBDA,
  beta1 = 0.01,
  beta2 = 0.5,
  budget = null
} = {}) {
  if (!OBJECTIVES.includes(objective)) throw new Error(`unknown objective ${objective}; expected ${OBJECTIVES.join(' or ')}`)

  // The evaluator reads attainment after every probe, where the paper's AUC is
  // defined. The policy reads the same moments through its own recorded curve.
  const attainmentCurve = []
  let question = null
  question = makeQuestion({
    grid,
    maxParallelism,
    onReveal: (answer, usage) => attainmentCurve.push({ probes: usage.probes, attainment: question.best_so_far })
  })
  let failure = null

  question.reset()
  try {
    // Awaiting a synchronous policy costs nothing and returns undefined, so the
    // paper's synchronous shape and a policy that also drives a live rollout —
    // where a probe really has to be waited for — are the same interface here.
    await policy.solve(question, budget)
  } catch (error) {
    failure = String(error?.message || error)
  }

  const { probes, sequentialRounds } = question.usage()
  const trace = question.trace()
  const baseline = grid.baseline?.value ?? 0
  if (trace.length > maxRounds) failure = failure ?? `the policy took ${trace.length} rounds, over the ${maxRounds} allowed`

  // The curve starts at the baseline, before any probe: a policy that never
  // probes has still not lost the target it started from.
  const attainments = [baseline, ...trace.map(round => round.attainment)]
  const best = Math.max(...attainments)
  const attempts = trace.reduce((total, round) => total + round.batch.filter(id => Number(String(id).split(':')[1]) > 0).length, 0)
  const parallelBonus = attempts ? Number((attempts / Math.max(1, trace.length)).toFixed(6)) : 0
  const legacyReward = Number((best - beta1 * attempts + beta2 * parallelBonus).toFixed(6))

  const auc = attainmentAuc({ curve: attainmentCurve, baseline, ceiling: gridCeiling(grid) })
  const parallelPenalty = probes > 0 ? Number((sequentialRounds / probes).toFixed(6)) : 0
  const paretoReward = Number((auc - lambda * parallelPenalty).toFixed(6))
  const reward = objective === 'legacy' ? legacyReward : paretoReward

  return {
    grid: grid.id,
    policy: policy.NAME ?? policy.name ?? policy.constructor?.name ?? 'unnamed',
    beta: policy.beta ?? null,
    objective,
    maxParallelism,
    reward,
    quality: Number(best.toFixed(6)),
    lambda,
    beta1,
    beta2,
    auc,
    parallelPenalty,
    paretoReward,
    legacyReward,
    parallelBonus,
    attempts,
    attainment: Number(best.toFixed(6)),
    gained: Number((best - baseline).toFixed(6)),
    probes,
    sequentialRounds,
    rounds: trace.length,
    support: Object.keys(grid.cells).length,
    failure,
    trace
  }
}

/**
 * Score one policy over every grid in a pool.
 *
 * The paper averages a policy's replay score over every recorded history, so a
 * policy that wins on one lucky trace and loses on the rest does not win. The
 * spread is reported too: a policy that wins only on average is worth less than
 * one that wins everywhere.
 */
export async function replayPool({
  grids,
  policy,
  maxParallelism = 3,
  maxRounds = 50,
  objective = DEFAULT_OBJECTIVE,
  lambda = DEFAULT_LAMBDA,
  beta1 = 0.01,
  beta2 = 0.5,
  budget = null
} = {}) {
  const replays = []
  for (const grid of grids) replays.push(await replayGrid({ grid, policy, maxParallelism, maxRounds, objective, lambda, beta1, beta2, budget }))
  const mean = field => Number((replays.reduce((total, replay) => total + (replay[field] ?? 0), 0) / Math.max(1, replays.length)).toFixed(6))
  const rewards = replays.map(replay => replay.reward)
  return {
    policy: policy.NAME ?? policy.name ?? policy.constructor?.name ?? 'unnamed',
    beta: policy.beta ?? null,
    objective,
    lambda,
    grids: replays.length,
    reward: mean('reward'),
    worst: rewards.length ? Math.min(...rewards) : 0,
    best: rewards.length ? Math.max(...rewards) : 0,
    auc: mean('auc'),
    parallelPenalty: mean('parallelPenalty'),
    paretoReward: mean('paretoReward'),
    legacyReward: mean('legacyReward'),
    failures: replays.filter(replay => replay.failure).length,
    replays
  }
}

/**
 * The beta sweep the paper's evaluator runs.
 *
 * Beta is fixed inside one episode and swept offline. The sweep answers whether
 * the policy exposes a real attainment/work/parallelism trade-off at all: if
 * every beta produces the same curve, the policy ignores its own knob, and the
 * default it bakes in is not a decision.
 *
 * `makePolicy(beta)` is used rather than mutating one policy, so a sweep cannot
 * leave an instance holding the last beta it was tried at.
 */
export async function replaySweep({
  grids,
  makePolicy,
  betas = [0, 0.25, 0.5, 0.75, 1],
  maxParallelism = 3,
  maxRounds = 50,
  objective = DEFAULT_OBJECTIVE,
  lambda = DEFAULT_LAMBDA,
  beta1 = 0.01,
  beta2 = 0.5
} = {}) {
  const points = []
  for (const beta of betas) points.push({ beta, ...(await replayPool({ grids, policy: makePolicy(beta), maxParallelism, maxRounds, objective, lambda, beta1, beta2 })) })
  const mean = field => Number((points.reduce((total, point) => total + (point[field] ?? 0), 0) / Math.max(1, points.length)).toFixed(6))
  const rewards = points.map(point => point.reward)
  const spread = rewards.length ? Number((Math.max(...rewards) - Math.min(...rewards)).toFixed(6)) : 0
  const best = points.reduce((winner, point) => (!winner || point.reward > winner.reward ? point : winner), null)

  // The paper's reward for the sweep: the mean attainment over the probes spent,
  // less lambda times the mean parallel penalty over the sweep. Both are means of
  // the same per-beta quantities, so the two objectives stay separable.
  const paretoAuc = mean('auc')
  const parallelPenalty = mean('parallelPenalty')
  const paretoReward = Number((paretoAuc - lambda * parallelPenalty).toFixed(6))

  return {
    betas,
    points,
    objective,
    lambda,
    paretoAuc,
    parallelPenalty,
    paretoReward,
    legacyReward: mean('legacyReward'),
    // Non-degenerate means beta changed something. A policy whose sweep is flat
    // is not choosing; it is obeying a constant.
    degenerate: spread === 0,
    spread,
    bestBeta: best ? best.beta : null,
    bestReward: best ? best.reward : null,
    meanReward: mean('reward')
  }
}

/** One version's score: the sweep, summarised the way a dreaming phase ranks it. */
export async function scorePolicy({
  grids,
  Class,
  instance = null,
  betas,
  maxParallelism = 3,
  objective = DEFAULT_OBJECTIVE,
  lambda = DEFAULT_LAMBDA,
  beta1 = 0.01,
  beta2 = 0.5
} = {}) {
  const makePolicy = beta => (Class ? new Class({ beta, name: instance?.NAME }) : { ...instance, beta })
  const sweep = await replaySweep({ grids, makePolicy, betas, maxParallelism, objective, lambda, beta1, beta2 })
  return {
    policy: instance?.NAME ?? Class?.name ?? 'unnamed',
    score: sweep.meanReward,
    ...sweep
  }
}

// Run directly: score one policy file against one run's pool. This is the check
// the policy-development prompt tells an agent to run before it finishes.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argument = name => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : undefined
  }
  const policyFile = argument('policy')
  const runDirectory = argument('run')
  if (!policyFile || !runDirectory) {
    process.stderr.write('usage: node tools/dream/replay.mjs --policy <file> --run <run directory> [--objective pareto|legacy] [--lambda 0.5] [--beta1 0.01] [--beta2 0.5]\n')
    process.exit(2)
  }

  const grids = await readPool(path.resolve(runDirectory))
  if (!grids.length) {
    process.stderr.write(`no grids in ${runDirectory}/pool — a replay needs recorded attempts to read\n`)
    process.exit(2)
  }

  const loaded = await loadPolicy(path.resolve(policyFile))
  if (loaded.error) {
    process.stderr.write(`${loaded.error}\n`)
    process.exit(1)
  }

  const scored = await scorePolicy({
    grids,
    Class: loaded.Class,
    instance: loaded.policy,
    objective: argument('objective') ?? DEFAULT_OBJECTIVE,
    lambda: argument('lambda') ? Number(argument('lambda')) : DEFAULT_LAMBDA,
    beta1: argument('beta1') ? Number(argument('beta1')) : 0.01,
    beta2: argument('beta2') ? Number(argument('beta2')) : 0.5,
    maxParallelism: argument('parallelism') ? Number(argument('parallelism')) : 3
  })
  process.stdout.write(`${JSON.stringify({
    policy: scored.policy,
    objective: scored.objective,
    lambda: scored.lambda,
    grids: grids.length,
    meanReward: scored.score,
    bestReward: scored.bestReward,
    bestBeta: scored.bestBeta,
    paretoAuc: scored.paretoAuc,
    parallelPenalty: scored.parallelPenalty,
    legacyReward: scored.legacyReward,
    spread: scored.spread,
    degenerate: scored.degenerate,
    perBeta: scored.points.map(point => ({ beta: point.beta, reward: point.reward, probes: point.replays.reduce((total, replay) => total + replay.probes, 0), failures: point.failures }))
  }, null, 2)}\n`)
  process.exitCode = scored.points.some(point => point.failures) ? 1 : 0
}
