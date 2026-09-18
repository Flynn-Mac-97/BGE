import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { emptyGrid, record } from '../tools/dream/grid.mjs'
import { addGrid, readPool, poolSummary } from '../tools/dream/pool.mjs'
import { dreamPolicies } from '../tools/dream/dreaming.mjs'
import { loadPolicy } from '../tools/dream/policy.mjs'

/** A grid where branch 1 holds the win, so a policy's route is visible in its score. */
async function seededPool(directory) {
  const grid = emptyGrid({ id: 'run-a', target: 'a target', baseline: { value: 0.2, measures: {} }, branchCount: 3, refineCount: 2 })
  const outcome = (score, verdict = 'scored') => ({ score, verdict, reason: verdict === 'scored' ? null : 'refused', measures: {} })
  record(grid, { branch: 0, attempt: 0, outcome: outcome(0.21) })
  record(grid, { branch: 0, attempt: 1, outcome: outcome(null, 'refused') })
  record(grid, { branch: 0, attempt: 2, outcome: outcome(null, 'refused') })
  record(grid, { branch: 1, attempt: 0, outcome: outcome(0.3) })
  record(grid, { branch: 1, attempt: 1, outcome: outcome(0.5) })
  record(grid, { branch: 1, attempt: 2, outcome: outcome(0.9) })
  record(grid, { branch: 2, attempt: 0, outcome: outcome(0.22) })
  return addGrid(directory, grid)
}

/** A reviser that writes a policy which ignores its knob, to prove selection rejects it. */
const writesConstantPolicy = async ({ policyFile }) => {
  await fs.writeFile(policyFile, `import { LLMDesignedMethod } from '${policyImport()}'\n`
    + 'class Constant extends LLMDesignedMethod {\n'
    + '  constructor(config) { super(config); this.NAME = "constant" }\n'
    + '  solve(question) { question.reset(); while (question.legal_actions().length) { const legal = question.legal_actions(); question.probe_batch([legal[0]]) } }\n'
    + '}\n'
    + 'export default Constant\n', 'utf8')
  return { ok: true, status: 'completed', text: 'wrote a serial policy', durationMs: 1, tokens: null }
}

/** A reviser that writes a policy which probes nothing, to prove a broken version loses. */
const writesBrokenPolicy = async ({ policyFile }) => {
  await fs.writeFile(policyFile, `import { LLMDesignedMethod } from '${policyImport()}'\n`
    + 'class Broken extends LLMDesignedMethod {\n'
    + '  constructor(config) { super(config); this.NAME = "broken" }\n'
    + '  solve(question) { question.probe_batch(["0:1"]) }\n'
    + '}\n'
    + 'export default Broken\n', 'utf8')
  return { ok: true, status: 'completed', text: 'probes an illegal cell', durationMs: 1, tokens: null }
}

/** A file URL for the API module, so a policy written in a temp directory can import it. */
function policyImport() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return pathToFileURL(path.join(here, '..', 'tools', 'dream', 'policy-api.mjs')).href
}

test('the pool refuses a grid with nothing revealed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-pool-'))
  const empty = emptyGrid({ id: 'nothing', baseline: { value: 0.1 }, branchCount: 2, refineCount: 1 })
  const refused = await addGrid(directory, empty)
  const added = await seededPool(directory)
  const grids = await readPool(directory)
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(refused.error, /nothing revealed/)
  assert.equal(added.revealed, 7)
  assert.equal(grids.length, 1, 'the refused grid was written anyway')
  assert.equal(poolSummary(grids).best, 0.9)
})

test('a dreaming phase scores every version on the same frozen pool and deploys the winner', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-dreaming-'))
  await seededPool(directory)

  const record = await dreamPolicies({
    checkout: process.cwd(),
    runDirectory: directory,
    versions: 3,
    revise: writesConstantPolicy
  })
  const deployed = await loadPolicy(path.join(directory, 'policy/current.mjs'))
  const files = await fs.readdir(path.join(directory, 'replay'))
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(record.error, undefined, record.error)
  assert.equal(record.pool.grids, 1, 'the pool was not frozen for the phase')
  assert.equal(record.versions.length, 3)
  assert.equal(record.versions[0].policy, 'parallel-refine', 'version zero is not the policy the run had')
  assert.equal(record.versions[1].policy, 'constant')
  assert.equal(record.winner.version, 0, 'a serial policy that ignores beta won')
  assert.equal(record.improved, false, 'the run claimed an improvement it did not make')
  assert.equal(deployed.error, undefined)
  assert.equal(deployed.policy.NAME, 'parallel-refine', 'the deployed policy is not the winner')
  assert.deepEqual(files.sort(), ['v000.json', 'v001.json', 'v002.json'])
  assert.equal(record.versions[1].degenerate, true, 'a policy that ignores beta was reported as exposing a trade-off')
})

test('a version that cannot probe legally is recorded as failed and never wins', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-broken-'))
  await seededPool(directory)

  const record = await dreamPolicies({
    checkout: process.cwd(),
    runDirectory: directory,
    versions: 2,
    revise: writesBrokenPolicy
  })
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(record.versions[1].policy, 'broken')
  assert.ok(record.versions[1].failures > 0, 'an illegal probe was not recorded as a failure')
  assert.equal(record.winner.version, 0, 'a version that cannot probe won the phase')
})

test('a dreaming phase with an empty pool refuses instead of reporting a winner', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-nopool-'))
  const record = await dreamPolicies({ checkout: process.cwd(), runDirectory: directory, versions: 2, revise: writesConstantPolicy })
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(record.error, /no grids/)
  assert.equal(record.winner, undefined)
})

test('a revision that leaves the file unchanged scores what the last version scored', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-nochange-'))
  await seededPool(directory)

  const record = await dreamPolicies({
    checkout: process.cwd(),
    runDirectory: directory,
    versions: 2,
    revise: async () => ({ ok: true, status: 'completed', text: 'changed nothing', durationMs: 1, tokens: null })
  })
  await fs.rm(directory, { recursive: true, force: true })

  assert.equal(record.versions[1].score, record.versions[0].score, 'an unchanged file scored differently')
  assert.equal(record.improved, false)
  assert.equal(record.gain, 0)
})
