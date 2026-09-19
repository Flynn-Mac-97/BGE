import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { emptyGrid, record, legalActions, gridFromRun, observationOf } from '../tools/dream/grid.mjs'
import { makeQuestion, replayGrid, replayPool, replaySweep } from '../tools/dream/replay.mjs'
import { GreedyBest, SerialRefine, ParallelRefine, makePolicy, loadPolicy, policySource } from '../tools/dream/policy.mjs'
import { LLMDesignedMethod, SimResult, recordCurve, finalizeResult, budgetDone, planFromHistory } from '../tools/dream/policy-api.mjs'
import { branchFailedHard, branchPromising } from '../tools/dream/observation-signal.mjs'

/**
 * A grid where branch 0 is a dead end and branch 1 holds the win at depth 2.
 *
 * Deliberately shaped so the three policies cannot tie: a serial explorer that
 * refines what it has will sit on branch 0, an exploiter will never look at
 * branch 1, and only a policy that opens branches and fills batches finds 1:2.
 */
function gridWithOneGoodBranch() {
  const grid = emptyGrid({ id: 'test-grid', target: 'a target', baseline: { value: 0.2, measures: {} }, branchCount: 3, refineCount: 2 })
  const outcome = (score, verdict = 'scored') => ({ score, verdict, reason: verdict === 'scored' ? null : 'refused on purpose', measures: {} })
  record(grid, { branch: 0, attempt: 0, outcome: outcome(0.21) })
  record(grid, { branch: 0, attempt: 1, outcome: outcome(null, 'refused') })
  record(grid, { branch: 0, attempt: 2, outcome: outcome(null, 'refused') })
  record(grid, { branch: 1, attempt: 0, outcome: outcome(0.3) })
  record(grid, { branch: 1, attempt: 1, outcome: outcome(0.5) })
  record(grid, { branch: 1, attempt: 2, outcome: outcome(0.9) })
  record(grid, { branch: 2, attempt: 0, outcome: outcome(0.22) })
  return grid
}

test('a grid only ever offers a branch root or the next attempt of an opened branch', () => {
  const grid = emptyGrid({ id: 'g', baseline: { value: 0.1 }, branchCount: 2, refineCount: 2 })
  assert.deepEqual(legalActions(grid), ['0:0', '1:0'], 'unopened branches are not roots')

  record(grid, { branch: 0, attempt: 0, outcome: { score: 0.2, verdict: 'scored' } })
  assert.deepEqual(legalActions(grid), ['0:1', '1:0'], 'attempt 1 opens only after attempt 0')

  record(grid, { branch: 0, attempt: 1, outcome: { score: 0.3, verdict: 'scored' } })
  record(grid, { branch: 0, attempt: 2, outcome: { score: 0.4, verdict: 'scored' } })
  assert.deepEqual(legalActions(grid), ['1:0'], 'a full branch offers nothing more')
})

test('a replay is deterministic and spends no agent and no process', async () => {
  const grid = gridWithOneGoodBranch()
  const first = await replayGrid({ grid, policy: makePolicy('parallel-refine'), maxParallelism: 3 })
  const second = await replayGrid({ grid, policy: makePolicy('parallel-refine'), maxParallelism: 3 })

  assert.deepEqual(second, first, 'the same policy on the same grid replayed differently')
  assert.equal(first.failure, null)
  assert.ok(first.probes > 0, 'nothing was probed')
  // A replay never leaves the grid: every probe is a cell of a finite
  // environment, and a cell the run never reached costs a probe and returns
  // nothing. Probing the same grid twice costs exactly the same.
  assert.ok(first.probes <= 3 * 3, `the replay probed ${first.probes} cells of a nine-cell grid`)
  assert.equal(first.attainment, 0.9, 'the replay did not reach the recorded best')
})

