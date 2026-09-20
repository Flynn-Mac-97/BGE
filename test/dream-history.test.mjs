import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { historyLines, patchSummary } from '../tools/dream/candidate.mjs'

/**
 * A run directory with two rounds of records and patches, as the loop writes
 * them: the first attempt failed a check, the second repaired it and was kept.
 */
async function fabricatedRun() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-history-'))
  const write = (file, text) => fs.writeFile(path.join(directory, file), text, 'utf8')
  const mkdir = file => fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true })

  await mkdir('rounds/r0001/run-r1c1.json')
  await mkdir('rounds/r0002/run-r2c1.json')
  await write('rounds/r0001/run-r1c1.json', `${JSON.stringify({
    id: 'run-r1c1',
    parent: 'target',
    depth: 1,
    verdict: 'failed',
    evaluated: true,
    value: 0,
    reason: 'find-player: no entity of type player',
    report: 'I indexed entities by type. The holdout route broke.',
    measures: { characters: 400 }
  })}\n`)
  await write('rounds/r0001/run-r1c1.patch', [
    'diff --git a/tools/dream/candidate.mjs b/tools/dream/candidate.mjs',
    '--- a/tools/dream/candidate.mjs',
    '+++ b/tools/dream/candidate.mjs',
    '@@ -1,2 +1,2 @@',
    '-const one = 1',
    '+const one = 2',
    ''
  ].join('\n'))
  await write('rounds/r0002/run-r2c1.json', `${JSON.stringify({
    id: 'run-r2c1',
    parent: 'run-r1c1',
    depth: 2,
    verdict: 'scored',
    evaluated: true,
    value: 0.95,
    best: true,
    report: 'Rewrote the line builder to keep the holdout route.',
    measures: { characters: 50 }
  })}\n`)
  await write('rounds/r0002/run-r2c1.patch', [
    'diff --git a/tools/dream/candidate.mjs b/tools/dream/candidate.mjs',
    '--- a/tools/dream/candidate.mjs',
    '+++ b/tools/dream/candidate.mjs',
    '@@ -1,2 +1,3 @@',
    '-const one = 2',
    '+const one = 3',
    '+const two = 4',
    ''
  ].join('\n'))
  await write('rounds/r0002/round.json', `${JSON.stringify({ round: 2, improved: true, best: { id: 'run-r2c1', value: 0.95 } })}\n`)
  return directory
}

test('the history block carries what an earlier attempt changed and reported', async () => {
  const directory = await fabricatedRun()
  const block = await historyLines({ runDirectory: directory, budget: 12000 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(block, /run-r2c1/, 'the best attempt is not named')
  assert.match(block, /Rewrote the line builder to keep the holdout route\./, 'the earlier attempt\'s report is missing')
  assert.match(block, /run-r1c1/, 'the failed attempt it repaired is not named')
  assert.match(block, /I indexed entities by type\. The holdout route broke\./, 'the failed attempt\'s report is missing')
  assert.match(block, /tools\/dream\/candidate\.mjs/, 'what the attempt changed is missing')
  assert.match(block, /\(\+2 -1\)/, 'the lines the patch added and removed are missing')
  assert.match(block, /value 0\.95, every task passed/)
  assert.match(block, /round 2/)
})

test('the history block stays inside its budget, however many attempts there are', async () => {
  const directory = await fabricatedRun()
  for (const budget of [240, 300, 700, 1200, 4000, 12000]) {
    const block = await historyLines({ runDirectory: directory, budget })
    assert.ok(block.length <= budget, `a budget of ${budget} produced ${block.length} characters`)
  }
  await fs.rm(directory, { recursive: true, force: true })
})

test('a small budget keeps the attempt that matters and says what it left out', async () => {
  const directory = await fabricatedRun()
  const block = await historyLines({ runDirectory: directory, budget: 300 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.ok(block.length <= 300)
  assert.match(block, /Rewrote the line builder/, 'the best attempt was dropped before the failed one')
  assert.doesNotMatch(block, /I indexed entities by type/, 'a less relevant attempt took the room')
})

test('a patch summary counts the files and the lines it changes', async () => {
  const summary = patchSummary([
    'diff --git a/one.mjs b/one.mjs',
    '--- a/one.mjs',
    '+++ b/one.mjs',
    '@@ -1,2 +1,2 @@',
    '-a',
    '+b',
    '--- a/two.mjs',
    '+++ b/two.mjs',
    '@@ -1 +1,2 @@',
    '-c',
    '+d',
    '+e',
    'diff --git a/three.mjs b/three.mjs',
    '--- /dev/null',
    '+++ b/three.mjs',
    '+new'
  ].join('\n'))

  assert.deepEqual(summary.files, ['one.mjs', 'two.mjs', 'three.mjs'])
  assert.equal(summary.added, 4)
  assert.equal(summary.removed, 2)
})

test('a run with no records on disk still gets the line-per-attempt summary', async () => {
  const block = await historyLines({
    history: [{ id: 'run-c1', value: 0.4, pass: false, reason: 'a check failed' }],
    budget: 12000
  })
  assert.match(block, /run-c1: value 0\.4, score zero — a check failed/)
})
