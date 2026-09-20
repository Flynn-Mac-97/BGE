/**
 * The paper's reward: early attainment less the parallel penalty.
 *
 * These tests hold the two quantities the paper names — the area under the
 * attainment-against-probes curve, and `effective_sequential_rounds / total_probes`
 * — and the rule that the two objectives are labelled and never mixed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyGrid, record } from '../tools/dream/grid.mjs'
import { DEFAULT_LAMBDA, DEFAULT_OBJECTIVE, effectiveSequentialRounds, makeQuestion, replayGrid, replaySweep } from '../tools/dream/replay.mjs'

const outcome = score => ({ score, verdict: 'scored', measures: {} })

/** Two roots: branch 0 scores well, branch 1 scores poorly. */
function twoRoots() {
  const grid = emptyGrid({ id: 'two-roots', baseline: { value: 0 }, branchCount: 2, refineCount: 0 })
  record(grid, { branch: 0, attempt: 0, outcome: outcome(0.9) })
  record(grid, { branch: 1, attempt: 0, outcome: outcome(0.1) })
  return grid
}

/** A policy that probes the named cells in order, one cell per batch. */
const probesInOrder = ids => ({
  NAME: 'ordered',
  solve(question) {
    question.reset()
    for (const id of ids) question.probe_batch([id])
  }
})

/** A policy that always fills its batch with whatever is legal. */
const fillsBatches = {
  NAME: 'full-batches',
  solve(question) {
    question.reset()
    while (question.legal_actions().length) question.probe_batch(question.legal_actions().slice(0, question.max_parallelism))
  }
}

test('a batch of k cells on W workers costs ceil(k / W) sequential rounds', () => {
  // k below W, k equal to W, and k above W, which is what an over-wide plan asks.
  assert.equal(effectiveSequentialRounds(1, 3), 1)
  assert.equal(effectiveSequentialRounds(2, 3), 1)
  assert.equal(effectiveSequentialRounds(3, 3), 1)
  assert.equal(effectiveSequentialRounds(4, 3), 2)
  assert.equal(effectiveSequentialRounds(6, 3), 2)
  assert.equal(effectiveSequentialRounds(7, 3), 3)

  // The question charges the same formula for the batches it accepts.
  const grid = emptyGrid({ id: 'charge', baseline: { value: 0 }, branchCount: 3, refineCount: 0 })
  for (let branch = 0; branch < 3; branch++) record(grid, { branch, attempt: 0, outcome: outcome(0.5) })
  const question = makeQuestion({ grid, maxParallelism: 3 })
  question.probe_batch(['0:0', '1:0'])
  assert.equal(question.usage().sequentialRounds, 1, 'two cells on three workers did not cost one round')
  question.probe_batch(['2:0'])
  assert.equal(question.usage().sequentialRounds, 2)
})

test('reaching a high score early scores better on AUC than reaching it late', async () => {
  const grid = twoRoots()
  const early = await replayGrid({ grid, policy: probesInOrder(['0:0', '1:0']), maxParallelism: 1 })
  const late = await replayGrid({ grid, policy: probesInOrder(['1:0', '0:0']), maxParallelism: 1 })

  assert.equal(early.probes, late.probes, 'the two routes spent a different number of probes')
  assert.equal(early.attainment, late.attainment, 'the two routes ended at different scores')
  assert.ok(early.auc > late.auc, `early ${early.auc} did not beat late ${late.auc}`)
  assert.ok(early.reward > late.reward, 'the paper reward did not prefer early attainment')
})

test('a fully serial policy pays a parallel penalty near one', async () => {
  const grid = emptyGrid({ id: 'serial', baseline: { value: 0 }, branchCount: 4, refineCount: 0 })
  for (let branch = 0; branch < 4; branch++) record(grid, { branch, attempt: 0, outcome: outcome(0.5 + branch / 10) })
  const serial = await replayGrid({ grid, policy: probesInOrder(['0:0', '1:0', '2:0', '3:0']), maxParallelism: 3 })

  assert.equal(serial.probes, 4)
  assert.equal(serial.sequentialRounds, 4, 'a one-cell batch cost more than one decision round')
  assert.ok(Math.abs(serial.parallelPenalty - 1) < 1e-6, `a serial policy paid ${serial.parallelPenalty}`)
})

test('filling the workers brings the parallel penalty towards one over W', async () => {
  const grid = emptyGrid({ id: 'batched', baseline: { value: 0 }, branchCount: 4, refineCount: 0 })
  for (let branch = 0; branch < 4; branch++) record(grid, { branch, attempt: 0, outcome: outcome(0.5) })
  const batched = await replayGrid({ grid, policy: fillsBatches, maxParallelism: 4 })

  assert.equal(batched.probes, 4)
  assert.equal(batched.sequentialRounds, 1)
  assert.equal(batched.parallelPenalty, 0.25, 'a full batch of four workers did not cost one over four')
})

test('the two objectives are labelled and never mixed into one number', async () => {
  const grid = twoRoots()
  const policy = probesInOrder(['0:0', '1:0'])
  const paper = await replayGrid({ grid, policy, maxParallelism: 1 })
  const legacy = await replayGrid({ grid, policy, maxParallelism: 1, objective: 'legacy' })

  assert.equal(DEFAULT_OBJECTIVE, 'pareto')
  assert.equal(paper.objective, 'pareto')
  assert.equal(legacy.objective, 'legacy')
  assert.equal(paper.reward, paper.paretoReward, 'the paper reward is not the ranked number')
  assert.equal(legacy.reward, legacy.legacyReward, 'the legacy reward is not the ranked number')
  assert.notEqual(paper.paretoReward, legacy.legacyReward, 'the two objectives produced the same number')
})

test('an unknown objective is refused rather than scored', async () => {
  await assert.rejects(
    () => replayGrid({ grid: twoRoots(), policy: probesInOrder(['0:0']), objective: 'auc-only' }),
    /unknown objective/
  )
})

test('the sweep reports the paper reward from the mean AUC and mean penalty', async () => {
  const sweep = await replaySweep({ grids: [twoRoots()], makePolicy: () => probesInOrder(['0:0', '1:0']), betas: [0, 1], lambda: 0.5 })

  assert.equal(sweep.objective, 'pareto')
  assert.equal(sweep.lambda, 0.5)
  assert.equal(sweep.parallelPenalty, 1, 'the serial policy paid no parallel penalty in the sweep')
  assert.equal(sweep.paretoReward, Number((sweep.paretoAuc - 0.5 * sweep.parallelPenalty).toFixed(6)))
  assert.equal(sweep.meanReward, sweep.paretoReward, 'the sweep reward is not the paper reward')
  for (const point of sweep.points) assert.equal(point.objective, 'pareto')
})

test('lambda is the evaluator coefficient, not a knob a policy can reach', async () => {
  const grid = twoRoots()
  const question = makeQuestion({ grid, maxParallelism: 1 })
  const replay = await replayGrid({ grid, policy: probesInOrder(['0:0']), maxParallelism: 1 })

  assert.equal(DEFAULT_LAMBDA, 0.5)
  assert.equal(question.lambda, undefined, 'a policy can read the evaluator coefficient')
  assert.equal(replay.lambda, DEFAULT_LAMBDA)
})
