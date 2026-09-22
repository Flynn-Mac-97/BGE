import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { bestAttemptOf, planRound, recordedRsiRounds, rsiRun, seedPool } from '../tools/dream/rsi.mjs'
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
  const outcome = score === undefined
    ? { score: null, verdict: 'refused', reason: 'nothing here', measures: {} }
    : { score, verdict: 'scored', reason: null, measures: { characters: 100 } }
  // The shape a real attempt returns. The loop writes this record beside the
  // patch so the next attempt in the same round can read it.
  return {
    id,
    patchPath,
    outcome,
    record: {
      id: `rsi-b${cell.branch}-r0c${cell.attempt + 1}`,
      parent: parent ? `${cell.branch}:${cell.attempt - 1}` : 'target',
      depth: cell.attempt + 1,
      verdict: outcome.verdict,
      value: outcome.score,
      evaluated: outcome.score !== null,
      reason: outcome.reason,
      measures: outcome.measures,
      report: `scripted attempt ${id}`,
      tokens: null,
      cost: null
    }
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
  const attemptRecords = {}
  for (const name of ['round-001', 'round-002']) {
    roundFiles[name] = await fs.readdir(path.join(directory, 'rsi', name)).catch(() => [])
    // One full record per attempt, written as it ends so the next attempt in the
    // same round can read it. Its patch path is what makes the change readable.
    attemptRecords[name] = await Promise.all(
      roundFiles[name].filter(file => /^rsi-b\d+-r\d+c\d+\.json$/.test(file))
        .map(file => fs.readFile(path.join(directory, 'rsi', name, file), 'utf8').then(JSON.parse))
    )
  }
  const versionFiles = await fs.readdir(path.join(directory, 'policy')).catch(() => [])
  const replayFiles = await fs.readdir(path.join(directory, 'replay')).catch(() => [])
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(result.error, undefined, result.error)
  assert.equal(result.rounds.length, 2, 'the loop did not run both rounds')
  assert.equal(pool.length, 2, 'each round should add one grid to the pool')
  assert.equal(summary.pool.grids, 2)
  assert.ok(result.rounds.every(round => round.rollout.probes > 0), 'a round explored nothing')
  assert.equal(result.rounds[0].rollout.failure, null, result.rounds[0].rollout.failure)

  // Round one played the shipping policy; round two played what dreaming deployed.
  assert.equal(result.rounds[0].policy.name, 'parallel-refine')
  const winnerVersion = result.rounds[0].dreaming.winner.version
  const winnerName = result.rounds[0].dreaming.versions.find(version => version.version === winnerVersion).policy
  assert.equal(result.rounds[1].policy.name, winnerName, 'the redeployed policy was not the one dreaming selected')
  assert.ok(result.rounds[0].dreaming.winner, 'round one did not select a policy')
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
    assert.ok(attemptRecords[name].length > 0, `${name} kept no per-attempt record`)
    assert.ok(attemptRecords[name].every(record => record.patchFile), `${name} lost an attempt's patch path`)
    // The phase's versions are archived under the phase label, not overwritten
    // by the next round's.
    assert.ok(roundFiles[name].some(file => file === 'grid.json'))
  }
  assert.ok(versionFiles.includes('r001-v001.mjs') && versionFiles.includes('r002-v001.mjs'), `each phase kept no archived versions: ${versionFiles.join(', ')}`)
  assert.ok(replayFiles.includes('r001-v001.json') && replayFiles.includes('r002-v001.json'), `each phase kept no replay record: ${replayFiles.join(', ')}`)
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

