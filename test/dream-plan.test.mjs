import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { planRound, rsiRun } from '../tools/dream/rsi.mjs'
import { gridPlan } from '../tools/dream/policy-api.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECKOUT = path.resolve(HERE, '..')
const apiUrl = pathToFileURL(path.join(CHECKOUT, 'tools/dream/policy-api.mjs')).href

/** What the scripted world scores, so a policy's route is visible in its reward. */
const TRUTH = { '0:0': 0.22, '0:1': 0.24, '1:0': 0.3, '1:1': 0.45, '1:2': 0.8, '2:0': 0.21 }

/**
 * A run directory that is ready to explore: a frozen setup, a target, and the
 * score the target as it stood was given. No agent is involved.
 */
async function readyRun() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dream-plan-'))
  await fs.writeFile(path.join(directory, 'target.json'), `${JSON.stringify({ target: 'a target', files: [], startedAt: new Date().toISOString() })}\n`, 'utf8')
  await fs.writeFile(path.join(directory, 'setup.mjs'), 'export default { name: "scripted", project: "test/fixture-project", weights: {}, tasks: [{ id: "t", question: "q", run: () => ({ pass: true, problem: null, measures: {} }) }] }\n', 'utf8')
  await fs.writeFile(path.join(directory, 'setup-check.json'), `${JSON.stringify({
    name: 'scripted',
    project: 'test/fixture-project',
    weights: {},
    tasks: [{ id: 't', question: 'q' }],
    digest: 'scripted-digest',
    working: { value: 0.2, totals: { measures: { characters: 100 } } },
    control: { value: 0, reason: 'refused on purpose' }
  }, null, 2)}\n`, 'utf8')
  return directory
}

/** One attempt, reading the scripted truth. */
const attempt = async ({ id }) => {
  const score = TRUTH[id]
  return {
    id,
    patchPath: null,
    outcome: score === undefined
      ? { score: null, verdict: 'refused', reason: 'nothing here', measures: {} }
      : { score, verdict: 'scored', reason: null, measures: { characters: 100 } }
  }
}

/** A policy object that plans the grid it is given, and says whether it was asked. */
function policyThatPlans(plan, { onPlan = null } = {}) {
  return {
    NAME: 'planner',
    beta: 0.5,
    plan_grid(context) {
      onPlan?.(context)
      return typeof plan === 'function' ? plan(context) : plan
    },
    async solve(question) {
      question.reset()
      while (question.legal_actions().length) await question.probe_batch([question.legal_actions()[0]])
    }
  }
}

/** A policy file that plans a grid, for a run to load from `policy/current.mjs`. */
function plannerFile({ branchCount, refineCount, reason = 'from the policy' }) {
  return `import { LLMDesignedMethod, gridPlan } from '${apiUrl}'\n`
    + 'class Planner extends LLMDesignedMethod {\n'
    + '  constructor(config) { super(config); this.NAME = "planner" }\n'
    + `  plan_grid() { return gridPlan({ branchCount: ${branchCount}, refineCount: ${refineCount}, reason: ${JSON.stringify(reason)} }) }\n`
    + '  async solve(question) { question.reset(); while (question.legal_actions().length) { await question.probe_batch([question.legal_actions()[0]]) } }\n'
    + '}\n'
    + 'export default Planner\n'
}

test('a policy that plans its own grid has its plan used and recorded as the policy\'s', () => {
  let seen = null
  const policy = policyThatPlans(
    gridPlan({ branchCount: 3, refineCount: 1, reason: 'many directions, shallow' }),
    { onPlan: context => { seen = context } }
  )
  const plan = planRound({ policy, history: [], hardMaxBranchCount: 4, hardMaxRefineCount: 4, maxParallelism: 2 })

  assert.equal(plan.error, undefined, plan.error)
  assert.equal(plan.branchCount, 3)
  assert.equal(plan.refineCount, 1)
  assert.equal(plan.source, 'policy')
  assert.match(plan.reason, /many directions/)

  // The context holds prefix-safe facts only: no current grid, no outcome.
  assert.deepEqual(
    Object.keys(seen).sort(),
    ['fallback', 'hardMaxBranchCount', 'hardMaxRefineCount', 'history', 'maxParallelism', 'traceBranchCount', 'traceRefineCount']
  )
})

test('a policy with no plan_grid falls back to the runner, and the plan says the runner chose', () => {
  const without = planRound({ policy: { NAME: 'no-planner', beta: 0.5, async solve() {} }, history: [] })
  const noPolicy = planRound({ history: [] })

  for (const plan of [without, noPolicy]) {
    assert.equal(plan.error, undefined, plan.error)
    assert.equal(plan.source, 'runner')
    assert.equal(plan.branchCount, 2)
    assert.match(plan.reason, /no earlier rollout/)
  }
})

