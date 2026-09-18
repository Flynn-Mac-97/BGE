/**
 * The policies a run may start from.
 *
 * Each is the shape the paper's prompt asks for: a class extending
 * `LLMDesignedMethod`, one `beta` scalar read in the constructor, every
 * behavioural threshold read through `schedule(beta)`, and `solve(question,
 * budget)` returning after it has probed. `parallel-refine` is the paper's own
 * starting point and is the floor a dreamed policy has to beat.
 *
 * What they may read is only what they revealed. They never see the grid, the
 * record behind the question, or a score they have not paid a probe for — that
 * restriction is what makes a replay score mean anything.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LLMDesignedMethod } from './policy-api.mjs'
import { branchFailedHard, branchPromising, probesOf } from './observation-signal.mjs'

/** The best scored observation a policy has revealed, or null. */
const bestScored = observations => probesOf(observations)
  .filter(cell => cell.evaluated && typeof cell.score === 'number')
  .reduce((best, cell) => (best === null || cell.score > best.score ? cell : best), null)

/** The observation of one cell, from the revealed set. */
const at = (observations, id) => observations[id] ?? null

/**
 * The paper's starting policy: several workspaces at once, each refining what it
 * has, the best-known line refined first.
 *
 * It fills its batch, because the parallelism penalty is exactly the difference
 * between a policy that uses its workers and one that does not.
 */
export class ParallelRefine extends LLMDesignedMethod {
  constructor(config) {
    super(config)
    this.NAME = config?.name ?? 'parallel-refine'
  }

  async solve(question, budget = null) {
    question.reset()
    const schedule = this.schedule()
    let flatRounds = 0
    let attainment = question.baseline_score

    while (true) {
      const legal = question.legal_actions()
      if (!legal.length) return
      const observed = question.observed()

      const batch = []
      // How much of the batch goes to directions nobody has tried is the beta
      // decision: high beta spends more on width, low beta spends it on the lines
      // that are already working. Without this the knob changes nothing and the
      // sweep would say so.
      const roots = question.legal_roots()
      const roomForRoots = Math.max(1, Math.round(question.max_parallelism * schedule.exploreShare))
      for (const root of roots.slice(0, roomForRoots)) {
        if (batch.length >= question.max_parallelism) break
        batch.push(root)
      }

      // Then the best line anyone has, refined. A branch whose every probe failed
      // unrecoverably is not refined, and that judgement comes from the paper's
      // own signal rather than from a score comparison.
      const best = bestScored(observed)
      if (best) {
        const dead = branchFailedHard(observed, best.branch)
        const frontier = `${best.branch}:${best.attempt + 1}`
        if (!dead.hard && legal.includes(frontier) && !batch.includes(frontier)) batch.push(frontier)
      }

      // A branch that failed repairably is worth one more attempt once beta asks
      // for patience, which is the paper's rule that a repairable failure is not
      // a closed branch.
      for (const branch of question.opened_branches()) {
        if (batch.length >= question.max_parallelism) break
        const failed = branchFailedHard(question.observed(), branch)
        if (failed.hard) continue
        const { promising } = branchPromising(question.observed(), branch)
        const deepest = Math.max(...Object.values(observed).filter(one => one.branch === branch).map(one => one.attempt))
        if (promising || schedule.patience > deepest) {
          const frontier = `${branch}:${deepest + 1}`
          if (legal.includes(frontier) && !batch.includes(frontier)) batch.push(frontier)
        }
      }

      // Any remaining room goes to lines that have shown something, and only
      // while beta asks for width. Filling the batch with anything legal
      // regardless would make beta change nothing: a policy that always fills
      // its workers has no trade-off to expose, and the paper's sweep is what
      // asks whether there is one.
      if (schedule.exploreShare > 0.4) {
        for (const id of legal) {
          if (batch.length >= question.max_parallelism) break
          if (batch.includes(id)) continue
          const [branch] = id.split(':').map(Number)
          if (branchPromising(question.observed(), branch).promising) batch.push(id)
        }
      }

      const chosen = batch.slice(0, question.max_parallelism)
      if (!chosen.length) return
      await question.probe_batch(chosen)

      // Low beta stops early: the paper's schedule says a low beta has an earlier
      // stagnation stop, and a policy that ignores it is not using its knob.
      const now = bestScored(question.observed())
      const reached = now ? now.score : question.baseline_score
      flatRounds = reached > attainment ? 0 : flatRounds + 1
      attainment = Math.max(attainment, reached)
      if (flatRounds >= schedule.stopAfterFlat && question.legal_roots().length === 0) return
    }
  }
}

/**
 * One probe per round: the serial extreme.
 *
 * The penalty drives it towards 1, which is what makes it the control for
 * whether a policy is really batching. It exists to be beaten, and to prove the
 * penalty measures what the paper says it measures.
 */