test('a run reads its own rounds, so a resume never writes over one', async () => {
  const directory = await readyRun()
  const earlier = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(earlier, { recursive: true })
  const recorded = `${JSON.stringify({ round: 1, plan: { branchCount: 2, refineCount: 1 }, policy: { name: 'parallel-refine' }, rollout: { probes: 4, attained: 0.65 } })}\n`
  await fs.writeFile(path.join(earlier, 'rollout.json'), recorded, 'utf8')
  await fs.writeFile(path.join(earlier, 'grid.json'), `${JSON.stringify({ id: 'earlier', branchCount: 2, refineCount: 1, cells: { '0:0': { branch: 0, attempt: 0, outcome: { score: 0.5 } }, '1:1': { branch: 1, attempt: 1, outcome: { score: 0.65 } } } })}\n`, 'utf8')

  const before = await recordedRsiRounds(directory)
  const result = await rsiRun({
    checkout: CHECKOUT,
    runDirectory: directory,
    rounds: 1,
    versions: 2,
    maxParallelism: 1,
    fixedPlan: { branchCount: 1, refineCount: 0 },
    attempt: attempt(path.join(directory, 'patches')),
    revise: writesBranchOneFirst
  })

  const after = await fs.readFile(path.join(earlier, 'rollout.json'), 'utf8')
  const dirs = (await fs.readdir(path.join(directory, 'rsi'))).filter(name => name.startsWith('round-')).sort()
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(before.length, 1)
  assert.equal(before[0].number, 1)
  assert.equal(before[0].plannedBranchCount, 2, 'the plan earlier rounds used was not read back')
  assert.equal(before[0].bestAttempt, 1, 'the best attempt of the recorded grid was not read back')
  // The summary is cumulative: it describes every round the run has recorded, not
  // only the ones the invocation that wrote it happened to make.
  assert.deepEqual(result.rounds.map(round => round.round), [1, 2], 'the resumed run numbered its round one again, or lost the earlier round')
  assert.deepEqual(dirs, ['round-001', 'round-002'])
  assert.equal(after, recorded, 'the round already recorded was written over')
})

test('a run draws its grids and its replay, and writes the document beside them', async () => {
  const directory = await readyRun()
  const result = await rsiRun({
    checkout: CHECKOUT,
    runDirectory: directory,
    rounds: 1,
    versions: 2,
    maxParallelism: 2,
    fixedPlan: { branchCount: 2, refineCount: 1 },
    attempt: attempt(path.join(directory, 'patches')),
    revise: writesBranchOneFirst
  })

  const grid = await fs.readFile(path.join(directory, 'rsi/grid.svg'), 'utf8')
  const replay = await fs.readFile(path.join(directory, 'rsi/replay.svg'), 'utf8')
  const document = await fs.readFile(path.join(directory, 'rsi/report.md'), 'utf8')
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(result.error, undefined, result.error)
  for (const [name, svg] of [['grid', grid], ['replay', replay]]) {
    assert.equal((svg.match(/<svg/g) ?? []).length, 1, `${name}.svg is not one svg`)
    assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1, `${name}.svg is not closed`)
    assert.doesNotMatch(svg, /NaN|undefined/, `${name}.svg has a missing number`)
  }
  // The grid picture draws every cell of the planned environment, including the
  // ones the policy never went to, and the order it probed the rest in.
  for (const cell of ['0:0', '1:0', '0:1', '1:1']) {
    assert.match(grid, new RegExp(`>${cell.replace(':', ':')}<|${cell}`), `grid.svg does not draw ${cell}`)
  }
  assert.match(grid, />1</, 'the probe order is not drawn')
  // The replay picture names the policies it plots and marks a flat sweep.
  assert.match(replay, /parallel-refine/)
  assert.match(replay, /branch-one-first/)
  assert.match(replay, /ignores beta/, 'a flat sweep was not marked')
  assert.match(document, /# Dream-RSI/)
  assert.match(document, /Target as it stood/)
  assert.match(document, /grid\.svg/)
  assert.match(document, /replay\.svg/)
})

test('a stop file left over from an earlier run refuses the run instead of doing nothing', async () => {
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
  const status = JSON.parse(await fs.readFile(path.join(directory, 'rsi.json'), 'utf8'))
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(result.error, /stop file is already in this run directory/, 'a stale stop file was obeyed silently')
  assert.equal(result.rounds, undefined, 'a refused run explored anyway')
  assert.equal(status.phase, 'refused')
})

test('a stop during a round ends the run after the work in flight', async () => {
  const directory = await readyRun()
  const stopAfterFirstProbe = async ({ id }) => {
    await fs.writeFile(path.join(directory, 'stop'), `${new Date().toISOString()}\n`, 'utf8')
    return { id, patchPath: null, outcome: { score: 0.3, verdict: 'scored', reason: null, measures: {} } }
  }

  const result = await rsiRun({
    checkout: CHECKOUT,
    runDirectory: directory,
    rounds: 3,
    versions: 2,
    maxParallelism: 1,
    attempt: stopAfterFirstProbe,
    revise: writesBranchOneFirst
  })
  const status = JSON.parse(await fs.readFile(path.join(directory, 'rsi.json'), 'utf8'))
  await fs.rm(directory, { recursive: true, force: true })

  // Round one finished — its attempts were paid for — and round two never began.
  assert.equal(result.rounds.length, 1, 'a stopped run kept exploring')
  assert.equal(status.phase, 'stopped')
  assert.equal(status.round, 1)
})