test('a plan over the hard caps is refused with a reason that names the cap', () => {
  const wide = planRound({
    policy: policyThatPlans(gridPlan({ branchCount: 9, refineCount: 1, reason: 'too wide' })),
    hardMaxBranchCount: 4,
    hardMaxRefineCount: 2
  })
  assert.match(wide.error, /branches/)
  assert.match(wide.error, /hard cap of 4/)

  const deep = planRound({
    policy: policyThatPlans(gridPlan({ branchCount: 2, refineCount: 5, reason: 'too deep' })),
    hardMaxBranchCount: 4,
    hardMaxRefineCount: 2
  })
  assert.match(deep.error, /refinements/)
  assert.match(deep.error, /hard cap of 2/)
})

test('a plan that is not whole numbers or carries no reason is refused, not repaired', () => {
  const fractional = planRound({ policy: policyThatPlans({ branchCount: 1.5, refineCount: 1, reason: 'x' }) })
  assert.match(fractional.error, /whole numbers/)

  const silent = planRound({ policy: policyThatPlans({ branchCount: 2, refineCount: 1 }) })
  assert.match(silent.error, /states a reason/)

  const nothing = planRound({ policy: policyThatPlans(undefined) })
  assert.match(nothing.error, /returned no grid plan/)

  const promised = planRound({ policy: policyThatPlans(Promise.resolve(gridPlan({ branchCount: 1, refineCount: 0, reason: 'later' }))) })
  assert.match(promised.error, /returned a promise/)
})

test('a pinned plan overrides both the policy and the runner', () => {
  let asked = 0
  const policy = policyThatPlans(
    gridPlan({ branchCount: 3, refineCount: 3, reason: 'the policy would widen' }),
    { onPlan: () => { asked++ } }
  )
  const plan = planRound({
    policy,
    history: [{ plannedBranchCount: 4, plannedRefineCount: 4, bestAttempt: 0 }],
    fixed: { branchCount: 2, refineCount: 1 }
  })

  assert.equal(plan.source, 'pinned')
  assert.equal(plan.branchCount, 2)
  assert.equal(plan.refineCount, 1)
  assert.match(plan.reason, /pinned/)
  assert.equal(asked, 0, 'a pinned plan must not ask the policy')
})

test('a round records whether the policy or the runner planned its grid', async () => {
  const planned = await readyRun()
  await fs.mkdir(path.join(planned, 'policy'), { recursive: true })
  await fs.writeFile(path.join(planned, 'policy', 'current.mjs'), plannerFile({ branchCount: 2, refineCount: 1 }), 'utf8')
  const plannedRun = await rsiRun({ checkout: CHECKOUT, runDirectory: planned, rounds: 1, versions: 1, maxParallelism: 2, attempt })
  const plannedRecord = JSON.parse(await fs.readFile(path.join(planned, 'rsi/round-001/rollout.json'), 'utf8'))
  await fs.rm(planned, { recursive: true, force: true })

  const runner = await readyRun()
  const runnerRun = await rsiRun({ checkout: CHECKOUT, runDirectory: runner, rounds: 1, versions: 1, maxParallelism: 2, attempt })
  const runnerRecord = JSON.parse(await fs.readFile(path.join(runner, 'rsi/round-001/rollout.json'), 'utf8'))
  await fs.rm(runner, { recursive: true, force: true })

  assert.equal(plannedRun.error, undefined, plannedRun.error)
  assert.equal(plannedRecord.plan.source, 'policy')
  assert.equal(plannedRecord.plan.branchCount, 2)
  assert.equal(plannedRecord.plan.refineCount, 1)
  assert.match(plannedRecord.plan.reason, /from the policy/)
  // The planned grid is the bound; the effective grid is what the runner made.
  assert.deepEqual(plannedRecord.effective, { branchCount: 2, refineCount: 1 })
  // The opened grid is what the policy actually reached.
  assert.deepEqual(plannedRecord.opened, { width: 2, depth: 1 })

  assert.equal(runnerRun.error, undefined, runnerRun.error)
  assert.equal(runnerRecord.plan.source, 'runner')
  assert.equal(runnerRecord.effective.branchCount, runnerRecord.plan.branchCount)
  assert.ok(runnerRecord.opened.width > 0, 'the runner-planned round explored nothing')
})

test('a run stops when the policy plans outside the hard caps, and names the cap', async () => {
  const directory = await readyRun()
  await fs.mkdir(path.join(directory, 'policy'), { recursive: true })
  await fs.writeFile(path.join(directory, 'policy', 'current.mjs'), plannerFile({ branchCount: 9, refineCount: 1 }), 'utf8')

  const result = await rsiRun({ checkout: CHECKOUT, runDirectory: directory, rounds: 1, versions: 1, maxParallelism: 2, attempt })
  const status = JSON.parse(await fs.readFile(path.join(directory, 'rsi.json'), 'utf8'))
  const rounds = await fs.readdir(path.join(directory, 'rsi')).catch(() => [])
  await fs.rm(directory, { recursive: true, force: true })

  assert.match(result.error, /hard cap of 4/)
  assert.equal(status.phase, 'plan-failed')
  assert.equal(rounds.includes('round-001'), false, 'a refused plan must not create a grid')
})
