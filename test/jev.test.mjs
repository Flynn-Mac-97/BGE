import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import jev from '../plugins/builtin/jev.js'
import { GUIDE_LABELS, GUIDE_NEGATIVE, RECORD_LABELS, RECORD_NEGATIVE, guideQuestions, rankAnswers, recordQuestions } from '../plugins/builtin/jev/classify.mjs'
import { addGuideSuggestions, allGuideCandidates, enabledFor, rankGuides, rankRecords, recordShortlist, recordText, storedMode } from '../plugins/builtin/jev/context.mjs'
import { MODE_FILE, modeFrom, modeText } from '../plugins/builtin/jev/mode.mjs'

// Routing and the key are the environment's business; a test pins both so a
// fake send sees one shape and nothing reaches the network by accident.
const beforeProxy = process.env.OPENROUTER_PROXY_URL
const beforeKey = process.env.OPENROUTER_API_KEY
process.env.OPENROUTER_PROXY_URL = ''
process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-tail'
process.on('exit', () => {
  if (beforeProxy === undefined) delete process.env.OPENROUTER_PROXY_URL
  else process.env.OPENROUTER_PROXY_URL = beforeProxy
  if (beforeKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = beforeKey
})

/** A fetch that records its calls and answers what the test wants. */
function fakeSend(answer, { status = 200 } = {}) {
  const calls = []
  const send = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null })
    return { ok: status < 400, status, text: async () => JSON.stringify(answer) }
  }
  send.calls = calls
  return send
}

/** A choice answer carrying a full distribution, so relevance can be read. */
const answer = (choice, probabilities) => ({
  type: 'choice', choice, confidence: Math.max(...Object.values(probabilities)), probabilities
})

test('one choice question per guide, keyed by id and carrying its description', () => {
  const questions = guideQuestions([
    { id: 'health', title: 'Health', description: 'Hurt and die.' },
    { id: 'effects', title: 'Effects', description: 'Sparks and smoke.' }
  ])
  assert.deepEqual(Object.keys(questions), ['health', 'effects'])
  assert.equal(questions.health.type, 'choice')
  assert.match(questions.effects.instructions, /Sparks and smoke\./)
  assert.deepEqual(Object.keys(questions.health.criteria), GUIDE_LABELS)
})

test('one choice question per record, carrying the record text', () => {
  const questions = recordQuestions([{ id: 'p1', text: '[engine] the lock is stale' }])
  assert.match(questions.p1.instructions, /the lock is stale/)
  assert.deepEqual(Object.keys(questions.p1.criteria), RECORD_LABELS)
})

test('a ranking keeps the positive answers over the floor and drops the rest with a reason', () => {
  const candidates = [
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }
  ]
  const { ranked, dropped } = rankAnswers(
    {
      a: answer('possible', { required: 0.25, possible: 0.7, irrelevant: 0.05 }),
      b: answer('required', { required: 0.9, possible: 0.1, irrelevant: 0 }),
      c: answer('irrelevant', { irrelevant: 0.99, possible: 0.01 }),
      d: answer('required', { required: 0.3, possible: 0.1, irrelevant: 0.6 })
    },
    candidates, { labels: GUIDE_LABELS, negative: GUIDE_NEGATIVE, minimum: 0.5, limit: 5 })
  assert.deepEqual(ranked.map(hit => hit.id), ['b', 'a'])
  assert.equal(ranked[0].choice, 'required')
  assert.deepEqual(dropped.map(entry => entry.id), ['d'])
})