test('a policy sees only what it revealed, and an unreached cell is not a failure', () => {
  const grid = emptyGrid({ id: 'g', baseline: { value: 0.1 }, branchCount: 2, refineCount: 2 })
  record(grid, { branch: 0, attempt: 0, outcome: { score: 0.4, verdict: 'scored' } })
  const question = makeQuestion({ grid, maxParallelism: 2 })

  assert.deepEqual(question.observed(), {}, 'a fresh question revealed something')
  assert.equal(question.meta('1:1').revealed, false, 'an unrevealed cell reported itself revealed')
  assert.equal(question.meta('1:1').outcome, null)

  question.probe_batch(['0:0', '1:0'])
  const observed = question.observed()
  assert.deepEqual(Object.keys(observed).sort(), ['0:0', '1:0'])
  assert.equal(observed['0:0'].score, 0.4)
  assert.equal(observed['1:0'].evaluated, false, 'a cell the run never reached read as evaluated')
  assert.equal(observed['1:0'].fail_class, 'not_recorded')
  assert.equal(observed['0:0'].delta_vs_baseline, 0.3, 'the delta against the baseline is wrong')
})

test('the question refuses an illegal batch rather than repairing it', () => {
  const grid = emptyGrid({ id: 'g', baseline: { value: 0.1 }, branchCount: 2, refineCount: 2 })
  const question = makeQuestion({ grid, maxParallelism: 3 })

  assert.throws(() => question.probe_batch(['0:1']), /not a legal action/, 'attempt 1 was allowed before attempt 0')
  assert.throws(() => question.probe_batch(['0:0', '1:0', '1:0']), /twice/, 'a repeated cell was allowed')
  assert.throws(() => question.probe_batch(['0:0', '1:0', '0:0']), /twice|not a legal/, 'a repeated cell was allowed')
})

test('max_parallelism is a limit, not a suggestion', () => {
  const grid = emptyGrid({ id: 'g', baseline: { value: 0.1 }, branchCount: 4, refineCount: 0 })
  const question = makeQuestion({ grid, maxParallelism: 2 })
  assert.throws(() => question.probe_batch(['0:0', '1:0', '2:0']), /exceeds max_parallelism/)
  assert.equal(question.probe_batch(['0:0', '1:0']).length, 2)
})

test('the paper reward counts non-root attempts and rewards batching', async () => {
  const grid = gridWithOneGoodBranch()
  const serial = await replayGrid({ grid, policy: makePolicy('serial-refine'), maxParallelism: 3 })
  const roots = serial.trace.reduce((total, round) => total + round.batch.filter(id => Number(String(id).split(':')[1]) === 0).length, 0)
  assert.equal(serial.attempts, serial.probes - roots, 'root probes were charged as refinements')
  assert.ok(serial.parallelBonus > 0, 'serial refinement did not earn a batching term')

  // A policy that always fills the batch: the paper's other stated check.
  const greedy = { NAME: 'full-batches', solve(question) { question.reset(); while (question.legal_actions().length) question.probe_batch(question.legal_actions().slice(0, question.max_parallelism)) } }
  const filled = await replayGrid({ grid, policy: greedy, maxParallelism: 3 })
  assert.ok(filled.parallelBonus >= 0, 'the batching term was not recorded')
  assert.equal(filled.reward, Number((filled.quality - 0.01 * filled.attempts + 0.5 * filled.parallelBonus).toFixed(6)))
})

test('a policy that opens branches and fills batches beats one that only refines', async () => {
  const grid = gridWithOneGoodBranch()
  const parallel = await replayGrid({ grid, policy: makePolicy('parallel-refine'), maxParallelism: 3 })
  const serial = await replayGrid({ grid, policy: makePolicy('serial-refine'), maxParallelism: 3 })
  const greedy = await replayGrid({ grid, policy: new GreedyBest({ beta: 0.6 }), maxParallelism: 3 })

  assert.ok(parallel.reward > serial.reward, 'batching did not pay')
  assert.ok(parallel.attainment > greedy.attainment, 'opening branches did not pay on a grid where the win is on branch 1')
  assert.equal(greedy.attainment, 0.21, 'the exploiter was expected to sit on the branch it opened')
})

