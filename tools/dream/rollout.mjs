/**
 * The online rollout: a policy choosing attempts that are really made.
 *
 * This is the paper's first stage, and the only stage that spends anything. The
 * policy reads what it has revealed, names a batch, and each cell in that batch
 * becomes a real attempt: a worktree branched from its parent's patch, an agent
 * working in it, and a score from the frozen setup. The outcomes are recorded
 * into the grid, which is what makes the rollout replayable afterwards.
 *
 * The question here has the same API as the replay question, so one policy runs
 * both. The difference is what a probe costs: replay reads an outcome that is
 * already written down, and this one buys it.
 *
 * A batch is executed one attempt after another and counted as one decision
 * round, which is what the parallelism penalty measures: how many decision rounds
 * a policy's route needs, not how many machines it used. Running a batch's
 * attempts at the same moment needs the policy to run off the main thread, since
 * the policy's `probe_batch` is synchronous and a synchronous wait cannot let a
 * child process's events fire. That is a known gap, stated here rather than
 * papered over: the batching is real, the concurrency is not yet.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCandidate } from './candidate.mjs'
import { legalActions, observationOf } from './grid.mjs'

/**
 * A grid cell id as the two numbers it holds.
 *
 * A cell id is `branch:attempt`, and a malformed one is a policy bug: refused
 * here rather than becoming `NaN` deeper in where it would look like a missing
 * attempt instead of a broken policy.
 */
export function parseCell(id) {
  const parts = String(id).split(':')
  if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part))) return null
  return { branch: Number(parts[0]), attempt: Number(parts[1]) }
}

/**
 * The question a live rollout is solved against.
 *
 * `attempt` does the work: `{ cell, parent, id }` in, an outcome out. It is a
 * parameter so a test can drive the whole rollout without an agent, and so a run
 * can be scored against a scripted attempt when the machinery is what is being
 * checked rather than the model.
 */
export function makeOnlineQuestion({ grid, maxParallelism = 3, attempt, onAttempt = null }) {
  const revealed = new Map()
  const records = []
  const history = []
  let probes = 0
  let sequentialRounds = 0
  let bestSoFar = grid.baseline?.value ?? 0

  const legalNow = () => legalActions({ ...grid, cells: Object.fromEntries(revealed) })
  const seqOf = id => [...revealed.keys()].indexOf(String(id))

  const question = {
    baseline_score: grid.baseline?.value ?? 0,
    max_parallelism: maxParallelism,

    get best_so_far() {
      return bestSoFar
    },
    get budget_spent() {
      return probes
    },

    reset() {
      // The paper's loop calls `reset` before it solves, so a rollout that has
      // not probed yet accepts the call as the no-op it is. Once a probe has been
      // spent it refuses: the attempts it made are new work, and there is no
      // record to put back.
      if (probes === 0) return
      throw new Error('an online rollout cannot be reset: its probes cost work that cannot be taken back')
    },

    observed() {
      const observed = {}
      for (const [id, cell] of revealed) observed[id] = observationOf(cell, grid)
      return observed
    },

    legal_actions() {
      return legalNow()
    },

    legal_roots() {
      return legalNow().filter(id => parseCell(id)?.attempt === 0)
    },

    opened_branches() {
      return [...new Set([...revealed.values()].map(cell => cell.branch))].sort((left, right) => left - right)
    },

    meta(id) {
      const key = String(id)
      const { branch, attempt } = parseCell(key) ?? { branch: null, attempt: null }
      const cell = revealed.get(key)
      return {
        branch,
        attempt,
        parent_id: attempt === 0 ? 'baseline' : `${branch}:${attempt - 1}`,
        seq: cell ? seqOf(key) : null,
        tags: attempt === 0 ? ['root'] : ['refine'],
        revealed: Boolean(cell),
        outcome: cell?.outcome ? { ...cell.outcome } : null
      }
    },

    /**
     * Make a batch of attempts, and reveal what they scored.
     *
     * The legality check is the same one replay applies, and for the same reason:
     * an attempt whose parent does not exist has no workspace to continue, and a
     * runner that invented one would be measuring a grid the policy never played.
     */
    async probe_batch(cells, onRevealOne = null) {
      const wanted = [].concat(cells).map(String)
      if (!wanted.length) return []
      if (wanted.length > maxParallelism) throw new Error(`a batch of ${wanted.length} exceeds max_parallelism ${maxParallelism}`)

      const legal = new Set(legalNow())
      for (const id of wanted) {
        if (!parseCell(id)) throw new Error(`${id} is not a cell id`)
        if (!legal.has(id)) throw new Error(`${id} is not a legal action`)
      }
      if (new Set(wanted).size !== wanted.length) throw new Error('a batch names the same cell twice')

      const answers = []
      for (const id of wanted) {
        const cell = parseCell(id)
        const parent = cell.attempt === 0 ? null : revealed.get(`${cell.branch}:${cell.attempt - 1}`)
        // Awaited: this probe buys an attempt, where a replay probe reads one.
        const made = await attempt({ cell, parent, id, grid })
        const outcome = made.outcome ?? null
        // The patch path is kept with the revealed cell: a child attempt
        // continues from its parent's patch, so a branch is a line of work
        // rather than a series of unrelated tries. `seq` is the order the policy
        // probed it in, which is the route the picture draws.
        const stored = { branch: cell.branch, attempt: cell.attempt, outcome, patchPath: made.patchPath ?? null, seq: probes + 1 }
        revealed.set(id, stored)
        grid.cells[id] = stored
        probes++
        records.push({ id, ...made })

        const answer = { id, ...question.meta(id) }
        answers.push(answer)
        onRevealOne?.(answer)
        // Awaited, so a watcher that writes the grid on every attempt sees the
        // cells in the order they were made rather than whenever a write lands.
        await onAttempt?.(answer, made)
      }

      const top = answers.reduce((highest, answer) => {
        const score = answer.outcome?.score
        return typeof score === 'number' && score > highest ? score : highest
      }, bestSoFar)
      bestSoFar = Number(top.toFixed(6))

      const effective = Math.ceil(wanted.length / maxParallelism)
      sequentialRounds += effective
      history.push({ cells: wanted, effective, probes, sequentialRounds, attainment: bestSoFar })
      return answers
    },

    usage() {
      return { probes, sequentialRounds, rounds: history.length }
    },

    trace() {
      return history.map((round, index) => ({ round: index + 1, batch: round.cells, effectiveSequentialRounds: round.effective, probesSoFar: round.probes, attainment: round.attainment }))
    }
  }

  return { question, records, revealed, grid }
}