test('an answer with an unknown label or no answer is dropped, never guessed', () => {
  const { ranked, dropped } = rankAnswers(
    { a: { type: 'choice', choice: 'maybe', confidence: 0.9 }, b: answer('same', { same: 0.8, related: 0.1, unrelated: 0.1 }) },
    [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
    { labels: RECORD_LABELS, negative: RECORD_NEGATIVE, minimum: 0.5, limit: 5 })
  assert.deepEqual(ranked.map(hit => hit.id), ['b'])
  assert.deepEqual(dropped.map(entry => entry.id), ['a', 'c'])
})

test('a malformed answer is dropped, never shown as a good one', () => {
  const candidates = [{ id: 'nan' }, { id: 'missing' }, { id: 'string' }, { id: 'bare' }, { id: 'noise' }, { id: 'confident' }]
  const { ranked, dropped } = rankAnswers({
    nan: { type: 'choice', choice: 'required', probabilities: { required: 0.9, possible: 0.1, irrelevant: NaN } },
    missing: { type: 'choice', choice: 'required', probabilities: { possible: 0.1, irrelevant: 0 } },
    string: { type: 'choice', choice: 'required', probabilities: { required: 'high', possible: 0.1, irrelevant: 0 } },
    bare: { type: 'choice', choice: 'required' },
    noise: answer('required', { required: 0.9, possible: 0.1, irrelevant: 0 }),
    confident: { type: 'choice', choice: 'required', confidence: 0.8 }
  }, candidates, { labels: GUIDE_LABELS, negative: GUIDE_NEGATIVE, minimum: 0.5, limit: 5 })
  assert.deepEqual(ranked.map(hit => hit.id), ['noise', 'confident'])
  assert.deepEqual(dropped.map(entry => entry.id), ['nan', 'missing', 'string', 'bare'])
  assert.ok(ranked.every(hit => Number.isFinite(hit.relevance)))
})

test('the record shortlist keeps shared words and drops the unrelated', () => {
  const records = [
    { id: 'p1', kind: 'engine', what: 'the work lock is stale' },
    { id: 'p2', kind: 'cli', what: 'a packet omits a guide' },
    { id: 'p3', kind: 'docs', what: 'unrelated prose about flowers' }
  ]
  const shortlist = recordShortlist('the work lock is stale again', records)
  assert.deepEqual(shortlist.map(entry => entry.id), ['p1'])
  assert.match(recordText(records[1]), /a packet omits a guide/)
})

test('a guide ranking batches one request and returns the answers with usage', async () => {
  const send = fakeSend({
    model: 'typesafe/jev-1.13-20260917', provider: 'TypeSafe',
    answers: { health: answer('required', { required: 0.9, possible: 0.08, irrelevant: 0.02 }), effects: answer('possible', { possible: 0.7, required: 0.2, irrelevant: 0.1 }) },
    usage: { input_tokens: 40, output_tokens: 8, cost: 0.000002 }
  })
  const result = await rankGuides({
    task: 'add a health bar', candidates: [
      { id: 'health', title: 'Health', description: 'Hurt and die.' },
      { id: 'effects', title: 'Effects', description: 'Sparks.' }
    ], key: 'sk-or-v1-test', send
  })
  assert.equal(send.calls.length, 1)
  assert.equal(send.calls[0].url, 'https://openrouter.ai/api/alpha/decisions')
  assert.equal(send.calls[0].body.model, 'typesafe/jev-1.13')
  assert.equal(send.calls[0].body.state.task, 'add a health bar')
  assert.equal(send.calls[0].body.questions.health.type, 'choice')
  assert.deepEqual(result.ranked.map(hit => hit.id), ['health', 'effects'])
  assert.equal(result.asked, 2)
  assert.equal(result.usage.cost, 0.000002)
})

test('a record ranking asks about the shortlist and never edits anything', async () => {
  const send = fakeSend({
    model: 'typesafe/jev-1.13-20260917',
    answers: { p1: answer('same', { same: 0.8, related: 0.15, unrelated: 0.05 }), p2: answer('unrelated', { unrelated: 0.9, related: 0.05, same: 0.05 }) },
    usage: { input_tokens: 30, output_tokens: 5, cost: 0.000001 }
  })
  const result = await rankRecords({
    finding: 'the work lock is stale', candidates: [
      { id: 'p1', text: 'the lock derives from live pids' },
      { id: 'p2', text: 'packet size' }
    ], key: 'sk-or-v1-test', send
  })
  assert.deepEqual(result.ranked.map(hit => hit.id), ['p1'])
})

test('the switch writes one project-relative file and reads back off', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-mode-'))
  const written = new Map()
  const context = {
    files: {
      async read(file) { if (!written.has(file)) throw new Error(`missing ${file}`); return written.get(file) },
      async write(file, text) { written.set(file, text) }
    },
    redraw() {}
  }
  const commands = Object.fromEntries(jev.commands.map(command => [command.id, command]))
  assert.deepEqual(await commands['jev.mode'].run(context, { on: false }), {
    enabled: false, model: 'typesafe/jev-1.13', proxy: false,
    key: { found: true, where: 'OPENROUTER_API_KEY', last4: 'tail' }
  })
  assert.equal(written.get(MODE_FILE), modeText(false))
  const on = await commands['jev.mode'].run(context, { on: true })
  assert.equal(on.enabled, true)
  assert.equal(modeFrom(written.get(MODE_FILE)), true)

  // The same file, read from disk by the node path.
  await fs.mkdir(path.join(directory, '.engine'), { recursive: true })
  await fs.writeFile(path.join(directory, MODE_FILE), modeText(true))
  assert.equal(await storedMode(directory), true)
  assert.equal(await enabledFor({}, directory), true)
  assert.equal(await enabledFor({ jev: false }, directory), false)
  assert.equal(await enabledFor({ jev: true }, directory), true)
  await fs.rm(directory, { recursive: true, force: true })
})

