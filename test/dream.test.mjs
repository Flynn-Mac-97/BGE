import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { costOf, bandAt, costBands, sumCosts } from '../tools/dream/pricing.mjs'
import { digestOf, loadSetup, scoreRun } from '../tools/dream/scoring.mjs'
import { sessionTokens } from '../tools/dream/measures.mjs'
import { renderReport } from '../tools/dream/report.mjs'
import { writeCandidateRecord, recordedState } from '../tools/dream/loop.mjs'
import { replaceOnce } from '../tools/dream/worktree.mjs'
import reference from '../tools/dream/examples/agent-connection.mjs'

/** A transcript frame: one compressed line of the JSONL the harness writes. */
const frame = record => zstdCompressSync(Buffer.from(`${JSON.stringify(record)}\n`, 'utf8'))

const usageRecord = totalTokens => ({
  type: 'step/end',
  data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, reasoningTokens: 3, totalTokens } }
})

async function transcriptOf(frames) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-transcript-'))
  await fs.writeFile(path.join(directory, 'session.v3.jsonl.zstd'), Buffer.concat(frames))
  return directory
}

test('a changed task makes the setup a different setup', () => {
  const before = digestOf(reference)
  const rewritten = {
    ...reference,
    tasks: reference.tasks.map(one => (one.id === 'healthy' ? { ...one, question: `${one.question} (and say why)` } : one))
  }
  assert.notEqual(digestOf(rewritten), before, 'a rewritten question left the digest the same')
  assert.notEqual(digestOf({ ...reference, weights: { processes: 1 } }), before, 'changed weights left the digest the same')
})

test('a candidate is refused when the setup it was scored against has moved', async () => {
  const record = await scoreRun({ tasks: [], suiteHash: '0', name: 'moved' })
  assert.equal(record.verdict, 'refused')
  assert.equal(record.tasks.length, 0, 'a refused run still ran the tasks')
  assert.match(record.reason, /the setup changed/)
})

test('a setup that cannot tell two candidates apart is refused', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-setup-'))
  const file = path.join(directory, 'no-check.mjs')
  await fs.writeFile(file, 'export default { project: "test/fixture-project", tasks: [{ id: "nameless" }] }\n', 'utf8')

  const loaded = await loadSetup(file)
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(loaded.error, /has no run/)
  assert.equal(loaded.setup, undefined)
})

test('a task that fails scores zero but is still an evaluated attempt', async () => {
  const record = await scoreRun({
    tasks: [
      { id: 'cheap', run: async () => ({ pass: true, measures: { characters: 0 } }) },
      { id: 'broken', run: async () => ({ pass: false, problem: 'the answer named nothing' }) }
    ],
    weights: { characters: 1 },
    name: 'gate'
  })

  // The paper's rule: a failed check scores zero and keeps the attempt, so a
  // policy can tell a wrong answer from a harness that never ran.
  assert.equal(record.verdict, 'failed')
  assert.equal(record.evaluated, true)
  assert.equal(record.valid, false)
  assert.equal(record.failClass, 'correctness')
  assert.equal(record.value, 0)
  assert.equal(record.nValid, 1)
  assert.equal(record.nTotal, 2)
  assert.match(record.reason, /broken: the answer named nothing/)
})

test('a task that throws is a harness failure, not a scored zero', async () => {
  const record = await scoreRun({
    tasks: [
      { id: 'ok', run: async () => ({ pass: true, measures: {} }) },
      { id: 'crashed', run: async () => { throw new Error('the process died') } }
    ],
    name: 'harness'
  })

  assert.equal(record.verdict, 'refused')
  assert.equal(record.evaluated, false)
  assert.equal(record.failClass, 'harness')
  assert.match(record.reason, /crashed: threw — the process died/)
})

test('a negative weight is a quality gain, so a maximized objective raises the value', async () => {
  const record = await scoreRun({
    tasks: [{ id: 'answer', run: async () => ({ pass: true, measures: { quality: 4 } }) }],
    weights: { quality: -0.5 },
    name: 'maximize'
  })

  assert.equal(record.verdict, 'scored')
  assert.equal(record.value, 3, '1 - (-0.5 * 4) is 3')
})

