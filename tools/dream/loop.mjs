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
 * winner's patch, a status file the plugin reads, and `history.json` holding the
 * run's whole state in one file.
 *
 * A run is resumed by naming its directory. It continues after its last recorded
 * round, from the best version those rounds produced, so ten rounds can be run
 * as ten, or as three rounds then seven, without a record being overwritten.
 *
 * Usage: node tools/dream/loop.mjs --target "<what to improve>" [--rounds 3] [--candidates 1] [--patience 2]
 *        node tools/dream/loop.mjs --run agent-runs/dream-... --rounds 7
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSetup } from './scoring.mjs'
import { runCandidate } from './candidate.mjs'
import { costBands, sumCosts } from './pricing.mjs'
import { renderReport } from './report.mjs'
import { CHECKOUT, designSetup, preflight, recordSetupCheck, startRun, verifySetup } from './setup.mjs'

/** Rounds of candidates after the setup is frozen. On a resume, this many more. */
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
  // The loop's own process id is written with every status: a run started by
  // hand has no other way to say whether it is still working, and a watcher
  // that cannot tell a slow round from a dead one is not watching anything.
  const record = { ...(before ? JSON.parse(before) : {}), ...status, pid: process.pid, at: new Date().toISOString() }
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

/** Whether a stop has been asked for: the plugin writes this file. */
async function stopRequested(runDirectory) {
  return fs.access(path.join(runDirectory, 'stop')).then(() => true, () => false)
}

/**
 * One candidate's record, written where a person can read it next to its patch.
 *
 * Both files are named after the candidate's id, so a record and its patch are
 * found by the same name the lineage uses. Naming the patch after the attempt
 * number instead is what once left a run with no `winner.patch` at all: the
 * winner was named by id and copied by a name no file had.
 */
