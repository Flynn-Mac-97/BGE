/**
 * The serve session: one world held open, one JSON reply per request.
 *
 * Checked through the CLI rather than through the function inside it, because
 * what breaks without a sound is the contract a caller parses — one line per
 * request, in order, an error that does not end the session, and nothing on
 * stdout that is not JSON. A reply that arrives out of step, or a log line mixed
 * into the stream, reads as a wrong answer rather than as a fault.
 *
 * stdio is two open files rather than pipes, so the child needs no named pipe.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CHECKOUT, FIXTURE, FIXTURE_LEVEL } from './fixture-project.mjs'

/** Run one session over the fixture project and return its replies, in order. */
function session(requests) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-session-'))
  const requestFile = path.join(folder, 'requests.jsonl')
  const replyFile = path.join(folder, 'replies.jsonl')
  fs.writeFileSync(requestFile, requests.map(request => JSON.stringify(request)).join('\n') + '\n')

  const input = fs.openSync(requestFile, 'r')
  const output = fs.openSync(replyFile, 'w')
  const result = spawnSync(process.execPath, ['bin/engine.mjs', 'serve', '--project', FIXTURE],
    { cwd: CHECKOUT, stdio: [input, output, 'inherit'] })
  fs.closeSync(input)
  fs.closeSync(output)

  assert.equal(result.status, 0, 'the session should exit 0')
  const lines = fs.readFileSync(replyFile, 'utf8').split('\n').filter(Boolean)
  fs.rmSync(folder, { recursive: true, force: true })
  // Parsing every line is half the assertion: a log line on stdout would throw
  // here rather than be read as a reply.
  return lines.map(line => JSON.parse(line))
}

test('a session answers one JSON line per request, in order, from one world', () => {
  const replies = session([
    { op: 'snapshot' },
    { op: 'seed', args: [7] },
    { op: 'snapshot' }
  ])
  assert.equal(replies.length, 3)
  assert.equal(replies[0].level, FIXTURE_LEVEL)
  assert.equal(replies[1].seed, 7)
  assert.equal(replies[2].seed, 7, 'the world carried over between requests')
})

test('a request that throws answers the error and the session stays up', () => {
  const replies = session([
    { op: 'no.such.op' },
    { op: 'run', args: ['no.such.command'] },
    { op: 'seed', args: [3] }
  ])
  assert.equal(replies.length, 3)
  assert.match(replies[0].error, /no op/)
  assert.match(replies[1].error, /no command/)
  assert.equal(replies[2].seed, 3, 'the session answered after two failures')
})

test('a dotted op reaches the surface a plain op cannot', () => {
  const replies = session([{ op: 'editor.loadLevel', args: [FIXTURE_LEVEL] }, { op: 'snapshot' }])
  assert.deepEqual(replies[0], { ok: true })
  assert.equal(replies[1].level, FIXTURE_LEVEL)
})

test('a request that is not JSON is answered, not fatal', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-session-'))
  const requestFile = path.join(folder, 'requests.jsonl')
  const replyFile = path.join(folder, 'replies.jsonl')
  fs.writeFileSync(requestFile, 'not json at all\n{"op":"snapshot"}\n')

  const input = fs.openSync(requestFile, 'r')
  const output = fs.openSync(replyFile, 'w')
  const result = spawnSync(process.execPath, ['bin/engine.mjs', 'serve', '--project', FIXTURE],
    { cwd: CHECKOUT, stdio: [input, output, 'inherit'] })
  fs.closeSync(input)
  fs.closeSync(output)

  assert.equal(result.status, 0)
  const replies = fs.readFileSync(replyFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  fs.rmSync(folder, { recursive: true, force: true })
  assert.equal(replies.length, 2)
  assert.match(replies[0].error, /not JSON/)
  assert.equal(replies[1].level, FIXTURE_LEVEL)
})
