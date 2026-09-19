/**
 * The four signals the paper's prompt points a policy at.
 *
 * The prompt names them and their home — `see.policy.observation_signal` — and
 * gives the reading each one deserves. They exist so a policy does not have to
 * re-derive the same judgement from raw observations, and so the readings the
 * paper calls out (a repairable failure is not a dead branch) are in one place
 * instead of being reinvented by every policy version.
 *
 * Every signal takes observations, never the grid: a policy may only reason
 * about what it has revealed.
 */

/**
 * A failure class the paper's prompt says is normally repairable.
 *
 * `correctness` is what an engine run records when a check failed: the target
 * ran and scored zero, which is a wrong answer rather than a dead branch.
 * `harness`, `stale_suite` and `refused` are the classes that produced no score
 * at all, and they are deliberately absent here.
 */
const REPAIRABLE = new Set(['output_mismatch', 'correctness', 'resource', 'variable', 'mask_layout', 'shape', 'compile_other'])

/**
 * Observations as a list.
 *
 * `question.observed()` answers a mapping keyed by cell id, as the paper's API
 * does, and a policy that has collected probes into an array is equally valid.
 * Both are accepted here rather than making every caller remember which.
 */
export const probesOf = observations => (Array.isArray(observations) ? observations : Object.values(observations ?? {}))

/** The successful evaluations among some observations, by the paper's own rule. */
export const successes = observations => probesOf(observations).filter(probe => probe.error === null && probe.fail_class === 'ok')

/**
 * Whether a branch has shown it can do well.
 *
 * A branch with a successful evaluation that beat the baseline is promising even
 * if its latest probe failed: the paper's rule is that a repairable failure does
 * not erase a historical anchor.
 */
export function branchPromising(observations, branch) {
  const mine = probesOf(observations).filter(probe => probe.branch === branch)
  const anchored = successes(mine).some(probe => (probe.delta_vs_baseline ?? 0) > 0)
  const climbing = mine.some(probe => (probe.delta_vs_parent ?? 0) > 0)
  return { promising: anchored || climbing, anchored, climbing }
}

/**
 * Whether a branch is dead rather than merely stuck.
 *
 * Hard means every probe on it failed in a way the prompt does not call
 * repairable, and none succeeded. One repairable failure is explicitly not
 * enough: the prompt's rule is that `n_valid == 0` and a hard-looking failure are
 * signals, not unconditional closure.
 */
export function branchFailedHard(observations, branch) {
  const mine = probesOf(observations).filter(probe => probe.branch === branch)
  if (!mine.length) return { hard: false, why: 'nothing has been tried on this branch' }
  if (successes(mine).length) return { hard: false, why: 'the branch has a successful evaluation' }

  const unrecoverable = mine.filter(probe => !REPAIRABLE.has(probe.fail_class) && probe.fail_class !== 'not_recorded')
  if (unrecoverable.length !== mine.length) {
    return { hard: false, why: `${mine.length - unrecoverable.length} of ${mine.length} failures are repairable` }
  }
  return { hard: true, why: `every one of ${mine.length} probes failed unrecoverably` }
}

/** Whether a probe scored better than the attempt it continued. */
export function probeImprovedVsParent(probe) {
  return typeof probe.delta_vs_parent === 'number' && probe.delta_vs_parent > 0
}

/** Whether a probe scored better than the target as it stood. */
export function probeImprovedVsBaseline(probe) {
  return typeof probe.delta_vs_baseline === 'number' && probe.delta_vs_baseline > 0
}

/** A cell the record never reached: spent probe, no result. Named so policies can say it. */
export const notRecorded = probe => probe.fail_class === 'not_recorded'

/** The repairable failure classes, for a policy that wants to name one. */
export const repairableClasses = [...REPAIRABLE]
