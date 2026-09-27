/**
 * While a lane works, a headless run may still write the project files the
 * engine rebuilds on every run (test results, the index), and nothing else.
 *
 *   node --test test/core/io/rebuilt-files.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { refuseWritesWhileLanesWork } from '../../../engine/on-disk.mjs'

test('a lane holds project files but not the ones the engine rebuilds', testContext => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-rebuilt-files-'))
  const state = path.join(root, '.engine')
  fs.mkdirSync(state, { recursive: true })
  const runs = [{ id: 'lane-a', status: 'active', files: ['engine/render.js'], startedAt: '2026-09-27T00:00:00Z' }]
  fs.writeFileSync(path.join(state, 'agents.json'), JSON.stringify({ runs }))
  fs.writeFileSync(path.join(state, 'lane-browsers.json'), JSON.stringify({ browsers: [] }))
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const guard = refuseWritesWhileLanesWork(root)
  assert.equal(guard('.engine/tests.json', 'project'), null)
  assert.equal(guard('.engine/index.json', 'project'), null)
  assert.match(guard('levels/arena.json', 'project'), /lane/)
  assert.match(guard('.engine/systems/draft-plan.json', 'project'), /lane/)
})