test('a policy written to the paper shape runs here, curve and all', async () => {
  const grid = gridWithOneGoodBranch()

  // Listing 2's loop, in its own idiom: a class, a solve, a curve recorded on
  // every reveal, and a result finalized at the end.
  class PaperShapedPolicy extends LLMDesignedMethod {
    constructor(config) {
      super(config)
      this.NAME = 'paper-shaped'
    }

    solve(question, budget = null) {
      question.reset()
      const result = new SimResult()
      while (!budgetDone(question, budget)) {
        const prefix = question.observed()
        const roots = question.legal_roots()
        const legal = question.legal_actions()
        // The paper's rule: a declared success is one whose error is null and
        // whose class is ok, and a branch with a failure is not closed by it.
        const promising = [0, 1, 2].find(branch => branchPromising(prefix, branch).promising) ?? null
        const batch = []
        if (roots.length) batch.push(roots[0])
        if (promising !== null && Object.keys(prefix).length) {
          const depth = Math.max(...Object.values(prefix).filter(one => one.branch === promising).map(one => one.attempt)) + 1
          const next = `${promising}:${depth}`
          if (legal.includes(next)) batch.push(next)
        }
        if (!batch.length) break
        question.probe_batch(batch.slice(0, question.max_parallelism), () => recordCurve(result, question))
      }
      return finalizeResult(question, result)
    }
  }

  const policy = new PaperShapedPolicy({ beta: 0.5 })
  const replay = await replayGrid({ grid, policy, maxParallelism: 2 })

  assert.equal(replay.failure, null, 'the paper-shaped policy failed')
  assert.ok(replay.probes >= 2)
  assert.equal(replay.beta, 0.5, 'beta was not carried from the config')
  assert.equal(policy.best_so_far, undefined, 'best_so_far must not be a property a policy can set')
  assert.ok(replay.trace.length > 0, 'the replay kept no trace to show the agent that revises the policy')
})

test('a sweep says whether beta changes anything at all', async () => {
  const grid = gridWithOneGoodBranch()
  const flat = await replaySweep({ grids: [grid], makePolicy: beta => ({ NAME: 'ignores-beta', beta, solve: question => makePolicy('parallel-refine', beta).solve(question) }), betas: [0, 0.5, 1] })
  assert.equal(flat.degenerate, false, 'a policy whose behaviour varies with beta was called degenerate')

  const constant = await replaySweep({ grids: [grid], makePolicy: beta => ({ NAME: 'constant', beta, solve: question => makePolicy('serial-refine', beta).solve(question) }), betas: [0, 0.5, 1] })
  assert.equal(constant.degenerate, true, 'a policy that ignores beta was reported as exposing a trade-off')
})

test('a policy version loads from a file, and one without a solve is refused', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-policy-'))
  const starter = await policySource('parallel-refine', { into: directory })
  const file = path.join(directory, 'policy.mjs')
  await fs.writeFile(file, starter.source, 'utf8')

  const loaded = await loadPolicy(file)
  assert.equal(loaded.error, undefined, `the starter policy did not load: ${loaded.error}`)
  const replay = await replayGrid({ grid: gridWithOneGoodBranch(), policy: loaded.policy, maxParallelism: 3 })
  assert.equal(replay.attainment, 0.9, 'the policy loaded from the run directory did not reach the recorded best')

  const bad = path.join(directory, 'no-solve.mjs')
  await fs.writeFile(bad, 'export default { NAME: "nameless", nothing: true }\n', 'utf8')
  const refused = await loadPolicy(bad)
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(refused.error, /no policy with a solve/)
})

