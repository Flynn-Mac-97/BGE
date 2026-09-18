/**
 * The dream loop: design a setup for a target, then try candidates against it.
 *
 * One run is one target. It designs what to measure, checks that the measurement
 * can tell a working target from a broken one, scores the target as it stands,
 * and then tries candidates that must beat it. A candidate that breaks a task
 * scores nothing, so the winner is never a version that traded correctness for
 * cost.
 *
 * The loop stops when the rounds run out, when `patience` rounds bring no
 * improvement, or when the plugin is asked to stop. Everything it decided is in
 * the run's directory: the target, the setup, one record per candidate, the
 * winner's patch, and a status file the plugin reads.
 *
 * Usage: node tools/dream/loop.mjs --target "<what to improve>" [--rounds 3] [--candidates 1] [--patience 2]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSetup } from './scoring.mjs'
import { runCandidate } from './candidate.mjs'
import { renderReport } from './report.mjs'
import { CHECKOUT, designSetup, preflight, recordSetupCheck, startRun, verifySetup } from './setup.mjs'

/** Rounds of candidates after the setup is frozen. */
const DEFAULT_ROUNDS = 3

/** Candidates tried in one round. Each is one agent working in its own worktree. */
const DEFAULT_CANDIDATES = 1

/** Rounds without an improvement before the run stops. */
const DEFAULT_PATIENCE = 2

/** The run's status file, which the plugin reads instead of guessing from logs. */
export const STATUS_FILE = 'run.json'