export class SerialRefine extends LLMDesignedMethod {
  constructor(config) {
    super(config)
    this.NAME = config?.name ?? 'serial-refine'
  }

  async solve(question) {
    question.reset()
    while (true) {
      const legal = question.legal_actions()
      if (!legal.length) return
      const best = bestScored(question.observed())
      const frontier = best ? `${best.branch}:${best.attempt + 1}` : null
      const next = frontier && legal.includes(frontier) ? frontier : (question.legal_roots()[0] ?? legal[0])
      await question.probe_batch([next])
    }
  }
}

/**
 * Exploitation with no exploration: one root, then deepen whatever scores.
 *
 * A policy that never opens a second branch cannot know whether another
 * direction was better, and on a grid where the win is on branch 1 it loses by
 * construction. It is here to be the local-optimum case the paper warns about.
 */
export class GreedyBest extends LLMDesignedMethod {
  constructor(config) {
    super(config)
    this.NAME = config?.name ?? 'greedy-best'
  }

  async solve(question) {
    question.reset()
    const first = question.legal_roots()[0]
    if (!first) return
    await question.probe_batch([first])

    while (true) {
      const best = bestScored(question.observed())
      if (!best) return
      const frontier = `${best.branch}:${best.attempt + 1}`
      const legal = question.legal_actions()
      if (!legal.includes(frontier)) return
      await question.probe_batch([frontier])
    }
  }
}

/** The policies a run may start from, by name. */
export const POLICIES = {
  'parallel-refine': { policy: ParallelRefine, source: 'policy.mjs', marker: 'ParallelRefine' },
  'serial-refine': { policy: SerialRefine, source: 'policy.mjs', marker: 'SerialRefine' },
  'greedy-best': { policy: GreedyBest, source: 'policy.mjs', marker: 'GreedyBest' }
}

/** One shipping policy, built at one beta. */
export function makePolicy(name, beta = 0.6) {
  return new POLICIES[name].policy({ beta })
}

/**
 * Load a policy from a file.
 *
 * Refused rather than repaired: a policy that will not load, or that has no
 * `solve`, would leave a dreaming phase scoring nothing while reporting a winner.
 * A policy that is a plain object with a solve is accepted too, so a hand-written
 * one need not be a class.
 */
export async function loadPolicy(file) {
  const module = await import(pathToFileURL(file).href)
  const exported = module.default
  if (!exported) return { error: `${file} exports nothing` }

  // The constructor is kept beside the instance so an evaluator can build the
  // same policy at every beta of a sweep without the file being re-imported.
  const Class = typeof exported === 'function' ? exported : null
  const policy = Class ? new Class({ beta: module.BETA ?? 0.6 }) : exported
  if (typeof policy.solve !== 'function') return { error: `${file} exports no policy with a solve method` }
  const NAME = policy.NAME ?? module.NAME ?? policy.constructor?.name
  if (typeof NAME !== 'string' || !NAME) return { error: `${file} names no policy: a NAME is required to report a winner` }
  policy.NAME = NAME
  return { policy, Class, file }
}

/**
 * A starter policy file for a run, written where the dreaming phase will edit it.
 *
 * The whole shipping file is copied and its two imports are rewritten to reach
 * back to the tools directory. So a version is one complete, readable file: the
 * agent revising it edits code it can see in full, and the recorded diff between
 * versions is the change the dreaming phase proposed.
 */
export async function policySource(name = 'parallel-refine', { into = null } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const entry = POLICIES[name]
  if (!entry) return { error: `no policy called ${name}` }

  const text = await fs.readFile(path.join(here, 'policy.mjs'), 'utf8')
  const relative = into ? path.relative(into, here).split(path.sep).join('/') : '..'
  // A run directory sits inside the checkout, so a relative path is the normal
  // case and reads best in a diff. A path that came back absolute means the two
  // are on different drives, where a relative path does not exist: a file URL is
  // then the only specifier Node will load.
  const specifier = file => (relative.startsWith('.') ? `${relative}/${file}` : pathToFileURL(path.join(here, file)).href)
  const source = `// A dream run's exploration policy, started from the shipping ${name} and\n`
    + `// improved by dreaming over recorded attempts. Only this file changes.\n`
    + text
      .replace("from './policy-api.mjs'", `from '${specifier('policy-api.mjs')}'`)
      .replace("from './observation-signal.mjs'", `from '${specifier('observation-signal.mjs')}'`)
    // The file is a policy module, so it names the policy a run plays. Without
    // this it would export three classes and no answer to "which one".
    + `\nexport default ${entry.marker}\n`

  return { source, name, marker: entry.marker, policy: POLICIES[name].policy }
}
