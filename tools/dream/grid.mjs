/**
 * The discovery grid: what a policy moves over, and what replay reveals.
 *
 * A grid is the paper's branch x attempt environment. Cell `b:a` is attempt `a`
 * on branch `b`; attempt 0 opens a branch from the target, and a later attempt
 * refines the attempt before it. Branch and attempt are both fixed in advance —
 * that is what makes the environment finite, and what makes a policy's route
 * through it comparable to another policy's route.
 *
 * A cell holds an outcome, which is what a run recorded when that attempt was
 * really made: a score, the measures behind it, and whether it was refused.
 * A cell the run never reached holds no outcome at all, which is not the same as
 * a cell that scored badly, and replay treats it as work that buys nothing.
 *
 * Nothing here runs anything. A grid is read from a run's records, or written by
 * a test, and replay reads it. That is the whole point: once attempts are
 * recorded, a policy can be tried against them for the price of arithmetic.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * The cell a policy reads. Only revealed cells are ever handed out.
 *
 * The field names are the paper's `Observation`. `n_valid` and `n_total` are the
 * checks that passed against the checks that ran, so a policy can see partial
 * progress; they are null on a cell with no recorded outcome. `evaluated` is
 * false both for a cell the run never reached and for a harness failure that
 * produced no score, and `fail_class` names which.
 */
export const observationOf = (cell, grid) => {
  const parent = cell.attempt > 0 ? grid.cells[`${cell.branch}:${cell.attempt - 1}`] : null
  const outcome = cell.outcome
  return {
    branch: cell.branch,
    attempt: cell.attempt,
    score: outcome ? outcome.score : null,
    evaluated: outcome ? outcome.evaluated !== false : false,
    valid: outcome ? (outcome.valid ?? outcome.verdict === 'scored') : false,
    fail_class: outcome ? (outcome.failClass ?? (outcome.verdict === 'scored' ? 'ok' : 'refused')) : 'not_recorded',
    error: outcome ? outcome.error ?? outcome.reason ?? null : 'this attempt was never made',
    delta_vs_baseline: outcome && outcome.score !== null ? Number((outcome.score - grid.baseline.value).toFixed(6)) : null,
    delta_vs_parent: outcome?.score != null && parent?.outcome?.score != null
      ? Number((outcome.score - parent.outcome.score).toFixed(6))
      : null,
    n_valid: outcome?.nValid ?? null,
    n_total: outcome?.nTotal ?? null
  }
}

/** One cell, as the grid stores it. `outcome` is null when the attempt was never made. */
const makeCell = (branch, attempt, outcome = null) => ({ branch, attempt, outcome })

/**
 * How many cells a grid is made of, and how many cells each cell can reach.
 *
 * `branchCount` is the paper's `W` of branches and `refineCount` is its `R` of
 * refinements. The cell count is what a policy's route is measured against, so
 * it belongs to the grid rather than to the policy.
 */
export function gridSize(grid) {
  return grid.branchCount * (grid.refineCount + 1)
}

/**
 * The attempt after the last revealed one on a branch, or null when the branch
 * is full.
 *
 * The next attempt is one past the deepest revealed one, not a count of cells:
 * attempt `a` continues the workspace of attempt `a-1`, so the only attempt a
 * policy may make is the one whose parent exists.
 */
function frontierOf(grid, branch) {
  const attempts = Object.values(grid.cells).filter(cell => cell.branch === branch).map(cell => cell.attempt)
  const next = attempts.length ? Math.max(...attempts) + 1 : 0
  return next <= grid.refineCount ? makeCell(branch, next) : null
}

/**
 * The legal moves: a branch never opened, or the next attempt of an opened one.
 *
 * This is the paper's `A(T) = {root} ∪ {leaves}` written for a grid. A policy may
 * not jump to attempt 3 of a branch whose attempt 1 was never made, because the
 * workspace that attempt would continue from does not exist.
 */
export function legalCells(grid) {
  const legal = []
  for (let branch = 0; branch < grid.branchCount; branch++) {
    const frontier = frontierOf(grid, branch)
    if (frontier) legal.push(frontier)
  }
  return legal
}

