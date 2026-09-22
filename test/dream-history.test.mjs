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

test('a report that overflows its entry is cut, not dropped whole', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-history-report-'))
  const round = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(round, { recursive: true })
  // One long line, as `oneLine` produces. A line-boundary cut used to drop it
  // whole when it overflowed the entry, which lost a measured finding.
  const report = `a browser CPU profile showed ~35% of draw() was matrix recomposition. ${'detail '.repeat(200)}`
  await fs.writeFile(path.join(round, 'rsi-b0-r001c1.json'), `${JSON.stringify({
    id: 'rsi-b0-r001c1', parent: 'target', depth: 1, verdict: 'scored', value: 0.66, report, measures: { cpuMs: 91.1 }
  })}\n`, 'utf8')

  const block = await historyLines({ runDirectory: directory, budget: 700 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.ok(block.length <= 700, `the block was ${block.length} characters`)
  assert.match(block, /35% of draw\(\) was matrix recomposition/, 'the report was dropped instead of cut')
  assert.match(block, /cpuMs/, 'the evaluator measures were dropped before the report')
})

test('an attempt the harness cut off names its status in the history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-history-status-'))
  const round = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(round, { recursive: true })
  await fs.writeFile(path.join(round, 'rsi-b0-r001c1.json'), `${JSON.stringify({
    id: 'rsi-b0-r001c1', parent: 'target', depth: 1, status: 'timeout', verdict: 'scored', value: 0.7, report: 'measured a hotspot', measures: { cpuMs: 80 }
  })}\n`, 'utf8')

  const block = await historyLines({ runDirectory: directory, budget: 12000 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(block, /status timeout/, 'the cut-off status is missing')
  assert.match(block, /value 0\.7, every task passed/, 'the evaluator result is missing')
})

test('an RSI attempt already made this round is in the next attempt history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-rsi-history-'))
  const round = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(round, { recursive: true })
  // The record an RSI round writes as each attempt ends, plus the patch it names.
  await fs.writeFile(path.join(round, 'rsi-b0-r001c1.json'), `${JSON.stringify({
    id: 'rsi-b0-r001c1',
    parent: 'target',
    depth: 1,
    verdict: 'failed',
    evaluated: true,
    value: 0,
    reason: 'the holdout route broke',
    report: 'indexed entities by type',
    measures: { characters: 400 },
    patchFile: 'rsi/r001-b0a0.patch'
  })}\n`, 'utf8')
  await fs.writeFile(path.join(directory, 'rsi', 'r001-b0a0.patch'), [
    'diff --git a/tools/dream/candidate.mjs b/tools/dream/candidate.mjs',
    '--- a/tools/dream/candidate.mjs',
    '+++ b/tools/dream/candidate.mjs',
    '@@ -1 +1 @@',
    '-const one = 1',
    '+const one = 2',
    ''
  ].join('\n'), 'utf8')

  const block = await historyLines({ runDirectory: directory, budget: 12000 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(block, /rsi-b0-r001c1/, 'the RSI attempt is not named')
  assert.match(block, /indexed entities by type/, 'the RSI attempt report is missing')
  assert.match(block, /the holdout route broke/, 'the RSI attempt reason is missing')
  assert.match(block, /tools\/dream\/candidate\.mjs/, 'what the RSI attempt changed is missing')
})

