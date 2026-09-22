/**
 * The node half of Dream: starting a run, watching it, stopping it.
 *
 * A run outlives the command that started it — it spends agent calls for
 * minutes and must survive a plugin edit, which reloads the page. So the plugin
 * does not run the loop: it starts `tools/dream/loop.mjs` in its own process,
 * detached, with its output going to a log beside the run's records.
 *
 * Everything the plugin reports is read from the run's directory. That is the
 * only state a run has, so a stopped editor loses nothing and a restarted one
 * sees the same numbers.
 */
import { closeSync, openSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

/** The prefix every run directory carries. */
const RUN_PREFIX = 'dream-'

/** Where runs live, relative to the checkout. */
const RUNS = 'agent-runs'

/** Read one run's directory into the record the plugin shows. */
function readRun(checkout, name) {
  const directory = path.join(checkout, RUNS, name)
  const read = file => {
    try {
      return JSON.parse(readFileSync(path.join(directory, file), 'utf8'))
    } catch {
      return null
    }
  }
  const target = read('target.json')
  // A run is either the evolutionary loop or the Dream-RSI loop. Both write a
  // status beside their records, and the panel shows whichever is there.
  const rsi = read('rsi.json')
  const status = rsi ?? read('run.json')
  const winner = read('winner.json')
  const summary = read('rsi-summary.json')

  return {
    name,
    directory: path.relative(checkout, directory).split(path.sep).join('/'),
    loop: rsi ? 'Dream-RSI' : 'evolutionary',
    target: target?.target ?? null,
    startedAt: target?.startedAt ?? null,
    phase: status?.status ?? status?.phase ?? 'unknown',
    round: status?.round ?? 0,
    best: summary?.best
      ? { id: `grid ${summary.best.grid} cell ${summary.best.cell}`, value: summary.best.score, measures: summary.best.measures ?? null }
      : status?.best ?? null,
    pool: status?.pool ?? summary?.pool ?? null,
    policy: status?.policy ?? summary?.policies?.[summary.policies.length - 1]?.policy ?? null,
    why: status?.why ?? null,
    winner: summary?.best
      ? { id: `${summary.best.grid} ${summary.best.cell}`, value: summary.best.score, improvement: summary.improvement, patch: summary.winnerPatch ?? null }
      : winner
        ? { id: winner.id, value: winner.value, improvement: winner.improvement, patch: winner.patch ?? null }
        : null,
    live: status?.pid ? isLive(status.pid) : null
  }
}

/** Whether the process a run recorded is still working. */
function isLive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Every run in this checkout, newest first. */
export function listRuns({ checkout }) {
  const runs = path.join(checkout, RUNS)
  if (!existsSync(runs)) return []
  return readdirSync(runs)
    .filter(name => name.startsWith(RUN_PREFIX))
    // A run has target.json; a scratch folder or log that happens to be named
    // dream-* does not, and listing one shows a phantom run with no target.
    .filter(name => existsSync(path.join(runs, name, 'target.json')))
    .sort()
    .reverse()
    .map(name => readRun(checkout, name))
}

/** One run, or an answer saying no such run exists. */
export function runStatus({ checkout, directory }) {
  const name = path.basename(directory ?? '')
  if (!name.startsWith(RUN_PREFIX)) return { refused: `not a dream run directory: ${directory}` }
  const found = readRun(checkout, name)
  return found.target === null && found.phase === 'unknown' ? { refused: `no run at ${directory}` } : found
}

/**
 * What a run wrote about itself.
 *
 * Read here rather than through `context.files`, which is the project's file
 * surface: a run lives in `agent-runs/`, inside the checkout, and that surface
 * cannot reach it. So a report is read from disk and handed back as text, with
 * the paths a person needs to open the pictures.
 */
export function readReport({ checkout, directory }) {
  const name = path.basename(directory ?? '')
  const runDirectory = path.join(checkout, RUNS, name)
  if (!name.startsWith(RUN_PREFIX) || !existsSync(runDirectory)) return { refused: `no run at ${directory}` }

  const markdown = (() => {
    try {
      return readFileSync(path.join(runDirectory, 'report.md'), 'utf8')
    } catch {
      return null
    }
  })()

  const where = file => {
    const at = path.join(runDirectory, file)
    return existsSync(at) ? at : null
  }
  const paths = { report: where('report.md'), graph: where('graph.svg'), tree: where('tree.svg'), winner: where('winner.patch') }

  if (!markdown) {
    return { refused: `this run has written no report yet — it writes one after the first round`, paths }
  }
  return { run: name, paths, markdown }
}

/**
 * Start the Dream-RSI loop: explore, pool, dream, redeploy.
 *
 * Separate from `startRun` because it is a different loop, not a different
 * setting of one: the evolutionary loop improves the artifact and keeps a fixed
 * measure, and this one improves the exploration policy over recorded attempts.
 */
export async function startRsi({ checkout, target, rounds = 2, versions = 3, parallelism = 3, branches, refinements, seed, timeout, model, harness }) {
  if (!target || !String(target).trim()) return { refused: 'dream.rsi needs a target to improve' }

  const { startRun: makeRun } = await import(/* @vite-ignore */ '../../../tools/dream/setup.mjs')
  const started = await makeRun({ checkout, target, files: [] })
  const directory = started.runDirectory
  const log = path.join(directory, 'loop.log')

  const args = ['tools/dream/rsi.mjs', '--run', directory, '--target', String(target), '--rounds', String(rounds), '--versions', String(versions), '--parallelism', String(parallelism)]
  // A pinned plan is how a run keeps its cost knowable: cells are attempts, and
  // attempts are the expensive part. Seed pulls grids in from earlier runs so the
  // first dreaming phase averages over more than one history.
  if (branches !== undefined && refinements !== undefined) args.push('--branches', String(branches), '--refinements', String(refinements))
  if (seed !== undefined) args.push('--seed', String(seed))
  for (const [flag, value] of [['timeout', timeout], ['model', model], ['harness', harness]]) {
    if (value !== undefined && value !== null && value !== '') args.push(`--${flag}`, String(value))
  }

  const handle = openSync(log, 'a')
  const child = spawn(process.execPath, args, {
    cwd: checkout,
    detached: true,
    stdio: ['ignore', handle, handle],
    windowsHide: true
  })
  child.unref()
  closeSync(handle)

  writeFileSync(path.join(directory, 'rsi.json'), `${JSON.stringify({ phase: 'starting', target, pid: child.pid, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  return {
    run: path.relative(checkout, directory).split(path.sep).join('/'),
    log: path.relative(checkout, log).split(path.sep).join('/'),
    pid: child.pid
  }
}

/**
 * Start a run: make its directory, then hand the work to a detached loop.
 *
 * The directory is made here rather than by the loop so the plugin can answer
 * with the path, the log and the process id immediately — a person watching a
 * run needs somewhere to look before the first round finishes.
 */
export async function startRun({ checkout, target, files = [], rounds, candidates, timeout, model, harness }) {
  if (!target || !String(target).trim()) return { refused: 'dream.improve needs a target to improve' }

  const { startRun: makeRun } = await import(/* @vite-ignore */ '../../../tools/dream/setup.mjs')
  const started = await makeRun({ checkout, target, files })
  const directory = started.runDirectory
  const log = path.join(directory, 'loop.log')

  const args = ['tools/dream/loop.mjs', '--run', directory, '--target', String(target)]
  if (files.length) args.push('--files', files.join(','))
  for (const [flag, value] of [['rounds', rounds], ['candidates', candidates], ['timeout', timeout], ['model', model], ['harness', harness]]) {
    if (value !== undefined && value !== null && value !== '') args.push(`--${flag}`, String(value))
  }

  const handle = openSync(log, 'a')
  const child = spawn(process.execPath, args, {
    cwd: checkout,
    detached: true,
    stdio: ['ignore', handle, handle],
    windowsHide: true
  })
  child.unref()
  closeSync(handle)

  const statusFile = path.join(directory, 'run.json')
  writeFileSync(statusFile, `${JSON.stringify({ status: 'starting', target, pid: child.pid, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')

  return {
    run: path.relative(checkout, directory).split(path.sep).join('/'),
    log: path.relative(checkout, log).split(path.sep).join('/'),
    pid: child.pid
  }
}

/**
 * Ask a run to stop.
 *
 * The flag is a file rather than a signal: the loop reads it between candidates,
 * so a run stops after the work in flight rather than in the middle of a score,
 * and a run whose process has already gone is stopped by having the file there.
 */
export function stopRun({ checkout, directory }) {
  const name = path.basename(directory ?? '')
  const runDirectory = path.join(checkout, RUNS, name)
  if (!name.startsWith(RUN_PREFIX) || !existsSync(runDirectory)) {
    return { refused: `no run at ${directory}` }
  }
  const status = readRun(checkout, name)
  writeFileSync(path.join(runDirectory, 'stop'), `${new Date().toISOString()}\n`, 'utf8')
  return { stopped: name, wasDoing: status.phase, live: status.live }
}

/** Throw away a finished run's directory. A live run is refused. */
export function forgetRun({ checkout, directory }) {
  const name = path.basename(directory ?? '')
  const runDirectory = path.join(checkout, RUNS, name)
  if (!name.startsWith(RUN_PREFIX) || !existsSync(runDirectory)) return { refused: `no run at ${directory}` }
  const status = readRun(checkout, name)
  if (status.live) return { refused: `${name} is still working; stop it first` }
  rmSync(runDirectory, { recursive: true, force: true })
  return { forgotten: name }
}
