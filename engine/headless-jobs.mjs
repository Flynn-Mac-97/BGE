/**
 * Headless jobs: one engine command run by `node bin/engine.mjs --headless`,
 * started for a page that cannot start a program itself. The supervisor starts
 * and lists the process (a `headless-session`), so it is recorded and can be
 * stopped like any other engine process.
 *
 * A job is its supervisor id. While the process is listed it is running; after
 * it ends, its answer is the last JSON line of its output (the headless run
 * prints one), and a job whose output ends in anything else failed.
 *
 * Node only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { askSupervisor, instanceLogFile } from './supervisor.mjs'

// A job such as a Kimodo take takes minutes; the start only waits for the
// process to exist.
const START_TIMEOUT_MILLISECONDS = 30_000
const LIST_TIMEOUT_MILLISECONDS = 10_000
const FAILURE_LINES = 12

/** Start `command` with `options` on `project`. Answers `{ job }`, the supervisor id. */
export async function startHeadlessJob({ checkout, project, command, options = {} }) {
  if (!/^[a-z][\w.-]*$/i.test(String(command ?? ''))) throw new Error('name the engine command to run')
  const args = [
    path.join(checkout, 'bin', 'engine.mjs'),
    '--headless',
    '--project',
    project,
    'run',
    command,
    JSON.stringify(options)
  ]
  const entry = await askSupervisor(
    checkout,
    'POST',
    '/instances',
    { kind: 'headless-session', command: process.execPath, args, project },
    START_TIMEOUT_MILLISECONDS
  )
  return { job: entry.id }
}

/**
 * A job's state: `{ state: 'running' }`, `{ state: 'done', answer }`, or
 * `{ state: 'failed', error }` with the end of its output.
 */
export async function headlessJobState(checkout, job) {
  const { instances } = await askSupervisor(checkout, 'GET', '/instances', null, LIST_TIMEOUT_MILLISECONDS)
  if (instances.some(entry => entry.id === job && entry.state !== 'gone')) return { state: 'running' }
  const lines = readLog(instanceLogFile(checkout, job))
    .split(/\r?\n/)
    .filter(line => line.trim())
  const answer = lines.findLast(line => line.startsWith('{'))
  const parsed = answer ? parseAnswer(answer) : null
  if (parsed && !parsed.error) return { state: 'done', answer: parsed }
  return {
    state: 'failed',
    error: parsed?.error ?? (lines.slice(-FAILURE_LINES).join('\n') || `job ${job} left no output`)
  }
}

/** A log's text; empty when there is none. */
function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8')
  } catch {
    return ''
  }
}

/** One JSON line, or null when it is not JSON. */
function parseAnswer(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
