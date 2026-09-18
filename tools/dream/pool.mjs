/**
 * The simulator pool: the recorded grids a dreaming phase is scored against.
 *
 * The paper's second stage converts a recorded discovery tree into a reusable
 * simulator and keeps a pool of them. A policy is then judged on the pool, not on
 * one trace, so a policy that wins on a single lucky history does not win.
 *
 * A pool entry is one grid, written as JSON beside the other run records. It is
 * data, not code: a replay reads it and nothing else, which is why a pool of a
 * dozen rollouts can be re-scored at the price of arithmetic.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Where a run keeps its pool. */
const POOL = 'pool'

/** A grid id that is safe as a file name and still says which grid it is. */
const fileNameFor = (grid, at) => `${String(grid.id ?? 'grid').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60)}-${String(at).padStart(3, '0')}.json`

/** Every grid in a run's pool, oldest first. */
export async function readPool(runDirectory) {
  const directory = path.join(runDirectory, POOL)
  const names = (await fs.readdir(directory).catch(() => [])).filter(name => name.endsWith('.json')).sort()
  const grids = []
  for (const name of names) {
    try {
      grids.push(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')))
    } catch { /* a grid still being written */ }
  }
  return grids
}

/**
 * Add one grid to the pool.
 *
 * Refused rather than repaired when it names no cell outcomes at all: a grid with
 * nothing revealed is not a simulator, and scoring policies against it would
 * report rewards for arithmetic on an empty record.
 */
export async function addGrid(runDirectory, grid) {
  const revealed = Object.keys(grid.cells ?? {}).length
  if (revealed === 0) return { error: 'a grid with nothing revealed is not a simulator to dream in' }
  if (typeof grid.baseline?.value !== 'number') return { error: 'a grid needs the score of the target as it stood' }

  const directory = path.join(runDirectory, POOL)
  await fs.mkdir(directory, { recursive: true })
  const existing = await fs.readdir(directory).catch(() => [])
  const file = path.join(directory, fileNameFor(grid, existing.length + 1))
  await fs.writeFile(file, `${JSON.stringify(grid, null, 2)}\n`, 'utf8')
  return { file, revealed, branches: grid.branchCount, refinements: grid.refineCount }
}

/** What a pool holds, for a record a person or an agent reads. */
export function poolSummary(grids) {
  return {
    grids: grids.length,
    cells: grids.reduce((total, grid) => total + Object.keys(grid.cells ?? {}).length, 0),
    branches: grids.reduce((total, grid) => total + (grid.branchCount ?? 0), 0),
    best: grids.reduce((best, grid) => {
      const scores = Object.values(grid.cells ?? {}).map(cell => cell.outcome?.score).filter(score => typeof score === 'number')
      const top = scores.length ? Math.max(...scores) : null
      return top !== null && (best === null || top > best) ? top : best
    }, null)
  }
}

/**
 * Read every run in a checkout that has recorded attempts, as pool candidates.
 *
 * A pool built from one run's own rollouts is thin for the first dreaming phase;
 * earlier runs are real recorded attempts, and the paper's claim is about
 * accumulated discovery history rather than about one rollout.
 */
export async function poolsFromRuns(checkout, { limit = 5 } = {}) {
  const runs = path.join(checkout, 'agent-runs')
  const names = (await fs.readdir(runs).catch(() => []))
    .filter(name => name.startsWith('dream-'))
    .sort()
    .slice(-limit)
  return names.map(name => path.join(runs, name))
}