/** Write the status a watching plugin reads. */
async function writeStatus(runDirectory, status) {
  const file = path.join(runDirectory, STATUS_FILE)
  const before = await fs.readFile(file, 'utf8').catch(() => null)
  const record = { ...(before ? JSON.parse(before) : {}), ...status, at: new Date().toISOString() }
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

/** Whether a stop has been asked for: the plugin writes this file. */
async function stopRequested(runDirectory) {
  return fs.access(path.join(runDirectory, 'stop')).then(() => true, () => false)
}

/** One candidate's record, written where a person can read it next to its patch. */
async function writeCandidateRecord(runDirectory, round, record) {
  const directory = path.join(runDirectory, 'rounds', `r${String(round).padStart(4, '0')}`)
  await fs.mkdir(directory, { recursive: true })
  const stem = path.join(directory, `c${record.attempt}`)
  const { patch, ...rest } = record
  await fs.writeFile(`${stem}.json`, `${JSON.stringify(rest, null, 2)}\n`, 'utf8')
  if (patch) await fs.writeFile(`${stem}.patch`, patch, 'utf8')
  return rest
}

/**
 * Run one target to a winner.
 *
 * Resuming is the same call with the run's directory: a run whose setup is
 * already frozen does not design another one, because a second setup would make
 * every earlier score incomparable.
 */
export async function dreamRun({
  checkout = CHECKOUT,
  target,
  runDirectory = null,
  rounds = DEFAULT_ROUNDS,
  candidates = DEFAULT_CANDIDATES,
  patience = DEFAULT_PATIENCE,
  timeoutSeconds,
  model
} = {}) {
  const ready = preflight(checkout)
  if (ready.error) return { error: ready.error }

  let directory = runDirectory
  if (!directory) {
    const started = await startRun({ checkout, target })
    directory = started.runDirectory
  }

  await writeStatus(directory, { status: 'designing', target, round: 0, candidates: 0 })

  const setupPath = path.join(directory, 'setup.mjs')
  const designed = await fs.access(setupPath).then(() => true, () => false)

  if (!designed) {
    const design = await designSetup({ checkout, runDirectory: directory, target, timeoutSeconds, model })
    await fs.writeFile(path.join(directory, 'design.json'), `${JSON.stringify(design, null, 2)}\n`, 'utf8')
    if (!design.ok) {
      await writeStatus(directory, { status: 'setup-failed', why: `the design agent did not finish: ${design.status}` })
      return { runDirectory: directory, error: `the design agent did not finish: ${design.status}`, design }
    }

    const check = await verifySetup({ checkout, runDirectory: directory })
    await fs.writeFile(path.join(directory, 'setup-check.raw.json'), `${JSON.stringify(check, null, 2)}\n`, 'utf8')
    if (!check.ok) {
      await writeStatus(directory, { status: 'setup-failed', why: check.reason })
      return { runDirectory: directory, error: check.reason, design, check }
    }
    await recordSetupCheck(directory, check, setupPath)
  }

  const loaded = await loadSetup(setupPath)
  if (loaded.error) {
    await writeStatus(directory, { status: 'setup-failed', why: loaded.error })
    return { runDirectory: directory, error: loaded.error }
  }
  const { setup } = loaded
  await renderReport(directory)

  const checkRecord = JSON.parse(await fs.readFile(path.join(directory, 'setup-check.json'), 'utf8'))
  // The target text and the file list come from disk on a resume, so a run
  // resumed by directory alone knows as much as the process that started it.
  const targetRecord = JSON.parse(await fs.readFile(path.join(directory, 'target.json'), 'utf8'))
  const targetText = target ?? targetRecord.target
  const suiteHash = checkRecord.digest
  let incumbent = {
    id: 'baseline',
    value: checkRecord.working.value,
    measures: checkRecord.working.totals?.measures ?? null,
    pass: true,
    depth: 0,
    patch: null
  }
  const history = []
  const id = path.basename(directory).replace(/^dream-/, '')

  let withoutImprovement = 0
  for (let round = 1; round <= rounds; round++) {
    if (await stopRequested(directory)) {
      await writeStatus(directory, { status: 'stopped', round, best: incumbent })
      break
    }

    await writeStatus(directory, { status: 'running', round, best: incumbent, candidates: history.length })

    let improved = false
    for (let attempt = 1; attempt <= candidates; attempt++) {
      const record = await runCandidate({
        checkout,
        runDirectory: directory,
        setup,
        attempt,
        id,
        target: targetText,
        files: targetRecord.files ?? [],
        history,
        parent: incumbent,
        depth: incumbent.depth,
        timeoutSeconds,
        model
      })
      // The frozen digest is what makes a candidate's own edits to the checks
      // visible: a mismatch is refused rather than compared.
      if (record.verdict === 'scored' && record.value > incumbent.value) {
        record.best = true
        incumbent = {
          id: record.id,
          value: record.value,
          measures: record.measures,
          pass: true,
          depth: record.depth,
          verifiedAgainst: suiteHash,
          patch: null
        }
        improved = true
      }
      const kept = await writeCandidateRecord(directory, round, record)
      if (record.best) incumbent.patch = path.join(directory, 'rounds', `r${String(round).padStart(4, '0')}`, `c${record.attempt}.patch`)
      history.push({ id: kept.id, value: kept.value, pass: kept.verdict === 'scored', reason: kept.reason })
    }

    await fs.writeFile(
      path.join(directory, 'rounds', `r${String(round).padStart(4, '0')}`, 'round.json'),
      `${JSON.stringify({ round, improved, best: { id: incumbent.id, value: incumbent.value, depth: incumbent.depth } }, null, 2)}\n`,
      'utf8'
    )
    // Rewritten every round, so the document and the pictures follow the run
    // while it is still going rather than being a summary written at the end.
    await renderReport(directory)
    await writeStatus(directory, { status: 'running', round, best: incumbent, candidates: history.length })

    withoutImprovement = improved ? 0 : withoutImprovement + 1
    if (withoutImprovement >= patience) {
      await writeStatus(directory, { status: 'settled', round, best: incumbent, why: `${patience} rounds brought no improvement` })
      break
    }
  }

  const best = history.filter(entry => entry.id === incumbent.id)[0] ?? null
  const winner = {
    id: incumbent.id,
    value: incumbent.value,
    measures: incumbent.measures,
    baseline: { value: checkRecord.working.value, measures: checkRecord.working.totals?.measures ?? null },
    improvement: Number((incumbent.value - checkRecord.working.value).toFixed(6)),
    best,
    landed: false
  }

  if (best) {
    const roundsDirectory = await fs.readdir(path.join(directory, 'rounds'))
    for (const roundName of roundsDirectory.sort().reverse()) {
      const files = await fs.readdir(path.join(directory, 'rounds', roundName))
      const patchName = files.find(file => file === `${best.id}.patch`)
      if (patchName) {
        await fs.copyFile(path.join(directory, 'rounds', roundName, patchName), path.join(directory, 'winner.patch'))
        winner.patch = 'winner.patch'
        break
      }
    }
  }

  await fs.writeFile(path.join(directory, 'winner.json'), `${JSON.stringify(winner, null, 2)}\n`, 'utf8')
  await writeStatus(directory, { status: 'done', best: incumbent })
  await renderReport(directory)
  return {
    runDirectory: directory,
    setup: setup.name,
    winner,
    history,
    baseline: { value: checkRecord.working.value, measures: checkRecord.working.totals?.measures ?? null }
  }
}

// Run directly: one target, to a winner.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argument = name => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : undefined
  }

  const target = argument('target')
  const runDirectory = argument('run')
  if (!target && !runDirectory) {
    process.stderr.write('usage: node tools/dream/loop.mjs --target "<what to improve>" [--rounds 3] [--candidates 1]\n')
    process.exit(2)
  }

  const result = await dreamRun({
    target,
    runDirectory: runDirectory ? path.resolve(runDirectory) : null,
    rounds: Number(argument('rounds') ?? DEFAULT_ROUNDS),
    candidates: Number(argument('candidates') ?? DEFAULT_CANDIDATES),
    patience: Number(argument('patience') ?? DEFAULT_PATIENCE),
    timeoutSeconds: argument('timeout') ? Number(argument('timeout')) : undefined,
    model: argument('model')
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.error ? 1 : 0
}

export { DEFAULT_ROUNDS, DEFAULT_CANDIDATES, DEFAULT_PATIENCE }