test('tokens are summed from every frame, and a mention is not a spend', async () => {
  const directory = await transcriptOf([
    frame({ type: 'session', version: 3 }),
    frame(usageRecord(1000)),
    frame({ type: 'tool/result', data: { text: 'the tool reported totalTokens: 99999 in its output' } }),
    frame(usageRecord(250))
  ])
  const totals = sessionTokens(directory)
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(totals.steps, 2, 'the quoted mention was counted as a step')
  assert.equal(totals.totalTokens, 1250)
  assert.equal(totals.inputTokens, 200)
  assert.equal(totals.cacheReadTokens, 10)
})

test('a directory with no transcript reports what was missing, not a zero', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-empty-'))
  const totals = sessionTokens(directory)
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(totals.error, /no transcript/)
  assert.equal(totals.totalTokens, undefined)
})

test('a control that would rewrite two places changes neither', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-control-'))
  const file = path.join(directory, 'target.js')
  await fs.writeFile(file, 'const a = 1\nconst b = 1\n', 'utf8')

  const twice = replaceOnce(file, '1', '2')
  const once = replaceOnce(file, 'const a = 1', 'const a = 2')
  const after = await fs.readFile(file, 'utf8')
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(twice.error, /more than once/)
  assert.equal(once.ok, true)
  assert.equal(after, 'const a = 2\nconst b = 1\n', 'the refused control still wrote to the file')
})

test('a run is priced in RMB at the published rate for its model', () => {
  const million = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 3_000_000 }
  assert.equal(costOf(million, { band: 'peak' }).rmb, 10.04, 'a million of each at peak')
  assert.equal(costOf(million, { band: 'offPeak' }).rmb, 5.02, 'the same at half price')
  assert.equal(costOf({}).priced, false, 'an empty record was priced as free')
})

test('the peak band is Beijing working hours, not the machine clock', () => {
  // Friday 14:42 in Beijing.
  assert.equal(bandAt(new Date('2026-09-18T06:42:00Z')), 'peak')
  // Friday 06:00 Beijing, before the working day.
  assert.equal(bandAt(new Date('2026-09-17T22:00:00Z')), 'offPeak')
  // Saturday 10:00 Beijing: the hour is inside a window, the day is not.
  assert.equal(bandAt(new Date('2026-09-19T02:00:00Z')), 'offPeak')
})

test('a sum keeps both bands and says which one it was worked out at', () => {
  const total = sumCosts([
    costBands({ inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0, totalTokens: 1_000_000 }, new Date('2026-09-18T06:42:00Z')),
    costBands({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 1_000_000, totalTokens: 1_000_000 }, new Date('2026-09-18T06:42:00Z'))
  ])
  assert.equal(total.peak, 10)
  assert.equal(total.offPeak, 5)
  assert.equal(total.now, 10)
  assert.equal(total.band, 'peak')
  assert.equal(total.totalTokens, 2_000_000)
})

test('a resumed run continues after its last round, from the best version it found', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-resume-'))
  const write = async (file, value) => {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true })
    await fs.writeFile(path.join(directory, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }
  await write('rounds/r0001/c1.json', { id: 'run-r1c1', value: 0.5, verdict: 'scored', depth: 1, best: true, measures: { characters: 10 } })
  await fs.writeFile(path.join(directory, 'rounds/r0001/run-r1c1.patch'), 'diff\n', 'utf8')
  await write('rounds/r0001/round.json', { round: 1, improved: true, best: { id: 'run-r1c1', value: 0.5 } })
  await write('rounds/r0002/c1.json', { id: 'run-r2c1', value: 0.4, verdict: 'scored', depth: 2 })
  await write('rounds/r0002/round.json', { round: 2, improved: false, best: { id: 'run-r1c1', value: 0.5 } })

  const state = await recordedState(directory)
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(state.lastRound, 2, 'a resume would write over round two')
  assert.equal(state.best.id, 'run-r1c1', 'the best version of an earlier round was forgotten')
  assert.match(state.best.patch, /run-r1c1\.patch$/, 'the best version came back without the patch it consists of')
  assert.equal(state.withoutImprovement, 1, 'the rounds that already brought nothing were not counted')
  assert.equal(state.attempts.length, 2)
})