test('an off packet makes no call, and a fault leaves the packet unchanged', async () => {
  const packet = { task: 'add a health bar', files: [], nodes: [], text: 'base\n' }
  const pluginNodes = [{ id: 'g1', title: 'Guide', file: 'plugins/builtin/g1.agent.md', scope: 'engine', enabled: true }]
  const read = async () => '---\ndescription: a guide.\n---\n'

  let calls = 0
  const idle = async () => { calls++; throw new Error('must not be called') }
  const offDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-off-'))
  assert.equal(await addGuideSuggestions({ project: offDirectory, request: {}, packet, pluginNodes, read, ask: { send: idle } }), null)
  assert.equal(calls, 0)

  const on = await addGuideSuggestions({
    project: offDirectory, request: { jev: true }, packet, pluginNodes, read,
    ask: { send: fakeSend({ model: 'm', answers: { g1: answer('possible', { possible: 0.8, required: 0.1, irrelevant: 0.1 }) }, usage: { input_tokens: 5, output_tokens: 1 } }) }
  })
  assert.equal(on.jev.ok, true)
  assert.deepEqual(on.suggestions.map(hit => hit.id), ['g1'])
  assert.match(on.section, /# Jev suggests/)
  assert.match(on.section, /Guide/)

  const broken = await addGuideSuggestions({
    project: offDirectory, request: { jev: true }, packet, pluginNodes, read,
    ask: { send: async () => { throw new Error('OpenRouter refused: no credits') } }
  })
  assert.equal(broken.jev.ok, false)
  assert.match(broken.jev.why, /no credits/)
  assert.equal(broken.section, undefined)
  assert.equal(packet.text, 'base\n')
  await fs.rm(offDirectory, { recursive: true, force: true })
})

test('a missing key is a reason, not a throw, and no candidate is read', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-key-'))
  const packet = { task: 'x', files: [], nodes: [] }
  let reads = 0
  const read = async () => { reads++; return '---\ndescription: d.\n---\n' }
  const previous = process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  try {
    const result = await addGuideSuggestions({ project: directory, request: { jev: true }, packet, pluginNodes: [{ id: 'g1', title: 'G', file: 'g.md', scope: 'engine', enabled: true }], read })
    assert.equal(result.jev.ok, false)
    assert.match(result.jev.why, /no OpenRouter key/)
    assert.equal(reads, 0)
  } finally {
    process.env.OPENROUTER_API_KEY = previous
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('every enabled guide with a description is a candidate for a standalone ranking', async () => {
  const read = async (scope, file) => file.includes('one') ? '---\ndescription: one.\n---\n' : 'no frontmatter'
  const candidates = await allGuideCandidates([
    { id: 'one', title: 'One', file: 'plugins/builtin/one.agent.md', scope: 'engine', enabled: true },
    { id: 'two', title: 'Two', file: 'plugins/builtin/two.agent.md', scope: 'engine', enabled: true },
    { id: 'off', title: 'Off', file: 'plugins/builtin/off.agent.md', scope: 'engine', enabled: false }
  ], read)
  assert.deepEqual(candidates.map(candidate => candidate.id), ['one'])
})