test('a grid read from a run is one branch, refined once per round', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-gridrun-'))
  await fs.mkdir(path.join(directory, 'rounds/r0001'), { recursive: true })
  await fs.writeFile(path.join(directory, 'setup-check.json'), `${JSON.stringify({ working: { value: 0.4, totals: { measures: { characters: 100 } } } })}\n`, 'utf8')
  await fs.writeFile(path.join(directory, 'target.json'), `${JSON.stringify({ target: 'a target' })}\n`, 'utf8')
  await fs.writeFile(path.join(directory, 'rounds/r0001/run-r1c1.json'), `${JSON.stringify({ id: 'run-r1c1', verdict: 'scored', value: 0.55, measures: { characters: 80 }, best: true, depth: 1 })}\n`, 'utf8')

  const { grid, attempts } = await gridFromRun(directory, { branchCount: 3 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(attempts, 1)
  assert.equal(grid.baseline.value, 0.4)
  assert.equal(grid.cells['0:0'].outcome.score, 0.55, 'the first candidate opens the branch at attempt 0')
  assert.deepEqual(legalActions(grid), ['0:1', '1:0', '2:0'], 'the grid did not offer a refinement and two unopened branches')
})

test('a cost plan is derived from what earlier rollouts did, inside the caps', () => {
  const thin = planFromHistory({ history: [], fallback: { branchCount: 9, refineCount: 9 }, hardMaxBranchCount: 3, hardMaxRefineCount: 2 })
  assert.equal(thin.branchCount, 3, 'the bootstrap ignored the cap')
  assert.match(thin.reason, /no earlier rollout/)

  const wider = planFromHistory({
    history: [{ plannedBranchCount: 2, plannedRefineCount: 2, bestAttempt: 0 }],
    hardMaxBranchCount: 4,
    hardMaxRefineCount: 4
  })
  assert.equal(wider.branchCount, 3, 'a win at the root should widen the next rollout')
  assert.equal(wider.refineCount, 2)

  const deeper = planFromHistory({
    history: [{ plannedBranchCount: 2, plannedRefineCount: 4, bestAttempt: 4 }],
    hardMaxBranchCount: 4,
    hardMaxRefineCount: 4
  })
  assert.equal(deeper.refineCount, 4, 'a late win should deepen, within the cap')
  assert.match(deeper.reason, /late/)
})

test('a failed check is an evaluated zero a policy may repair', () => {
  const grid = emptyGrid({ id: 'g', baseline: { value: 0.5 }, branchCount: 1, refineCount: 0 })
  record(grid, {
    branch: 0,
    attempt: 0,
    outcome: {
      score: 0,
      verdict: 'failed',
      evaluated: true,
      valid: false,
      failClass: 'correctness',
      error: 'find-player: no entity of type player',
      nValid: 2,
      nTotal: 3,
      measures: {}
    }
  })

  const observed = observationOf(grid.cells['0:0'], grid)
  assert.equal(observed.evaluated, true, 'a failed check was reported as unevaluated')
  assert.equal(observed.score, 0, 'a failed check did not score zero')
  assert.equal(observed.valid, false)
  assert.equal(observed.fail_class, 'correctness')
  assert.equal(observed.n_valid, 2)
  assert.equal(observed.n_total, 3)
  assert.equal(branchFailedHard({ '0:0': observed }, 0).hard, false, 'a failed check closed the branch')
})

test('a policy that counts its own successes follows the paper, not a validity flag', () => {
  const observations = {
    '0:0': { branch: 0, attempt: 0, score: 0.5, evaluated: true, valid: false, fail_class: 'ok', error: null, delta_vs_baseline: 0.2, delta_vs_parent: null },
    '0:1': { branch: 0, attempt: 1, score: null, evaluated: true, valid: false, fail_class: 'shape', error: 'shape mismatch', delta_vs_baseline: null, delta_vs_parent: null }
  }
  // valid is false and the evaluation still counts: the paper is explicit that a
  // successful evaluation is not one with valid true.
  assert.deepEqual(branchPromising(observations, 0), { promising: true, anchored: true, climbing: false })
  const dead = branchFailedHard(observations, 0)
  assert.equal(dead.hard, false, 'a repairable failure closed a branch with a successful anchor')
  assert.match(dead.why, /successful evaluation/)

  const onlyRepairable = { '1:0': { branch: 1, attempt: 0, score: null, evaluated: true, valid: false, fail_class: 'shape', error: 'x', delta_vs_baseline: null, delta_vs_parent: null } }
  assert.equal(branchFailedHard(onlyRepairable, 1).hard, false, 'one repairable failure closed a branch')

  const hard = { '2:0': { branch: 2, attempt: 0, score: null, evaluated: true, valid: false, fail_class: 'refused', error: 'the setup changed', delta_vs_baseline: null, delta_vs_parent: null } }
  assert.equal(branchFailedHard(hard, 2).hard, true, 'an unrecoverable failure did not close a branch')
})