/** The legal moves, as cell ids: what a policy names in a batch. */
export function legalActions(grid) {
  return legalCells(grid).map(cell => `${cell.branch}:${cell.attempt}`)
}

/** The cells revealed so far, oldest first, as observations. */
export function revealedCells(grid) {
  return Object.values(grid.cells)
    .sort((left, right) => left.branch - right.branch || left.attempt - right.attempt)
    .map(cell => observationOf(cell, grid))
}

/** A grid with no attempt made yet. */
export function emptyGrid({ id = 'grid', target = '', baseline, branchCount = 3, refineCount = 3 } = {}) {
  return {
    version: 1,
    id,
    target,
    baseline,
    branchCount,
    refineCount,
    cells: {}
  }
}

/** Put one attempt's outcome into a grid. Used by a rollout and by a test. */
export function record(grid, { branch, attempt, outcome }) {
  grid.cells[`${branch}:${attempt}`] = makeCell(branch, attempt, outcome)
  return grid
}

/**
 * Read a run's rounds into a grid.
 *
 * A run's candidates are a chain: each round's candidate descends from the best
 * before it. Read as a grid, that chain is one branch refined once per round,
 * and the branches the policy never opened hold no outcome — which is exactly
 * what an agent working a policy has to discover. So an evolutionary run is a
 * legitimate grid, and a policy can be replayed against what it did.
 */
export async function gridFromRun(runDirectory, { branchCount = 3, refineCount = null } = {}) {
  const read = async file => JSON.parse(await fs.readFile(path.join(runDirectory, file), 'utf8').catch(() => 'null'))
  const target = await read('target.json')
  const check = await read('setup-check.json')
  if (!check) return { error: `no setup-check.json in ${runDirectory}` }

  const roundsDirectory = path.join(runDirectory, 'rounds')
  const names = (await fs.readdir(roundsDirectory).catch(() => [])).sort()
  const records = []
  for (const name of names) {
    const directory = path.join(roundsDirectory, name)
    const round = Number(name.replace(/^r/, ''))
    const files = await fs.readdir(directory).catch(() => [])
    for (const file of files.filter(entry => entry.endsWith('.json') && entry !== 'round.json').sort()) {
      try {
        records.push({ round, record: JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')) })
      } catch { /* a candidate still being written */ }
    }
  }

  const grid = emptyGrid({
    id: path.basename(runDirectory),
    target: target?.target ?? '',
    baseline: { value: check.working.value, measures: check.working.totals?.measures ?? {} },
    branchCount,
    // One deeper than the run went. A grid with no room past the record would
    // make every policy look the same: it could not probe anything new, and the
    // question of what a policy would have tried next would have no answer.
    refineCount: refineCount ?? Math.max(1, records.length + 1)
  })

  // Every attempt above the baseline goes on branch 0, which is what the run
  // did: it refined its best version and never opened a second line of work.
  // Attempt 0 opens the branch, so the first candidate is 0:0 and not 0:1.
  records.forEach((entry, index) => {
    const evaluated = entry.record.evaluated ?? entry.record.verdict === 'scored'
    const outcome = {
      score: evaluated ? entry.record.value : null,
      verdict: entry.record.verdict,
      evaluated,
      valid: entry.record.valid ?? entry.record.verdict === 'scored',
      failClass: entry.record.failClass ?? (entry.record.verdict === 'scored' ? 'ok' : 'refused'),
      error: entry.record.error ?? entry.record.reason ?? null,
      nValid: entry.record.nValid ?? null,
      nTotal: entry.record.nTotal ?? null,
      measures: entry.record.measures ?? null,
      tokens: entry.record.tokens?.totalTokens ?? null,
      best: entry.record.best === true
    }
    record(grid, { branch: 0, attempt: index, outcome })
  })

  return { grid, attempts: records.length }
}

/**
 * A grid that was never run: every cell empty, for a policy to be replayed on
 * when nothing has been attempted yet.
 */
export function openGrid(grid) {
  return { ...grid, cells: {} }
}
