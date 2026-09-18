/**
 * Score one candidate against one frozen setup.
 *
 * A setup is what a dream run decided to measure for its target: a list of
 * tasks, the checks that say whether each task was done, and what each measure
 * costs in score. Nothing here knows what the target is.
 *
 * Two rules make a self-designed score mean something.
 *
 * The setup is digested and compared before any task runs, so a candidate that
 * edited the tasks, the checks or the weights is refused rather than rewarded.
 *
 * Every task must pass. Optimising cost is only meaningful among candidates
 * that still do the work, and a candidate that breaks the target is cheap by
 * definition. A task failure refuses the candidate outright.
 *
 * Wall time is a measure like any other and is left out of the default weights:
 * it moves with the machine, and a selection decided by a noisy number is a
 * selection nobody can reproduce.
 *
 * Usage: node tools/dream/scoring.mjs --setup tools/dream/examples/agent-connection.mjs [--checkout <dir>] [--hash <digest>]
 */
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { engineProcess, packetCharacters, sessionTokens } from './measures.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** The helpers a task is run with. A setup names these rather than importing them. */
export const HELPERS = { engineProcess, packetCharacters, sessionTokens }

/** One text for any value, so a digest covers functions and weights as well as data. */
function stableText(value) {
  if (typeof value === 'function') return String(value)
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${key}:${stableText(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** What a setup is, as one number. The loop freezes this before the first candidate. */
export function digestOf(value) {
  const text = stableText(value)
  let hash = 0
  for (let at = 0; at < text.length; at++) hash = (Math.imul(hash, 31) + text.charCodeAt(at)) | 0
  return String(hash)
}

/**
 * A writable copy of a project, without its built index.
 *
 * A task may write to the project, and a candidate's tasks must not see the
 * previous candidate's writes.
 */
export async function copyProject(source, tag = `dream-project-${process.pid}-`) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), tag))
  await fs.cp(source, directory, { recursive: true, filter: from => !from.includes('.engine') })
  return directory
}

/**
 * Run every task of one setup against one candidate checkout.
 *
 * `suiteHash` is the digest recorded when the run froze its setup. A mismatch
 * stops before the first task: a score against different tasks cannot be
 * compared with the round before it.
 */
export async function scoreRun({ checkout = CHECKOUT, project, tasks, weights = {}, name = null, id = null, suiteHash } = {}) {
  const digest = digestOf({ name, tasks, weights })
  const record = {
    id,
    checkout,
    suite: { name, hash: digest, tasks: tasks.length },
    weights,
    tasks: [],
    totals: { tasks: tasks.length, passed: 0, measures: {} },
    value: 0,
    verdict: 'refused',
    reason: null
  }

  if (suiteHash !== undefined && suiteHash !== digest) {
    record.reason = `the setup changed: this run froze ${suiteHash}, this checkout has ${digest}`
    return record
  }

  for (const task of tasks) {
    const started = Date.now()
    let result
    try {
      result = await task.run({ checkout, project, helpers: HELPERS })
    } catch (error) {
      result = { pass: false, problem: `threw — ${error?.message || error}` }
    }
    const measures = result?.measures ?? {}
    const taskRecord = {
      id: task.id,
      pass: result?.pass === true,
      problem: result?.pass === true ? null : String(result?.problem ?? 'the task reported no verdict'),
      measures: { ...measures, milliseconds: measures.milliseconds ?? Date.now() - started }
    }
    record.tasks.push(taskRecord)
  }

  for (const task of record.tasks) {
    record.totals.passed += task.pass ? 1 : 0
    for (const [measure, amount] of Object.entries(task.measures)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
      record.totals.measures[measure] = (record.totals.measures[measure] ?? 0) + amount
    }
  }

  const failed = record.tasks.filter(task => !task.pass)
  if (failed.length) {
    record.reason = failed.map(task => `${task.id}: ${task.problem}`).join('; ')
    return record
  }

  let cost = 0
  for (const [measure, weight] of Object.entries(weights)) {
    cost += weight * (record.totals.measures[measure] ?? 0)
  }
  record.value = Number((1 - cost).toFixed(6))
  record.verdict = 'scored'
  return record
}

/**
 * A setup module, loaded and checked for the shape a run needs.
 *
 * Refused rather than repaired: a setup missing a task check would score every
 * candidate the same, and a run that cannot tell two candidates apart is worse
 * than no run, because it reports a winner.
 */
export async function loadSetup(setupPath) {
  const module = await import(pathToFileURL(setupPath).href)
  const setup = module.default
  if (!setup || typeof setup !== 'object') return { error: `${setupPath} has no default export` }
  if (!Array.isArray(setup.tasks) || setup.tasks.length === 0) return { error: `${setupPath} names no tasks` }
  for (const task of setup.tasks) {
    if (typeof task.id !== 'string' || task.id === '') return { error: `${setupPath} has a task with no id` }
    if (typeof task.run !== 'function') return { error: `${setupPath} task ${task.id} has no run` }
  }
  if (!setup.project || typeof setup.project !== 'string') return { error: `${setupPath} names no project` }
  return { setup, path: setupPath }
}

// Run directly: load a setup, score the checkout once, print the record.
//
// Flags rather than one JSON argument: a shell strips the quotes out of a JSON
// argument on Windows, and the engine's own CLI repairs that for itself. This
// entry point has no repair, so it takes a form no shell rewrites.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argument = name => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : undefined
  }

  const setupPath = argument('setup') ?? path.join(CHECKOUT, 'tools/dream/examples/agent-connection.mjs')
  const loaded = await loadSetup(path.resolve(CHECKOUT, setupPath))
  if (loaded.error) {
    process.stderr.write(`${loaded.error}\n`)
    process.exit(2)
  }

  const { setup } = loaded
  const checkout = argument('checkout') ? path.resolve(argument('checkout')) : CHECKOUT
  // The project is resolved against the checkout being scored, not against the
  // tools, so a candidate that runs the scorer inside its own worktree opens
  // its own copy of the project.
  const project = await copyProject(path.resolve(checkout, setup.project))
  let record
  try {
    record = await scoreRun({
      checkout,
      project,
      tasks: setup.tasks,
      weights: setup.weights ?? {},
      name: setup.name,
      suiteHash: argument('hash')
    })
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`)
  process.exitCode = record.verdict === 'scored' ? 0 : 1
}

export { CHECKOUT }
