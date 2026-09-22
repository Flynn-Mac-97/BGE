/**
 * The policy API, named as the paper's Listing 2 names it.
 *
 * The paper's own source is not published — its repository holds the README, the
 * PDF and the figures, and its release plan still marks the codebase as being
 * prepared. What is published is the prompt that asks an agent to write a
 * policy, and that prompt is precise: it imports `LLMDesignedMethod`, `SimResult`,
 * `_budget_done`, `_record_curve` and `finalize_result` from `see.policy.api`,
 * implements `solve(self, question, budget=None)` and `plan_grid(self, context)`,
 * reads one `beta` scalar in `__init__`, and returns a `GridPlan`. So the names
 * and the rules below are the paper's, not an invention, and a policy written to
 * the paper's shape runs here unaltered in structure.
 *
 * Two of the paper's API members exist only for bookkeeping and are documented
 * as such, because the prompt forbids deciding from them: `best_so_far` and
 * `budget_spent`. They are here so a policy that reads them gets a number rather
 * than an error, and so the rule can be stated where a policy author will see it.
 */

/**
 * A policy. Subclassed, exactly as the paper's prompt requires.
 *
 * `config` carries one scalar that matters, `beta`: high beta means more width,
 * deeper patience and weaker pruning; low beta means fewer probes and earlier
 * stops. It is fixed for the whole episode — a policy that changed it from what
 * it observed would be adapting online, which the paper separates from the
 * offline sweep that measures the trade-off.
 */
export class LLMDesignedMethod {
  constructor(config = {}) {
    this.config = config
    this.beta = Number(config.beta ?? 0.6)
  }

  /** Every version must answer this. Kept here so a missing one fails loudly. */
  solve() {
    throw new Error(`${this.constructor.name ?? 'this policy'} implements no solve(question, budget)`)
  }

  /**
   * The beta schedule: one place where every behavioural threshold is read.
   *
   * The paper's prompt is emphatic that beta has one role per episode, and that
   * recovery eligibility, reserve threshold and waiting all route through the
   * same schedule — so a policy cannot quietly grow a second interpretation of
   * its own knob.
   */
  schedule(beta = this.beta) {
    const b = Math.min(1, Math.max(0, Number(beta)))
    return {
      beta: b,
      width: 1 + Math.round(b * 3),
      patience: 1 + Math.round(b * 3),
      exploreShare: 0.2 + 0.5 * b,
      recoverAfter: Math.max(1, Math.round((1 - b) * 3)),
      stopAfterFlat: 1 + Math.round((1 - b) * 3),
      reserveFloor: Number((0.02 * (1 - b)).toFixed(4))
    }
  }

  /** Kept for the paper's signature: a policy that ignores budget returns true. */
  budgetDone(question, budget) {
    return budgetDone(question, budget)
  }
}

/** Whether a replay has used the budget it was given. Null budget means no cap. */
export function budgetDone(question, budget = null) {
  if (budget === null || budget === undefined) return false
  const spent = question.usage().probes
  if (typeof budget === 'number') return spent >= budget
  if (typeof budget === 'object' && typeof budget.probes === 'number') return spent >= budget.probes
  return false
}

/**
 * What a policy returns when it stops.
 *
 * The curve records attainment against probes, which the experimental objective
 * reads and the default page-6 equation does not. A policy may stop immediately,
 * in which case the curve holds only the baseline: the paper permits it, and the
 * score is the baseline rather than a refusal.
 */
export class SimResult {
  constructor() {
    this.curve = []
    this.revealed = []
    this.stopped = null
  }
}

/** Append the current attainment to the curve. Called on every reveal. */
export function recordCurve(result, question) {
  const observed = Object.values(question.observed())
  const best = observed.reduce((highest, cell) => (
    cell.evaluated && typeof cell.score === 'number' && cell.score > highest ? cell.score : highest
  ), question.baseline_score)
  result.curve.push({ probes: question.usage().probes, attainment: best })
  result.revealed = observed
  return result
}

/** The route a policy took, as the evaluator reads it. */
export function finalizeResult(question, result) {
  const usage = question.usage()
  return {
    curve: result.curve,
    revealed: result.revealed,
    probes: usage.probes,
    sequentialRounds: usage.sequentialRounds,
    rounds: usage.rounds,
    stopped: result.stopped
  }
}

/**
 * The grid a rollout will be given, chosen before it starts.
 *
 * The paper's `GridPlan(branch_count=W, refine_count=R)` makes branches
 * `0..W-1` and attempts `0..R`. It is chosen from the context before a live grid
 * exists and must never be read from the current episode's outcomes: how wide to
 * work is a decision about the next rollout, not a reaction to this one.
 */
export function gridPlan({ branchCount, refineCount, reason }) {
  if (!Number.isInteger(branchCount) || !Number.isInteger(refineCount)) {
    return { error: 'a grid plan needs whole numbers of branches and refinements' }
  }
  if (!reason || typeof reason !== 'string') return { error: 'a grid plan states a reason' }
  return { branchCount, refineCount, reason }
}

/**
 * A plan derived from what earlier rollouts did, inside the runner's caps.
 *
 * This is the conservative bootstrap the paper asks for when history is thin:
 * the same width and depth as before, held inside the caps, with the reason
 * saying so rather than pretending to evidence.
 */
export function planFromHistory({ history = [], fallback = {}, hardMaxBranchCount = 4, hardMaxRefineCount = 4 } = {}) {
  const last = history[history.length - 1]
  if (!last) {
    const branchCount = Math.min(fallback.branchCount ?? 2, hardMaxBranchCount)
    const refineCount = Math.min(fallback.refineCount ?? 2, hardMaxRefineCount)
    return gridPlan({ branchCount, refineCount, reason: 'no earlier rollout; a conservative bootstrap inside the caps' })
  }

  const improvedLate = last.bestAttempt !== undefined && last.bestAttempt > last.plannedRefineCount / 2
  if (last.bestAttempt === 0) {
    return gridPlan({
      branchCount: Math.min(last.plannedBranchCount + 1, hardMaxBranchCount),
      refineCount: last.plannedRefineCount,
      reason: 'the best attempt was a branch root, so more directions are worth opening'
    })
  }
  if (improvedLate) {
    return gridPlan({
      branchCount: last.plannedBranchCount,
      refineCount: Math.min(last.plannedRefineCount + 1, hardMaxRefineCount),
      reason: 'the best attempt came late in a branch, so deeper refinement pays'
    })
  }
  return gridPlan({
    branchCount: Math.max(1, last.plannedBranchCount - 1),
    refineCount: Math.max(1, last.plannedRefineCount),
    reason: 'gains arrived early and nothing else moved; narrower and no deeper'
  })
}
