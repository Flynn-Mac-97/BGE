/**
 * The design phase: turn a target in words into a frozen, checked setup.
 *
 * A dream run is only as good as what it measures, and what to measure depends
 * on the target, so the setup is designed per run rather than shipped with the
 * plugin. An agent writes it, because deciding what "better" means for one
 * component of an engine is the same judgement as working on that component.
 *
 * The design agent writes one file and is then out of the run. Every candidate
 * afterwards is scored by that same frozen file, digested, so a candidate
 * cannot edit its own exam.
 *
 * Two checks must pass before round one, and both are run here rather than
 * trusted to the agent:
 *
 *   the target as it stands scores, so the setup is not already failing
 *   the target with one literal break does not score, so the setup can tell a
 *   working target from a broken one
 *
 * Usage: node tools/dream/setup.mjs --target "<what to improve>" [--timeout 1800] [--files a.js,b.js]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyProject, digestOf, loadSetup, scoreRun } from './scoring.mjs'
import { sessionTokens } from './measures.mjs'
import { baselineState, createWorktree, laneIsLive, removeWorktree, replaceOnce } from './worktree.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** How long the design agent may take, in seconds. */
const DEFAULT_DESIGN_TIMEOUT_SECONDS = 1800

/** A short name for a target, safe as a directory name. */
export function slugOf(target) {
  return String(target)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'target'
}

/**
 * Make the run's directory and write what it is for.
 *
 * The directory is the run's whole state: the target, the setup, one record per
 * candidate, and the winner. Nothing about a run is kept anywhere else, so
 * deleting the directory deletes the run.
 */
