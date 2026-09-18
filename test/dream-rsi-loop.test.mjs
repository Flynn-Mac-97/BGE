import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { bestAttemptOf, planRound, rsiRun, seedPool } from '../tools/dream/rsi.mjs'
import { readPool } from '../tools/dream/pool.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECKOUT = path.resolve(HERE, '..')
const apiUrl = pathToFileURL(path.join(CHECKOUT, 'tools/dream/policy-api.mjs')).href

/** What the scripted world scores, so a policy's route is visible in its reward. */
const TRUTH = { '0:0': 0.22, '0:1': 0.24, '1:0': 0.3, '1:1': 0.45, '1:2': 0.8, '2:0': 0.21 }

/**
 * A run directory that is ready to explore: a frozen setup, a target, and the
 * score the target as it stands was given. No agent is involved, so the setup's
 * tasks are never run — only its shape is loaded.
 */
async function readyRun() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-rsi-'))
  await fs.writeFile(path.join(directory, 'target.json'), `${JSON.stringify({ target: 'a target', files: [], startedAt: new Date().toISOString() })}\n`, 'utf8')
  await fs.writeFile(path.join(directory, 'setup.mjs'), 'export default { name: "scripted", project: "test/fixture-project", weights: {}, tasks: [{ id: "t", question: "q", run: () => ({ pass: true, problem: null, measures: {} }) }] }\n', 'utf8')
  await fs.writeFile(path.join(directory, 'setup-check.json'), `${JSON.stringify({
    name: 'scripted',
    project: 'test/fixture-project',
    weights: {},
    tasks: [{ id: 't', question: 'q' }],
    digest: 'scripted-digest',
    working: { value: 0.2, totals: { measures: { characters: 100 } } },
    control: { value: 0, reason: 'refused on purpose' }
  }, null, 2)}\n`, 'utf8')
  return directory
}

/** One attempt, reading the scripted truth and writing a patch the next attempt can continue from. */
const attempt = patchDirectory => async ({ cell, parent, id }) => {
  const patchPath = path.join(patchDirectory, `${id.split(':').join('-')}.patch`)
  await fs.mkdir(path.dirname(patchPath), { recursive: true })
  await fs.writeFile(patchPath, `diff for ${id} on top of ${parent?.patchPath ?? 'the target'}\n`, 'utf8')
  const score = TRUTH[id]
  return {
    id,
    patchPath,
    outcome: score === undefined
      ? { score: null, verdict: 'refused', reason: 'nothing here', measures: {} }
      : { score, verdict: 'scored', reason: null, measures: { characters: 100 } }
  }
}

/** A reviser that writes a policy which goes straight for branch 1, where the win is. */
const writesBranchOneFirst = async ({ policyFile }) => {
  await fs.writeFile(policyFile, `import { LLMDesignedMethod } from '${apiUrl}'\n`
    + 'class BranchOneFirst extends LLMDesignedMethod {\n'
    + '  constructor(config) { super(config); this.NAME = "branch-one-first" }\n'
    + '  async solve(question) {\n'
    + '    question.reset()\n'
    + '    while (question.legal_actions().length) {\n'
    + '      const legal = question.legal_actions()\n'
    + '      const first = legal.filter(id => id.startsWith("1:"))\n'
    + '      const batch = (first.length ? first : legal).slice(0, question.max_parallelism)\n'
    + '      if (!batch.length) break\n'
    + '      await question.probe_batch(batch)\n'
    + '    }\n'
    + '  }\n'
    + '}\n'
    + 'export default BranchOneFirst\n', 'utf8')
  return { ok: true, status: 'completed', text: 'goes for branch one', durationMs: 1, tokens: null }
}

test('a round is planned from what earlier rounds did, not from this one', () => {
  const thin = planRound({ history: [] })
  assert.equal(thin.branchCount, 2, 'the first round did not use the conservative fallback')
  assert.match(thin.reason, /no earlier rollout/)

  const wider = planRound({ history: [{ plannedBranchCount: 2, plannedRefineCount: 2, bestAttempt: 0 }] })
  assert.equal(wider.branchCount, 3, 'a win at a branch root did not widen the next plan')

  const deeper = planRound({ history: [{ plannedBranchCount: 3, plannedRefineCount: 2, bestAttempt: 2 }] })
  assert.equal(deeper.refineCount, 3, 'a late win did not deepen the next plan')

  const capped = planRound({ history: Array.from({ length: 6 }, () => ({ plannedBranchCount: 4, plannedRefineCount: 4, bestAttempt: 0 })) })
  assert.ok(capped.branchCount <= 4 && capped.refineCount <= 4, 'the plan left the caps')
})

test('the best attempt of a grid is the attempt with the highest score', () => {
  const grid = { cells: { '0:0': { attempt: 0, outcome: { score: 0.2 } }, '1:1': { attempt: 1, outcome: { score: 0.5 } }, '1:0': { attempt: 0, outcome: { score: null } } } }
  assert.equal(bestAttemptOf(grid), 1)
  assert.equal(bestAttemptOf({ cells: {} }), null, 'a grid with nothing scored reported an attempt')
})

