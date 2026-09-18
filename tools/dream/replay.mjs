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
import { legalActions, observationOf } from './grid.mjs'

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
        const answer = { id, ...question.meta(id) }
        answers.push(answer)
        // The paper's `on_reveal` fires per revealed cell, which is where a
        // policy records its curve: attainment after each probe, not per batch.
        onRevealOne?.(answer)
        onReveal?.(answer, { probes, sequentialRounds })
      }

      const score = answers.reduce((highest, answer) => {
        const value = answer.outcome?.score
        return typeof value === 'number' && value > highest ? value : highest
      }, bestSoFar)
      bestSoFar = Number(score.toFixed(6))

      const effective = Math.ceil(wanted.length / maxParallelism)
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
 * Score one policy over one recorded grid.
 *
 * `auc` is the mean attainment over the probe budget: reaching a high score
 * early scores higher than reaching it late, and an answer never reached keeps
 * the score where it was. `parallel_penalty` is the paper's, and its two stated
 * sanity checks decide the arithmetic: a serial policy must come out near 1 and
 * batches that fill the workers near 1/W. Total effective sequential rounds
 * divided by total probes gives exactly that — a serial policy's sum of ones over
 * its probes is 1, and a policy batching W at a time spends probes/W rounds over
 * the same probes, which is 1/W. Averaging the per-round ratio instead would
 * give a serial policy 1/probes, which is not what the paper describes.
 *
 * The reward is the first minus lambda times the second, so a policy that batches
 * useful work and reaches a high score with few probes wins.
 */
export function replayGrid({ grid, policy, maxParallelism = 3, maxRounds = 50, lambda = 0.5, budget = null } = {}) {
  const question = makeQuestion({ grid, maxParallelism })
  let failure = null

  question.reset()
  try {
    policy.solve(question, budget)
  } catch (error) {
    failure = String(error?.message || error)
  }

  const { probes, sequentialRounds } = question.usage()
  const trace = question.trace()
  const baseline = grid.baseline?.value ?? 0
  if (trace.length > maxRounds) failure = failure ?? `the policy took ${trace.length} rounds, over the ${maxRounds} allowed`

  // The curve starts at the baseline, before any probe: a policy that never
  // probes has still not lost the target it started from.
  const curve = [baseline, ...trace.map(round => round.attainment)]
  const auc = Number((curve.reduce((total, value) => total + value, 0) / curve.length).toFixed(6))
  const parallelPenalty = probes ? Number((sequentialRounds / probes).toFixed(6)) : 0
  const best = Math.max(...curve)

  return {
    grid: grid.id,
    policy: policy.NAME ?? policy.name ?? policy.constructor?.name ?? 'unnamed',
    beta: policy.beta ?? null,
    maxParallelism,
    reward: Number((auc - lambda * parallelPenalty).toFixed(6)),
    auc,
    attainment: Number(best.toFixed(6)),
    gained: Number((best - baseline).toFixed(6)),
    parallelPenalty,
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
export function replayPool({ grids, policy, maxParallelism = 3, maxRounds = 50, lambda = 0.5, budget = null } = {}) {
  const replays = grids.map(grid => replayGrid({ grid, policy, maxParallelism, maxRounds, lambda, budget }))
  const rewards = replays.map(replay => replay.reward)
  return {
    policy: policy.NAME ?? policy.name ?? policy.constructor?.name ?? 'unnamed',
    beta: policy.beta ?? null,
    grids: replays.length,
    reward: Number((rewards.reduce((total, value) => total + value, 0) / Math.max(1, rewards.length)).toFixed(6)),
    worst: rewards.length ? Math.min(...rewards) : 0,
    best: rewards.length ? Math.max(...rewards) : 0,
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
export function replaySweep({ grids, makePolicy, betas = [0, 0.25, 0.5, 0.75, 1], maxParallelism = 3, maxRounds = 50, lambda = 0.5 } = {}) {
  const points = betas.map(beta => ({ beta, ...replayPool({ grids, policy: makePolicy(beta), maxParallelism, maxRounds, lambda }) }))
  const rewards = points.map(point => point.reward)
  const spread = rewards.length ? Number((Math.max(...rewards) - Math.min(...rewards)).toFixed(6)) : 0
  const best = points.reduce((winner, point) => (!winner || point.reward > winner.reward ? point : winner), null)
  return {
    betas,
    points,
    // Non-degenerate means beta changed something. A policy whose sweep is flat
    // is not choosing; it is obeying a constant.
    degenerate: spread === 0,
    spread,
    bestBeta: best ? best.beta : null,
    bestReward: best ? best.reward : null,
    meanReward: rewards.length ? Number((rewards.reduce((total, value) => total + value, 0) / rewards.length).toFixed(6)) : 0
  }
}
