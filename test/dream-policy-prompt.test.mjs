import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { emptyGrid, record } from '../tools/dream/grid.mjs'
import { makeQuestion } from '../tools/dream/replay.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROMPT = path.resolve(HERE, '..', 'tools', 'dream', 'prompts', 'policy.md')

/** The question a policy is solved against, with one revealed cell. */
function questionWithOneProbe() {
  const grid = emptyGrid({ id: 'prompt-check', baseline: { value: 0.2, measures: {} }, branchCount: 2, refineCount: 1 })
  record(grid, { branch: 0, attempt: 0, outcome: { score: 0.3, verdict: 'scored', measures: {} } })
  return makeQuestion({ grid, maxParallelism: 2 })
}

/**
 * The question members the prompt must teach, so a rewrite cannot quietly drop
 * the prefix-only API and still pass by naming nothing.
 */
const REQUIRED = ['reset', 'observed', 'legal_actions', 'legal_roots', 'opened_branches', 'meta', 'probe_batch', 'baseline_score', 'max_parallelism']

test('the policy prompt names only question API the question really offers', async () => {
  const text = await fs.readFile(PROMPT, 'utf8')
  const named = [...new Set([...text.matchAll(/\bquestion\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]))]
  const question = questionWithOneProbe()

  assert.ok(named.length > 0, 'the prompt names no question member at all')
  for (const name of named) {
    assert.ok(name in question, `the policy prompt names question.${name}, which the question does not offer`)
  }
  for (const name of REQUIRED) {
    assert.ok(named.includes(name), `the policy prompt no longer names question.${name}`)
  }
})