test('a run with no rounds yet resumes at round one with the target as its best', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-fresh-'))
  const state = await recordedState(directory)
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(state.lastRound, 0)
  assert.equal(state.best, null)
  assert.equal(state.withoutImprovement, 0)
  assert.deepEqual(state.attempts, [])
})

/** A run directory with one refused candidate, one failed check, and one that beat the target. */
async function fabricatedRun() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-run-'))
  const round = path.join(directory, 'rounds', 'r0001')
  await fs.mkdir(round, { recursive: true })

  const write = (file, value) => fs.writeFile(path.join(directory, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await write('target.json', { target: 'make the packet smaller', startedAt: '2026-01-01T00:00:00.000Z', files: [] })
  await write('setup-check.json', {
    name: 'packets',
    weights: { characters: 0.001 },
    tasks: [{ id: 'find-player', question: 'which entity is the player?' }],
    working: { value: 0.9, totals: { measures: { characters: 100 } } },
    control: { value: 0, reason: 'find-player: snapshot answered no entity list', why: 'the player is never found' }
  })
  await fs.writeFile(path.join(round, 'c1.json'), `${JSON.stringify({ id: 'run-c1', parent: 'target', depth: 1, verdict: 'refused', value: 0, reason: 'find-player: snapshot answered no entity list' })}\n`, 'utf8')
  await fs.writeFile(path.join(round, 'c2.json'), `${JSON.stringify({ id: 'run-c2', parent: 'target', depth: 1, verdict: 'scored', value: 0.95, best: true, measures: { characters: 50 }, tokens: { totalTokens: 1234 }, durationMs: 900 })}\n`, 'utf8')
  await fs.writeFile(path.join(round, 'c3.json'), `${JSON.stringify({ id: 'run-c3', parent: 'target', depth: 1, verdict: 'failed', evaluated: true, valid: false, failClass: 'correctness', nValid: 0, nTotal: 1, value: 0, reason: 'find-player: no entity of type player' })}\n`, 'utf8')
  await fs.writeFile(path.join(round, 'round.json'), `${JSON.stringify({ round: 1, improved: true, best: { id: 'run-c2', value: 0.95, depth: 1 } })}\n`, 'utf8')
  await write('winner.json', { id: 'run-c2', value: 0.95, improvement: 0.05, patch: 'winner.patch', baseline: { value: 0.9 } })
  return directory
}

test('the run writes a document naming the target, the check, the control and the winner', async () => {
  const directory = await fabricatedRun()
  const written = await renderReport(directory)
  const report = await fs.readFile(written.report, 'utf8')
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(report, /# Dream: make the packet smaller/)
  assert.match(report, /find-player/)
  assert.match(report, /the player is never found/)
  assert.match(report, /run-c2/)
  assert.match(report, /0\.95/)
  assert.match(report, /failed: find-player: no entity of type player/, 'a failed check was not reported as a scored zero')
  assert.equal(written.attempts, 3)
})

test('the two pictures carry every attempt and no missing number', async () => {
  const directory = await fabricatedRun()
  const written = await renderReport(directory)
  const graph = await fs.readFile(written.graph, 'utf8')
  const tree = await fs.readFile(written.tree, 'utf8')
  await fs.rm(directory, { recursive: true, force: true })

  for (const [name, svg] of [['graph', graph], ['tree', tree]]) {
    assert.equal((svg.match(/<svg/g) ?? []).length, 1, `${name}.svg is not one svg`)
    assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1, `${name}.svg is not closed`)
    assert.doesNotMatch(svg, /NaN|undefined/, `${name}.svg has a missing number`)
    assert.match(svg, /run-c1/, `${name}.svg does not name the refused candidate`)
    assert.match(svg, /run-c2/, `${name}.svg does not name the kept candidate`)
    assert.match(svg, /run-c3/, `${name}.svg does not name the failed candidate`)
  }
  assert.match(tree, /<path d="M/, 'the tree draws no edge')
  assert.match(graph, /stroke-dasharray/, 'the graph draws no baseline')
})
