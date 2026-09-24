// The Codemap boundary check reads import records from Codemap. If Codemap
// stopped resolving imports, every import would look fine and the check would
// pass in silence, so this proves it still fails on a real break.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { codemapProblems } from '../scripts/check-codemap.mjs'

const CHECKOUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the Codemap boundary check names a kernel import of tooling and of a file above engine/', async () => {
  const kernel = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-gate-'))
  try {
    fs.writeFileSync(path.join(kernel, 'supervisor.mjs'), 'export const supervisor = 1\n')
    fs.writeFileSync(path.join(kernel, 'inside.js'), 'export const inside = 1\n')
    fs.writeFileSync(
      path.join(kernel, 'world.js'),
      "import './inside.js'\nimport './supervisor.mjs'\nimport '../tools/outside.mjs'\nimport 'three'\n"
    )
    const problems = await codemapProblems(CHECKOUT, kernel)
    assert.deepEqual(
      problems.map(problem => problem.why.split(';')[0]),
      ['line 2 imports the tooling file engine/supervisor.mjs', 'line 3 imports ../tools/outside.mjs, outside engine/']
    )
  } finally {
    fs.rmSync(kernel, { recursive: true, force: true })
  }
})

test('the real kernel keeps its import boundary', async () => {
  assert.deepEqual(await codemapProblems(CHECKOUT), [])
})