export async function startRun({ checkout = CHECKOUT, target, files = [], at = new Date() } = {}) {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const runDirectory = path.join(checkout, 'agent-runs', `dream-${stamp}-${slugOf(target)}`)
  await fs.mkdir(runDirectory, { recursive: true })

  const record = {
    target: String(target),
    files,
    checkout,
    startedAt: at.toISOString(),
    phases: []
  }
  await fs.writeFile(path.join(runDirectory, 'target.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return { runDirectory, record }
}

/** Refuse a run that cannot branch from HEAD, or that would race a live lane. */
export function preflight(checkout = CHECKOUT) {
  const live = laneIsLive(checkout)
  if (live) {
    return { error: `another agent holds the lane ${live.id}; finish it before starting a dream run` }
  }
  const baseline = baselineState(checkout)
  if (!baseline.clean) {
    return {
      error: 'a dream run branches from HEAD, and these tracked files are uncommitted:\n' + baseline.dirty,
      dirty: baseline.dirty
    }
  }
  return { ok: true }
}

/**
 * Ask an agent to design the setup, and read what it spent.
 *
 * The prompt names the file to write and the shape to write, and nothing else:
 * a design agent that edited the target would score its own work.
 */
export async function designSetup({ checkout = CHECKOUT, runDirectory, target, timeoutSeconds = DEFAULT_DESIGN_TIMEOUT_SECONDS, model } = {}) {
  const template = await fs.readFile(path.join(CHECKOUT, 'tools/dream/prompts/design-setup.md'), 'utf8')
  const prompt = template
    .replaceAll('{{TARGET}}', String(target))
    .replaceAll('{{RUN_DIR}}', path.relative(checkout, runDirectory).split(path.sep).join('/'))

  const args = [
    path.join(CHECKOUT, 'tools/dsh-agent.mjs'),
    '--json',
    '--cwd', checkout,
    '--timeout', String(timeoutSeconds),
    '--permission-mode', 'workspace-write'
  ]
  if (model) args.push('--model', model)
  args.push(prompt)

  const run = spawnSync(process.execPath, args, { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let envelope
  try {
    envelope = JSON.parse(String(run.stdout))
  } catch {
    return {
      ok: false,
      status: 'unreadable',
      detail: String(run.stderr || run.stdout || run.error?.message || '').trim().slice(0, 400)
    }
  }

  const tokens = envelope.sessionDir ? sessionTokens(envelope.sessionDir) : { error: 'the harness reported no session' }
  return {
    ok: envelope.ok === true,
    status: envelope.status,
    text: envelope.text ?? '',
    exitCode: envelope.exitCode,
    durationMs: envelope.durationMs,
    sessionDirectory: envelope.sessionDir ?? null,
    tokens
  }
}

/**
 * Check a designed setup against the checkout it will score.
 *
 * Returns the working record for the target as it stands, and the record for
 * the target with the control's break applied. Both are needed: a setup that
 * fails the working target cannot score anything, and one that passes the
 * broken target cannot tell the difference between an improvement and a
 * regression.
 */
export async function verifySetup({ checkout = CHECKOUT, runDirectory } = {}) {
  const loaded = await loadSetup(path.join(runDirectory, 'setup.mjs'))
  if (loaded.error) return { ok: false, reason: loaded.error }
  const { setup } = loaded

  const project = await copyProject(path.resolve(checkout, setup.project))
  let working
  try {
    working = await scoreRun({ checkout, project, tasks: setup.tasks, weights: setup.weights ?? {}, name: setup.name })
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
  if (working.verdict !== 'scored') {
    return { ok: false, reason: `the setup does not pass on the target as it stands: ${working.reason}`, working }
  }

  const control = setup.control
  if (!control?.file || !control?.find || control?.replace === undefined) {
    return { ok: false, reason: 'the setup names no control: { file, find, replace, why }', working }
  }

  const name = `control-${path.basename(runDirectory)}`
  const made = createWorktree(checkout, name)
  if (made.error) return { ok: false, reason: made.error, working }

  let broken
  try {
    const edited = replaceOnce(path.join(made.workspace, control.file), control.find, control.replace)
    if (edited.error) {
      return { ok: false, reason: `the control cannot be applied: ${edited.error}`, working }
    }
    const controlProject = await copyProject(path.resolve(made.workspace, setup.project))
    try {
      broken = await scoreRun({
        checkout: made.workspace,
        project: controlProject,
        tasks: setup.tasks,
        weights: setup.weights ?? {},
        name: setup.name
      })
    } finally {
      await fs.rm(controlProject, { recursive: true, force: true })
    }
  } finally {
    removeWorktree(checkout, name)
  }

  if (broken.verdict === 'scored') {
    return {
      ok: false,
      reason: `the setup passes the target with the control's break applied, so it cannot detect a regression: ${control.why ?? 'no reason given'}`,
      working,
      control: broken
    }
  }

  return { ok: true, working, control: broken }
}

/** Write the checked setup into the run's record. */
export async function recordSetupCheck(runDirectory, check, setupPath) {
  const { setup } = await loadSetup(setupPath)
  const record = {
    name: setup.name,
    project: setup.project,
    objective: setup.objective ?? null,
    weights: setup.weights ?? {},
    tasks: setup.tasks.map(task => ({ id: task.id, question: task.question, holdout: task.holdout === true })),
    digest: digestOf({ name: setup.name, tasks: setup.tasks, weights: setup.weights ?? {} }),
    working: check.working ?? null,
    control: check.control ?? null
  }
  await fs.writeFile(path.join(runDirectory, 'setup-check.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

// Run directly: design a setup from a target, then check it.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argument = name => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : undefined
  }

  const target = argument('target')
  if (!target) {
    process.stderr.write('usage: node tools/dream/setup.mjs --target "<what to improve>" [--timeout 1800]\n')
    process.exit(2)
  }

  const ready = preflight(CHECKOUT)
  if (ready.error) {
    process.stderr.write(`${ready.error}\n`)
    process.exit(2)
  }

  const files = (argument('files') ?? '').split(',').map(one => one.trim()).filter(Boolean)
  const { runDirectory } = await startRun({ target, files })
  process.stdout.write(`run ${runDirectory}\n`)

  const designed = await designSetup({
    runDirectory,
    target,
    timeoutSeconds: Number(argument('timeout') ?? DEFAULT_DESIGN_TIMEOUT_SECONDS),
    model: argument('model')
  })
  await fs.writeFile(path.join(runDirectory, 'design.json'), `${JSON.stringify(designed, null, 2)}\n`, 'utf8')
  if (!designed.ok) {
    process.stderr.write(`the design agent did not finish: ${designed.status}\n`)
    process.exit(1)
  }

  const check = await verifySetup({ runDirectory })
  await fs.writeFile(path.join(runDirectory, 'setup-check.raw.json'), `${JSON.stringify(check, null, 2)}\n`, 'utf8')
  if (!check.ok) {
    process.stderr.write(`${check.reason}\n`)
    process.exit(1)
  }

  const record = await recordSetupCheck(runDirectory, check, path.join(runDirectory, 'setup.mjs'))
  process.stdout.write(`${JSON.stringify({ runDirectory, setup: record.name, digest: record.digest, tasks: record.tasks.length, value: record.working.value }, null, 2)}\n`)
}

export { CHECKOUT }