/**
 * Drive one policy over one grid, making every attempt it asks for.
 *
 * The policy is called once and runs to its own stop, as the paper's `solve`
 * does. Every probe it spends is a real attempt, which is why the rollout is the
 * expensive part of the loop and the reason the dreaming phase exists.
 */
export async function rolloutOnce({ grid, policy, maxParallelism = 3, attempt, onAttempt = null } = {}) {
  const { question, records } = makeOnlineQuestion({ grid, maxParallelism, attempt, onAttempt })
  let failure = null
  const started = Date.now()

  try {
    await policy.solve(question, null)
  } catch (error) {
    failure = String(error?.message || error)
  }

  const usage = question.usage()
  return {
    grid,
    policy: policy.NAME ?? policy.constructor?.name ?? 'unnamed',
    beta: policy.beta ?? null,
    failure,
    probes: usage.probes,
    rounds: usage.rounds,
    attained: grid.baseline?.value === undefined ? null : Math.max(grid.baseline.value, ...Object.values(grid.cells).map(cell => cell.outcome?.score ?? -Infinity)),
    records,
    durationMs: Date.now() - started
  }
}

/**
 * What one attempt's patch is called on disk.
 *
 * The round is part of the name. Cell `0:0` exists in every round of a run, so a
 * name without the round means a later round writes over the earlier one's patch
 * — which is how a round that had already been paid for lost its record.
 */
export function attemptPatchName({ round, cell }) {
  const [branch, attempt] = String(cell).split(':')
  return `r${String(round).padStart(3, '0')}-b${branch}a${attempt}.patch`
}

/**
 * The attempt a real rollout makes: one worktree, one agent, one score.
 *
 * The parent's patch is the workspace the attempt continues from, which is what
 * makes a branch a line of work rather than a series of unrelated tries.
 */
export function realAttempt({ checkout, runDirectory, setup, target, files, setupHash, timeoutSeconds, model, harness, round = 1 }) {
  return async ({ cell, parent, id }) => {
    const record = await runCandidate({
      checkout,
      runDirectory,
      setup,
      attempt: cell.attempt + 1,
      // The round is the run's own round number, used as given. Adding one here
      // as well put a round-002 candidate's patch under an `r003` name, so the
      // patch prefix and the round directory disagreed about which round it was.
      round,
      id: `rsi-b${cell.branch}`,
      target,
      files,
      parent: parent ? { id: `${cell.branch}:${cell.attempt - 1}`, patch: parent.patchPath ?? null, depth: cell.attempt } : null,
      depth: cell.attempt,
      timeoutSeconds,
      model,
      harness
    })

    // The patch is written beside the run's records so the next attempt on this
    // branch can continue from it. Without the file there is nothing to continue
    // from: a candidate is its parent's patch plus its own work.
    const patchFile = path.join(runDirectory, 'rsi', attemptPatchName({ round, cell: id }))
    await fs.mkdir(path.dirname(patchFile), { recursive: true })
    if (record.patch) await fs.writeFile(patchFile, record.patch, 'utf8')

    return {
      id,
      record,
      patchPath: record.patch ? patchFile : null,
      outcome: {
        score: record.evaluated ? record.value : null,
        verdict: record.verdict,
        evaluated: record.evaluated === true,
        valid: record.valid === true,
        failClass: record.failClass ?? (record.verdict === 'scored' ? 'ok' : 'refused'),
        error: record.error ?? record.reason ?? null,
        nValid: record.nValid ?? null,
        nTotal: record.nTotal ?? null,
        measures: record.measures ?? null,
        tokens: record.tokens?.totalTokens ?? null,
        verifiedAgainst: setupHash ?? null
      }
    }
  }
}
