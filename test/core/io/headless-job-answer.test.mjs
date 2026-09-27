#!/usr/bin/env node
/**
 * A headless job's answer, read from the end of its log. A list answer read
 * as a failure, or an old job's output left in a reused log, gives the page a
 * wrong error for a job that worked, and nothing else reports it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { finishedJobState } from '../../../engine/headless-jobs.mjs'
import { spawnDetached } from '../../../engine/supervisor-transport.mjs'

test('a job that answers a list is done, with the list as its answer', () => {
  const state = finishedJobState('loading\n[{"model":"soma"}]\n', 'job-1')
  assert.deepEqual(state, { state: 'done', answer: [{ model: 'soma' }] })
})

test('a job that answers an error record has failed with that error', () => {
  assert.deepEqual(finishedJobState('{"error":"no design"}\n', 'job-2'), { state: 'failed', error: 'no design' })
})

test('a new job with a reused id starts its log empty', async () => {
  const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-log-')), 'job-3.log')
  fs.writeFileSync(logPath, '{"error":"an old job"}\n')
  const child = spawnDetached(process.execPath, ['-e', 'console.log(JSON.stringify([1]))'], {
    cwd: process.cwd(),
    env: process.env,
    logPath
  })
  await new Promise(resolve => child.on('exit', resolve))
  assert.deepEqual(finishedJobState(fs.readFileSync(logPath, 'utf8'), 'job-3'), { state: 'done', answer: [1] })
})