test('an older RSI run is read from its attempts summary and separate patches', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-rsi-old-'))
  const round = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(round, { recursive: true })
  // Old runs wrote no per-attempt JSON: only the summary and the patches beside
  // it. The entries carry no ids, so the reader must derive them.
  await fs.writeFile(path.join(round, 'attempts.json'), `${JSON.stringify([
    { cell: '0:0', verdict: 'scored', value: 0.7, reason: null, measures: { characters: 10 }, report: 'the old root', patch: 'agent-runs/dream-old/rsi/r001-b0a0.patch' },
    { cell: '0:1', verdict: 'failed', value: 0, reason: 'broke it', measures: { characters: 5 }, report: 'the old child', patch: 'agent-runs/dream-old/rsi/r001-b0a1.patch' }
  ])}\n`, 'utf8')
  const diff = [
    'diff --git a/tools/dream/candidate.mjs b/tools/dream/candidate.mjs',
    '--- a/tools/dream/candidate.mjs',
    '+++ b/tools/dream/candidate.mjs',
    '@@ -1 +1 @@',
    '-const one = 1',
    '+const one = 2',
    ''
  ].join('\n')
  await fs.writeFile(path.join(directory, 'rsi', 'r001-b0a0.patch'), diff, 'utf8')
  await fs.writeFile(path.join(directory, 'rsi', 'r001-b0a1.patch'), diff, 'utf8')

  const block = await historyLines({ runDirectory: directory, budget: 12000 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(block, /the old root/, 'the old run\'s scored attempt is missing')
  assert.match(block, /the old child/, 'the old run\'s failed attempt is missing')
  assert.match(block, /rsi-b0-r1c1/, 'the old attempt was not given its candidate id')
  assert.match(block, /tools\/dream\/candidate\.mjs/, 'the old attempt\'s patch was not read')
})

test('a per-attempt record and the round summary are not both listed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-rsi-dedupe-'))
  const round = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(round, { recursive: true })
  await fs.writeFile(path.join(round, 'rsi-b0-r001c1.json'), `${JSON.stringify({
    id: 'rsi-b0-r001c1', parent: 'target', depth: 1, verdict: 'scored', value: 0.7, report: 'recorded once', measures: {}, patchFile: 'rsi/r001-b0a0.patch'
  })}\n`, 'utf8')
  await fs.writeFile(path.join(round, 'attempts.json'), `${JSON.stringify([
    { cell: '0:0', id: 'rsi-b0-r001c1', verdict: 'scored', value: 0.7, report: 'from summary', patch: 'agent-runs/dream-x/rsi/r001-b0a0.patch' }
  ])}\n`, 'utf8')

  const block = await historyLines({ runDirectory: directory, budget: 12000 })
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(block, /recorded once/)
  assert.doesNotMatch(block, /from summary/, 'the summary entry was listed beside the record')
  assert.equal((block.match(/rsi-b0-r001c1/g) ?? []).length, 1, 'the same attempt was listed twice')
})

test('the history follows the parent a record names, not only score order', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-rsi-lineage-'))
  const round = path.join(directory, 'rsi', 'round-001')
  await fs.mkdir(round, { recursive: true })
  const write = (id, record) => fs.writeFile(path.join(round, `${id}.json`), `${JSON.stringify(record)}\n`, 'utf8')
  // The best attempt is the child; its parent scored nothing. If the reader
  // followed only score, the parent would come last.
  await write('rsi-b0-r001c2', { id: 'rsi-b0-r001c2', parent: 'rsi-b0-r001c1', depth: 2, verdict: 'scored', value: 0.9, report: 'the child', measures: {} })
  await write('rsi-b0-r001c1', { id: 'rsi-b0-r001c1', parent: 'target', depth: 1, verdict: 'failed', value: 0, reason: 'broke it', report: 'the parent', measures: {} })
  await write('rsi-b1-r001c1', { id: 'rsi-b1-r001c1', parent: 'target', depth: 1, verdict: 'scored', value: 0.5, report: 'another branch', measures: {} })

  const block = await historyLines({ runDirectory: directory, budget: 12000 })
  await fs.rm(directory, { recursive: true, force: true })

  const child = block.indexOf('rsi-b0-r001c2')
  const parent = block.indexOf('rsi-b0-r001c1')
  const other = block.indexOf('rsi-b1-r001c1')
  assert.ok(child >= 0 && parent >= 0 && other >= 0, 'not every attempt is in the block')
  assert.ok(child < parent, 'the best attempt does not lead its own line')
  assert.ok(parent < other, 'the parent was not read before an unrelated higher-scoring attempt')
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
