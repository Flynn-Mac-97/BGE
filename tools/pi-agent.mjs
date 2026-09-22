#!/usr/bin/env node
/**
 * pi-agent — one-shot pi coding agent, printing the same envelope as dsh-agent.
 *
 * Dream spawns a harness and reads one JSON object from its stdout. This file
 * gives pi that interface, so a run can be played on either harness without the
 * caller knowing which. The fields are dsh-agent's, and a change to one must be
 * made in both.
 *
 * Usage:
 *   pi-agent "task"                           run; print final text; exit 0/1
 *   pi-agent --json "task"                    run; print a JSON envelope
 *   pi-agent --cwd <dir> "task"               run with that working directory
 *   pi-agent --timeout <seconds> "task"       abort after N seconds (exit 124)
 *   pi-agent --permission-mode <mode> "task"  read-only | workspace-write | danger-full-access
 *   pi-agent --model <name> "task"            override the model
 *   pi-agent --session-dir <dir> "task"       where the transcript is written
 *   pi-agent --help
 *
 * Exit codes: 0 completed, 1 agent error, 2 usage error, 124 timed out.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Where pi's bundled CLI is installed.
 *
 * The npm shim is spawned directly on Windows only as a last resort: `pi` gives
 * ENOENT and `pi.cmd` gives EINVAL, so the bundle is run under this node.
 */
function resolvePiBundle() {
  const prefixes = [
    process.env.PI_PREFIX,
    join(homedir(), 'AppData', 'Roaming', 'npm'),
    '/usr/local',
    '/usr'
  ].filter(Boolean)
  for (const prefix of prefixes) {
    const bundle = join(prefix, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')
    if (existsSync(bundle)) return bundle
  }
  return null
}

/**
 * The environment pi runs in, with any proxy removed.
 *
 * DeepSeek is reached directly from this machine, so a proxy only adds a hop.
 * Set PI_USE_PROXY=1 to keep the caller's proxy variables.
 */
function childEnvironment() {
  const environment = { ...process.env }
  if (process.env.PI_USE_PROXY === '1') return environment
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete environment[name]
  }
  return environment
}

/** What pi is allowed to touch, per permission mode. dsh's modes, pi's tools. */
function toolArguments(permissionMode) {
  if (permissionMode === 'read-only') return ['--tools', 'read']
  return []
}

function usage(stream) {
  stream.write('usage: pi-agent [--json] [--cwd <dir>] [--timeout <seconds>] [--permission-mode <mode>] [--model <name>] [--session-dir <dir>] [--task-file <path>] "task"\n')
}

function usageError(message) {
  process.stderr.write(`${message}\n`)
  usage(process.stderr)
  process.exit(2)
}

function parseArguments(argv) {
  const options = {
    json: false,
    cwd: process.cwd(),
    timeoutSeconds: 0,
    permissionMode: 'workspace-write',
    model: undefined,
    sessionDir: undefined,
    taskFile: undefined,
    task: []
  }
  let help = false
  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at]
    if (argument === '--help' || argument === '-h') help = true
    else if (argument === '--json') options.json = true
    else if (argument === '--cwd') options.cwd = argv[++at]
    else if (argument === '--timeout') options.timeoutSeconds = Number(argv[++at])
    else if (argument === '--permission-mode') options.permissionMode = argv[++at]
    else if (argument === '--model') options.model = argv[++at]
    else if (argument === '--session-dir') options.sessionDir = argv[++at]
    else if (argument === '--task-file') options.taskFile = argv[++at]
    else options.task.push(argument)
  }
  return { options, help }
}

async function main() {
  const { options, help } = parseArguments(process.argv.slice(2))
  if (help) {
    usage(process.stdout)
    process.exit(0)
  }
  // Windows caps a command line at about 32767 characters, so a long task is
  // handed over as a file instead of an argument.
  const task = options.taskFile ? readFileSync(options.taskFile, 'utf8') : options.task.join(' ')
  if (task.trim() === '') usageError('error: a task is required, for example: pi-agent "run the tests"')
  if (!existsSync(options.cwd)) usageError(`error: --cwd directory does not exist: ${options.cwd}`)

  const bundle = resolvePiBundle()
  if (!bundle) usageError('error: cannot locate pi-coding-agent; set PI_PREFIX to the npm prefix that holds it')

  // The session directory is chosen here rather than left to pi, because the
  // envelope has to name the transcript the cost is later read from.
  const sessionDir = options.sessionDir ?? mkdtempSync(join(tmpdir(), 'pi-agent-'))
  mkdirSync(sessionDir, { recursive: true })

  const startedAtMs = Date.now()
  const args = ['-p', '--approve', '--session-dir', sessionDir, ...toolArguments(options.permissionMode)]
  if (options.model !== undefined) args.push('--model', options.model)

  // The task is written to pi's stdin rather than passed as an argument, because
  // Windows caps a command line at about 32767 characters and a task can be
  // longer than that.
  const child = spawn(process.execPath, [bundle, ...args], {
    cwd: options.cwd,
    env: childEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  child.stdin.end(task)

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })

  const timeoutMs = options.timeoutSeconds > 0 ? options.timeoutSeconds * 1000 : 0
  let timedOut = false
  const timer = timeoutMs > 0
    ? setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    : null

  const exitCode = await new Promise(resolve => {
    child.on('close', code => resolve(code ?? 1))
    child.on('error', error => {
      stderr += `pi-agent: failed to spawn pi: ${error.message}\n`
      resolve(1)
    })
  })
  if (timer !== null) clearTimeout(timer)

  const text = stdout.trimEnd()
  const durationMs = Date.now() - startedAtMs

  if (options.json) {
    const envelope = {
      ok: !timedOut && exitCode === 0,
      status: timedOut ? 'timeout' : exitCode === 0 ? 'completed' : 'error',
      exitCode: timedOut ? 124 : exitCode,
      text,
      error: stderr.trim() || null,
      sessionId: null,
      sessionDir,
      durationMs,
      task
    }
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n')
    process.exit(envelope.exitCode)
  }

  if (text !== '') process.stdout.write(text + '\n')
  if (stderr.trim() !== '') process.stderr.write(stderr)
  process.exit(timedOut ? 124 : exitCode)
}

main().catch(error => {
  process.stderr.write(`pi-agent: unexpected failure: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
