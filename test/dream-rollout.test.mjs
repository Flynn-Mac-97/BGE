import test from 'node:test'
import assert from 'node:assert/strict'

import { emptyGrid, legalActions } from '../tools/dream/grid.mjs'
import { attemptPatchName, makeOnlineQuestion, parseCell, rolloutOnce } from '../tools/dream/rollout.mjs'
import { replayGrid } from '../tools/dream/replay.mjs'
import { makePolicy } from '../tools/dream/policy.mjs'
import { addGrid, readPool } from '../tools/dream/pool.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * What the world would score, for a scripted attempt.
 *
 * Held outside the grid so the rollout has to ask for it: an attempt is the only
 * way to learn a score, which is the property the whole loop rests on.
 */
const TRUTH = { '0:0': 0.22, '1:0': 0.3, '1:1': 0.45, '1:2': 0.8, '0:1': 0.24, '2:0': 0.21 }

/** An attempt that reads the scripted truth, and says what its parent patch was. */
const scriptedAttempt = seen => async ({ cell, parent, id }) => {
  seen.push({ id, parentPatch: parent?.patchPath ?? null })
  const score = TRUTH[id]
  return {
    id,
    patchPath: `/patches/${id.split(':').join('-')}.patch`,
    outcome: score === undefined
      ? { score: null, verdict: 'refused', reason: 'nothing scored here', measures: {} }
      : { score, verdict: 'scored', reason: null, measures: { characters: 100 } }
  }
}

const freshGrid = (branchCount = 3, refineCount = 2) => emptyGrid({
  id: 'rollout-grid',
  target: 'a target',
  baseline: { value: 0.2, measures: {} },
  branchCount,
  refineCount
})

test('an attempt patch is named for its round, so a later round cannot overwrite it', () => {
  assert.equal(attemptPatchName({ round: 1, cell: '0:0' }), 'r001-b0a0.patch')
  assert.equal(attemptPatchName({ round: 2, cell: '0:0' }), 'r002-b0a0.patch')
  assert.notEqual(attemptPatchName({ round: 1, cell: '0:0' }), attemptPatchName({ round: 2, cell: '0:0' }))
  assert.equal(attemptPatchName({ round: 12, cell: '3:2' }), 'r012-b3a2.patch')
})

test('a live rollout makes exactly the attempts the policy asked for, in its order', async () => {
  const grid = freshGrid()
  const seen = []
  const rollout = await rolloutOnce({
    grid,
    policy: makePolicy('parallel-refine', 0.6),
    maxParallelism: 2,
    attempt: scriptedAttempt(seen)
  })

  assert.equal(rollout.failure, null, rollout.failure)
  assert.ok(rollout.probes > 0, 'the policy probed nothing')
  assert.equal(seen.length, rollout.probes, 'the rollout recorded a different number of attempts than it made')
  // The grid holds the outcomes, which is what makes it replayable afterwards.
  assert.equal(Object.keys(grid.cells).length, rollout.probes)
  assert.ok(rollout.attained >= 0.8 || rollout.probes < 4, `the rollout reached ${rollout.attained}`)
})

test('an attempt continues from its parent patch, so a branch is one line of work', async () => {
  const grid = freshGrid(1, 2)
  const seen = []
  await rolloutOnce({ grid, policy: makePolicy('greedy-best', 0.6), maxParallelism: 1, attempt: scriptedAttempt(seen) })

  assert.equal(seen[0].id, '0:0')
  assert.equal(seen[0].parentPatch, null, 'a branch root continued from a patch it has no parent for')
  assert.equal(seen[1].id, '0:1')
  assert.equal(seen[1].parentPatch, '/patches/0-0.patch', 'the refinement did not continue from its parent')
  assert.equal(seen[2].id, '0:2')
  assert.equal(seen[2].parentPatch, '/patches/0-1.patch', 'the second refinement did not continue from the first')
})

test('a rollout grid replayed scores the policy that produced it', async () => {
  const grid = freshGrid()
  await rolloutOnce({ grid, policy: makePolicy('parallel-refine', 0.6), maxParallelism: 3, attempt: scriptedAttempt([]) })

  // The recorded grid is now a simulator: the same policy replayed over it must
  // find what it found online, without making an attempt.
  const replayed = await replayGrid({ grid, policy: makePolicy('parallel-refine', 0.6), maxParallelism: 3 })
  assert.equal(replayed.failure, null)
  assert.ok(replayed.attainment >= 0.8, `the replay of an eight-tenths grid reached ${replayed.attainment}`)
  assert.ok(replayed.probes <= 3 * 3, 'the replay left the grid')
})

test('a rollout refuses an illegal probe rather than inventing a workspace', async () => {
  const grid = freshGrid(1, 2)
  const broken = {
    NAME: 'probes-ahead',
    async solve(question) {
      // Attempt 2 continues a workspace that does not exist yet.
      await question.probe_batch(['0:2'])
    }
  }
  const rollout = await rolloutOnce({ grid, policy: broken, maxParallelism: 2, attempt: scriptedAttempt([]) })

  assert.match(rollout.failure, /not a legal action/)
  assert.equal(Object.keys(grid.cells).length, 0, 'an illegal probe wrote a cell into the grid')
})

test('a live rollout accepts the paper call to reset before it starts, and refuses it after', async () => {
  const grid = freshGrid(1, 1)
  const { question } = makeOnlineQuestion({ grid, maxParallelism: 1, attempt: scriptedAttempt([]) })

  // The paper's loop resets before it solves, when there is nothing to reset.
  question.reset()
  await question.probe_batch(['0:0'])
  assert.throws(() => question.reset(), /cannot be reset/)
})

test('a cell id that is not two numbers is refused, not read as a missing attempt', () => {
  assert.deepEqual(parseCell('1:2'), { branch: 1, attempt: 2 })
  assert.equal(parseCell('1:2:3'), null)
  assert.equal(parseCell('one:two'), null)
  assert.equal(parseCell('1:-2'), null)
  assert.equal(parseCell(''), null)
})

test('a rollout grid joins the pool and is what a dreaming phase reads', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-rollout-'))
  const grid = freshGrid()
  await rolloutOnce({ grid, policy: makePolicy('parallel-refine', 0.6), maxParallelism: 2, attempt: scriptedAttempt([]) })

  const added = await addGrid(directory, grid)
  const pool = await readPool(directory)
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(added.error, undefined, added.error)
  assert.equal(pool.length, 1)
  assert.equal(Object.keys(pool[0].cells).length, Object.keys(grid.cells).length)
  // What was recorded online survives the round trip through JSON, which is what
  // lets a replay read it: same cells, same scores, same verdicts.
  for (const [id, cell] of Object.entries(grid.cells)) {
    assert.deepEqual(pool[0].cells[id].outcome, cell.outcome, `the pooled ${id} says something else`)
  }
  assert.equal(pool[0].baseline.value, grid.baseline.value, 'the pooled grid lost the score it started from')
})