export async function writeCandidateRecord(runDirectory, round, record) {
  const directory = path.join(runDirectory, 'rounds', `r${String(round).padStart(4, '0')}`)
  await fs.mkdir(directory, { recursive: true })
  const { patch, ...rest } = record
  await fs.writeFile(path.join(directory, `${record.id}.json`), `${JSON.stringify(rest, null, 2)}\n`, 'utf8')
  if (patch) await fs.writeFile(path.join(directory, `${record.id}.patch`), patch, 'utf8')
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
  model,
  harness
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
    const design = await designSetup({ checkout, runDirectory: directory, target, timeoutSeconds, model, harness })
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

  // What the run has cost so far, in RMB. The design phase is read from its own
  // record, so a resumed run still counts what it spent before the resume.
  const designRecord = JSON.parse(await fs.readFile(path.join(directory, 'design.json'), 'utf8').catch(() => 'null'))
  const spent = designRecord?.tokens ? [costBands(designRecord.tokens)] : []

  // A resume picks up where the records stop: the round after the last one
  // written, the best version those rounds produced, and the rounds that have
  // already brought nothing.
  const prior = await recordedState(directory)
  const baseline = {
    id: 'baseline',
    value: checkRecord.working.value,
    measures: checkRecord.working.totals?.measures ?? null,
    pass: true,
    depth: 0,
    patch: null
  }
  let incumbent = prior.best ?? baseline
  const history = [...prior.attempts]
  const roundLog = [...prior.rounds]
  const id = path.basename(directory).replace(/^dream-/, '')

  await writeHistory(directory, {
    run: path.basename(directory),
    target: targetText,
    setup: { name: setup.name, digest: suiteHash },
    baseline: { value: baseline.value, measures: baseline.measures },
    best: { id: incumbent.id, value: incumbent.value, measures: incumbent.measures },
    rounds: roundLog,
    attempts: history,
    cost: sumCosts(spent),
    resumedFrom: prior.lastRound || null
  })

  let withoutImprovement = prior.withoutImprovement
  const firstRound = prior.lastRound + 1
  for (let round = firstRound; round < firstRound + rounds; round++) {
    if (await stopRequested(directory)) {
      await writeStatus(directory, { status: 'stopped', round, best: incumbent })
      break
    }

    await writeStatus(directory, { status: 'running', round, best: incumbent, candidates: history.length, cost: sumCosts(spent) })

    let improved = false
    for (let attempt = 1; attempt <= candidates; attempt++) {
      const record = await runCandidate({
        checkout,
        runDirectory: directory,
        setup,
        attempt,
        round,
        id,
        target: targetText,
        files: targetRecord.files ?? [],
        history,
        parent: incumbent,
        depth: incumbent.depth,
        timeoutSeconds,
        model,
        harness
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
      if (record.cost) spent.push(record.cost)
      if (record.best) incumbent.patch = path.join(directory, 'rounds', `r${String(round).padStart(4, '0')}`, `${record.id}.patch`)
      history.push({ id: kept.id, value: kept.value, pass: kept.verdict === 'scored', reason: kept.reason })
    }

    await fs.writeFile(
      path.join(directory, 'rounds', `r${String(round).padStart(4, '0')}`, 'round.json'),
      `${JSON.stringify({ round, improved, best: { id: incumbent.id, value: incumbent.value, depth: incumbent.depth } }, null, 2)}\n`,
      'utf8'
    )
    roundLog.push({ round, improved, best: { id: incumbent.id, value: incumbent.value, depth: incumbent.depth } })
    await writeHistory(directory, {
      run: path.basename(directory),
      target: targetText,
      setup: { name: setup.name, digest: suiteHash },
      baseline: { value: baseline.value, measures: baseline.measures },
      best: { id: incumbent.id, value: incumbent.value, measures: incumbent.measures },
      rounds: roundLog,
      attempts: history,
      cost: sumCosts(spent)
    })
    // Rewritten every round, so the document and the pictures follow the run
    // while it is still going rather than being a summary written at the end.
    await renderReport(directory)
    await writeStatus(directory, { status: 'running', round, best: incumbent, candidates: history.length, cost: sumCosts(spent) })

    withoutImprovement = improved ? 0 : withoutImprovement + 1
    if (withoutImprovement >= patience) {
      await writeStatus(directory, { status: 'settled', round, best: incumbent, why: `${patience} rounds brought no improvement` })
      break
    }
  }

  // The winner's own history line, matched on value as well as id: a run that
  // reused an id across rounds used to report the earlier candidate here.
  const best = history.find(entry => entry.id === incumbent.id && entry.value === incumbent.value) ?? null
  const winner = {
    id: incumbent.id,
    value: incumbent.value,
    measures: incumbent.measures,
    baseline: { value: checkRecord.working.value, measures: checkRecord.working.totals?.measures ?? null },
    improvement: Number((incumbent.value - checkRecord.working.value).toFixed(6)),
    cost: sumCosts(spent),
    best,
    landed: false
  }

  if (best) {
    const roundsDirectory = await fs.readdir(path.join(directory, 'rounds'))
    let found = null
    for (const roundName of roundsDirectory.sort().reverse()) {
      const files = await fs.readdir(path.join(directory, 'rounds', roundName))
      if (files.includes(`${best.id}.patch`)) {
        found = roundName
        break
      }
    }
    if (found) {
      await fs.copyFile(path.join(directory, 'rounds', found, `${best.id}.patch`), path.join(directory, 'winner.patch'))
      winner.patch = 'winner.patch'
    } else {
      // Said rather than left out: a winner with no patch is a run that cannot
      // be landed, and a silent absence reads as "nothing to apply".
      winner.patchMissing = `no ${best.id}.patch was written among the rounds`
    }
  }

  await fs.writeFile(path.join(directory, 'winner.json'), `${JSON.stringify(winner, null, 2)}\n`, 'utf8')
  await writeHistory(directory, {
    run: path.basename(directory),
    target: targetText,
    setup: { name: setup.name, digest: suiteHash },
    baseline: { value: baseline.value, measures: baseline.measures },
    best: { id: incumbent.id, value: incumbent.value, measures: incumbent.measures },
    rounds: roundLog,
    attempts: history,
    winner: { id: winner.id, value: winner.value, improvement: winner.improvement, patch: winner.patch ?? null },
    cost: sumCosts(spent)
  })
  await writeStatus(directory, { status: 'done', best: incumbent, cost: sumCosts(spent) })
  await renderReport(directory)
  return {
    runDirectory: directory,
    setup: setup.name,
    winner,
    history,
    baseline: { value: checkRecord.working.value, measures: checkRecord.working.totals?.measures ?? null }
  }
}

/**
 * What a run has already done, read from its own records.
 *
 * A run is resumed by naming its directory, so everything the loop needs must
 * come off disk: how far it got, what the best version is, the patch that
 * version consists of, and how many rounds running have brought nothing. Without
 * this a resume restarts at round one and overwrites the records it already
 * wrote, and a best version found before the resume would be forgotten and could
 * be replaced by a worse one.
 */
export async function recordedState(runDirectory) {
  const roundsDirectory = path.join(runDirectory, 'rounds')
  const names = (await fs.readdir(roundsDirectory).catch(() => [])).sort()

  const attempts = []
  const rounds = []
  let best = null
  let lastRound = 0
  let withoutImprovement = 0

  for (const name of names) {
    const directory = path.join(roundsDirectory, name)
    const round = Number(name.replace(/^r/, ''))
    if (!Number.isFinite(round)) continue
    lastRound = Math.max(lastRound, round)

    const files = await fs.readdir(directory).catch(() => [])
    for (const file of files.filter(entry => entry.endsWith('.json') && entry !== 'round.json').sort()) {
      try {
        const record = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'))
        attempts.push({ id: record.id, value: record.value, pass: record.verdict === 'scored', reason: record.reason ?? null })
        if (record.best === true) {
          const patch = path.join(directory, `${record.id}.patch`)
          best = {
            id: record.id,
            value: record.value,
            measures: record.measures ?? null,
            pass: true,
            depth: record.depth ?? 1,
            patch: (await fs.access(patch).then(() => true, () => false)) ? patch : null
          }
        }
      } catch { /* a candidate still being written */ }
    }

    const record = JSON.parse(await fs.readFile(path.join(directory, 'round.json'), 'utf8').catch(() => 'null'))
    if (record) {
      rounds.push({ round, improved: record.improved === true, best: record.best ?? null })
      withoutImprovement = record.improved ? 0 : withoutImprovement + 1
    }
  }

  return { lastRound, attempts, rounds, best, withoutImprovement }
}

/**
 * The run's whole state in one file.
 *
 * Written after every round beside the records it summarises, so an agent or a
 * person can read what a run has done without walking the round directories, and
 * so a run interrupted mid-round still says what it knew.
 */
async function writeHistory(runDirectory, state) {
  const file = path.join(runDirectory, 'history.json')
  await fs.writeFile(file, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  return file
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
    model: argument('model'),
    harness: argument('harness')
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.error ? 1 : 0
}

export { DEFAULT_ROUNDS, DEFAULT_CANDIDATES, DEFAULT_PATIENCE }