test('the whole loop explores, pools, dreams, redeploys and names a winner', async () => {
  const directory = await readyRun()
  const patches = path.join(directory, 'patches')

  const result = await rsiRun({
    checkout: CHECKOUT,
    runDirectory: directory,
    rounds: 2,
    versions: 2,
    maxParallelism: 2,
    attempt: attempt(patches),
    revise: writesBranchOneFirst
  })

  const files = await fs.readdir(directory)
  const summary = JSON.parse(await fs.readFile(path.join(directory, 'rsi-summary.json'), 'utf8'))
  const deployed = JSON.parse(await fs.readFile(path.join(directory, 'rsi.json'), 'utf8'))
  const pool = await fs.readdir(path.join(directory, 'pool'))
  const roundFiles = {}
  for (const name of ['round-001', 'round-002']) {
    roundFiles[name] = await fs.readdir(path.join(directory, 'rsi', name)).catch(() => [])
  }
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(result.error, undefined, result.error)
  assert.equal(result.rounds.length, 2, 'the loop did not run both rounds')
  assert.equal(pool.length, 2, 'each round should add one grid to the pool')
  assert.equal(summary.pool.grids, 2)
  assert.ok(result.rounds.every(round => round.rollout.probes > 0), 'a round explored nothing')
  assert.equal(result.rounds[0].rollout.failure, null, result.rounds[0].rollout.failure)

  // Round one played the shipping policy; round two played what dreaming deployed.
  assert.equal(result.rounds[0].policy.name, 'parallel-refine')
  assert.equal(result.rounds[1].policy.name, 'branch-one-first', 'the redeployed policy was not the one dreaming selected')
  assert.equal(result.rounds[0].dreaming.winner.file.endsWith('v001.mjs'), true, 'round one did not select the revised version')
  assert.equal(result.rounds[0].dreaming.improved, true, 'the revised version did not beat the shipping policy')
  // Round two's revision writes the same policy again, so the version it started
  // from ties with it — and a tie keeps the policy already deployed, which is the
  // paper's guarantee that the selected policy is never worse than the current one.
  assert.equal(result.rounds[1].dreaming.winner.version, 0, 'an unchanged revision displaced the policy it was copied from')
  assert.equal(result.rounds[1].dreaming.gain, 0)

  assert.equal(summary.best.score, 0.8, 'the winner is not the best attempt that was really made')
  assert.equal(summary.improvement, 0.6)
  assert.ok(files.includes('winner.patch'), 'the winner patch was not written')
  assert.equal(deployed.phase, 'done')
  for (const name of ['round-001', 'round-002']) {
    assert.ok(roundFiles[name].includes('rollout.json'), `${name} kept no rollout record`)
    assert.ok(roundFiles[name].includes('dreaming.json'), `${name} kept no dreaming record`)
  }
})

test('a pinned plan bounds what a first run may spend, whatever the history says', () => {
  const pinned = planRound({ history: [{ plannedBranchCount: 4, plannedRefineCount: 4, bestAttempt: 0 }], fixed: { branchCount: 2, refineCount: 1 } })
  assert.equal(pinned.branchCount, 2)
  assert.equal(pinned.refineCount, 1)
  assert.match(pinned.reason, /pinned/)
})

test('the pool is seeded from runs that already recorded attempts', async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-seed-checkout-'))
  const past = path.join(checkout, 'agent-runs', 'dream-past-run')
  const now = path.join(checkout, 'agent-runs', 'dream-now-run')
  await fs.mkdir(path.join(past, 'rounds/r0001'), { recursive: true })
  await fs.mkdir(now, { recursive: true })
  await fs.writeFile(path.join(past, 'setup-check.json'), `${JSON.stringify({ working: { value: 0.4, totals: { measures: {} } } })}\n`, 'utf8')
  await fs.writeFile(path.join(past, 'rounds/r0001/past-r1c1.json'), `${JSON.stringify({ id: 'past-r1c1', verdict: 'scored', value: 0.7, measures: {}, best: true, depth: 1 })}\n`, 'utf8')

  const seeded = await seedPool({ checkout, runDirectory: now, limit: 3 })
  const pool = await readPool(now)
  await fs.rm(checkout, { recursive: true, force: true })

  assert.equal(seeded.length, 1, 'an earlier run with a recorded attempt was not seeded')
  assert.equal(pool.length, 1)
  assert.equal(pool[0].cells['0:0'].outcome.score, 0.7, 'the seeded grid lost the score the earlier run recorded')
  assert.equal(pool[0].baseline.value, 0.4)
})

test('a run that is asked to stop stops after the round in flight', async () => {
  const directory = await readyRun()
  await fs.writeFile(path.join(directory, 'stop'), `${new Date().toISOString()}\n`, 'utf8')

  const result = await rsiRun({
    checkout: CHECKOUT,
    runDirectory: directory,
    rounds: 3,
    versions: 2,
    maxParallelism: 1,
    attempt: attempt(path.join(directory, 'patches')),
    revise: writesBranchOneFirst
  })
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(result.rounds.length, 0, 'a stopped run explored anyway')
  assert.equal(result.best, null)
})
