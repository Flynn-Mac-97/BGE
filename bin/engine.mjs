#!/usr/bin/env node
/**
 * engine — drive a running editor from a terminal.
 *
 * Deliberately thin. Every op is a method name on the browser's `window.engine`,
 * so this file does not enumerate the surface and cannot fall behind it. The
 * engine hosts no AI; this is the door, and whichever CLI the user runs walks
 * through it.
 *
 *   node bin/engine.mjs snapshot
 *   node bin/engine.mjs simulate 1.5
 *   node bin/engine.mjs set coin-7 value 99
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = process.env.ENGINE_PORT || 5180
const HOST = process.env.ENGINE_HOST || `http://localhost:${PORT}`

/**
 * Where friction gets written down.
 *
 * Anchored to the MAIN worktree, not to this checkout: a parallel agent runs in
 * `.agent-worktrees/<id>`, and a log written there is deleted with the worktree
 * — so the friction found by exactly the runs we most want to learn from was
 * the friction that disappeared. The run registry is anchored the same way.
 *
 * Append-only: two agents working at once both get their line, and nothing
 * rewrites what came before. `ENGINE_PAIN_FILE` points it elsewhere, so a test
 * can isolate the log.
 */
const HERE = fileURLToPath(new URL('..', import.meta.url))
const painHome = () => {
  try {
    const line = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: HERE, encoding: 'utf8' })
      .split(/\r?\n/).find(value => value.startsWith('worktree '))
    if (line) return path.resolve(line.slice('worktree '.length))
  } catch { /* not a git checkout — this repo is still the right answer */ }
  return HERE
}
const PAIN_FILE = process.env.ENGINE_PAIN_FILE || path.join(painHome(), 'agent-runs/painpoints.jsonl')

const HELP = `engine — read and drive the running editor

  node bin/engine.mjs <op> [args...]

state     snapshot [--entities --log --plugins --commands --timers]
          entity <id>          index          tree
          check                exits 1 if anything is broken, nondeterministic,
                               or a plugin file that will not load. A problem
                               marked "warning" is reported and exits 0
drive     select <id...>       set <id> <key> <value>
          spawn <type> ['{"at":[1,2,0]}']     destroy <id>
          run <command-id> [arg]              commands
run       play    stop    simulate <seconds>    seed <n>
          script '[["simulate",30],["run","see.describe"]]'
                               several ops, one world — headless only
servers   servers              every dev server this checkout started — port,
                               process, checkout, project, uptime — and the
                               editor tabs attached to each, hidden ones named
          servers.stop [<port>]     stop that one, or all of them when no port
                               is given. Safe when nothing is running
debug     errors    log [n]    watch    eval '<js>'
friction  pain "<what the ENGINE made hard>" [--kind engine|cli|docs|editor]
               engine friction only — a game defect goes in your report, not here
               [--cost <tokens>] [--reads <n>] [--where path] [--fix "..."]
          pain.list [--all]    pain.resolve <id> "<what you did>"
agents    agent.context [file...]
          agent.prepare <id> [file...] [--parallel]
          agent.status         agent.release <id> [--blocked "<why>"]
          agent.merge <id>     merge the lane, run its deferred checks, remove
                               its worktree and branch

Args that parse as JSON are sent as JSON, everything else as a string.
Flags (--foo) collect into a trailing options object.

  --headless     run the op in a private world in this process — no dev server,
                 no browser, no port. Many of these run at once without ever
                 seeing each other, which is how several agents work in parallel.
  --level NAME   headless only: open this level first
  --project NAME open this project directory instead of \`project\`. Must be a
                 directory inside the checkout. index, tree, check and --headless
                 read it; a live editor serves whatever its dev server started
                 with, so switch that one with ENGINE_PROJECT=NAME npm run dev
  --port N       default ${PORT}, or set ENGINE_PORT
  --timeout MS   default 8000
  --raw          force one-line JSON      --pretty  force indented
                 (default: indented at a terminal, compact when captured)

Exit 0 ok, 1 error, 2 no editor attached (open ${HOST}).

index, tree, check and pain read the project straight off disk, so they answer
with nothing running. Everything else drives a live editor unless --headless
says to start a world here instead.

servers and servers.stop need no editor either. They read what each dev server
wrote down and then prove every line by asking the port, because a server killed
outright leaves its record behind and a record alone is not evidence. A port
answering for somebody else's checkout is named and never stopped for you.

Agent commands also need nothing running. Small prepared tasks use this
workspace; parallel writers get a git worktree and require a clean baseline.

  node bin/engine.mjs --headless run tests.run
  node bin/engine.mjs --headless simulate 2 --level level1

Headless cannot draw — there is no canvas, so no screenshot and no picking.
Everything else behaves as it does on screen, because it is the same engine.

pain needs no dev server and no editor — friction is worst exactly when
nothing is running, so recording it must never depend on anything working.
Record what it COST as well as what it was: --cost is a rough token estimate,
and pain.list ranks by it. A vague number beats no number.
`

// ------------------------------------------------------------------ argv
/**
 * Flags that take the next word as their value.
 *
 * Listed rather than inferred, because `snapshot --entities` must stay a bare
 * boolean — a general "the next word is the value" rule would swallow the
 * following argument and the failure would look like the flag doing nothing.
 */
const VALUE_FLAGS = new Set(['port', 'timeout', 'kind', 'where', 'fix', 'cost', 'reads', 'level', 'root', 'project'])

const argv = process.argv.slice(2)
const flags = {}
const words = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { words.push(a); continue }
  const key = a.slice(2)
  // --key value, or a bare --key meaning true
  const next = argv[i + 1]
  if (next !== undefined && !next.startsWith('--') && VALUE_FLAGS.has(key)) {
    flags[key] = next
    i++
  } else flags[key] = true
}

const op = words.shift()
if (!op || op === 'help' || flags.help) {
  process.stdout.write(HELP)
  process.exit(op ? 0 : 1)
}

const host = flags.port ? `http://localhost:${flags.port}` : HOST
const timeout = Number(flags.timeout || 8000)

/** A word that reads as JSON is JSON; anything else is a plain string. */
const coerce = w => {
  try { return JSON.parse(w) } catch { return w }
}

// Flags the CLI itself consumes never reach the browser.
const options = { ...flags }
for (const k of ['port', 'timeout', 'raw', 'pretty', 'verbose', 'help',
                 'kind', 'where', 'fix', 'cost', 'reads', 'all',
                 'headless', 'level', 'root', 'project', 'parallel', 'checked', 'blocked']) delete options[k]

let args = words.map(coerce)
// `select` takes a list, so two ids mean one array argument, not two arguments.
if (op === 'select' && args.length > 1) args = [args]
if (Object.keys(options).length) args.push(options)

// ------------------------------------------------------------------ transport
async function call(op, args, ms = timeout) {
  // Serialise outside the try: a bad argument is a usage error, and reporting
  // it as "server unreachable" sends you debugging the wrong machine.
  const payload = JSON.stringify({ op, args, timeout: ms })

  let res
  try {
    res = await fetch(`${host}/api/engine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload
    })
  } catch (e) {
    die(2, `cannot reach the dev server at ${host}. Is \`npm run dev\` running?`, String(e))
  }
  const body = await res.json().catch(() => ({ error: `bad response ${res.status}` }))
  // The server names the checkout it serves; refuse to drive somebody else's.
  // This is what makes it safe for a lane to drive its own dev server — the
  // reply proves whose workspace is on the other end before any op lands.
  if (body.serves && path.resolve(body.serves) !== path.resolve(REPO)) {
    die(2, `the server at ${host} serves\n  ${path.resolve(body.serves)}\nbut this command runs from\n  ${path.resolve(REPO)}\nDrive this workspace's own server with --port, or run --headless.`)
  }
  if (body.code === 'no-client') die(2, body.error)
  if (!body.ok) die(1, body.error || 'unknown error', body.stack)
  return body.result
}

async function get(pathname) {
  try {
    const res = await fetch(host + pathname)
    return await res.json()
  } catch {
    die(2, `cannot reach the dev server at ${host}. Is \`npm run dev\` running?`)
  }
}

/**
 * Indent for a human at a terminal, compact for anything capturing the output.
 * An agent pays for whitespace on every single call, and it reads JSON just as
 * well without it — so the default follows who is actually looking.
 */
const pretty = flags.pretty || (process.stdout.isTTY && !flags.raw)

/**
 * A command may answer with files: `__files: [{ path, base64 }]`. The browser
 * cannot write to disk, so the bytes come back over the bridge and land here,
 * under the checkout this CLI runs from. The reply then names the written
 * paths instead of carrying the bytes.
 */
function materialise(value) {
  if (Array.isArray(value)) return value.map(materialise)
  if (!Array.isArray(value?.__files)) return value
  const root = fileURLToPath(new URL('..', import.meta.url))
  const written = []
  for (const file of value.__files) {
    if (typeof file?.path !== 'string' || typeof file?.base64 !== 'string') continue
    const target = path.join(root, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, Buffer.from(file.base64, 'base64'))
    written.push(file.path)
  }
  const { __files, ...rest } = value
  return { ...rest, files: written }
}

// Always JSON, including bare strings. A caller that has to guess whether the
// output is quoted has to parse two formats, and that is the caller's bug to
// hit at the worst moment.
const out = v => process.stdout.write(JSON.stringify(materialise(v), null, pretty ? 2 : 0) + '\n')

function die(code, message, detail) {
  process.stderr.write(message + '\n')
  if (detail && flags.verbose) process.stderr.write(detail + '\n')
  process.exit(code)
}

/**
 * Did the op report a failure inside its answer?
 *
 * A gate reads the exit code, so a reply that says a check failed must exit
 * non-zero. `tests.run` answers with a list of results; each carries its own
 * `ok`.
 */
function reportedFailure(value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(reportedFailure)
  if (value.ok === false) return true
  // A command that answers `{ error: "..." }` did not do what it was asked. Left
  // at exit 0, the next step in a script runs on whatever the last one wrote.
  if (typeof value.error === 'string' && value.error) return true
  return Array.isArray(value.tests) && value.tests.some(reportedFailure)
}

// One exit code for every path: the op ran, and the answer says whether it passed.
const finish = value => {
  out(value === undefined ? { ok: true } : value)
  process.exit(reportedFailure(value) ? 1 : 0)
}

// ------------------------------------------------------------------ painpoints
/**
 * Was this engine easy to work in, and what did it cost? The agent doing the
 * work is the only witness, and the answer is worthless a day later.
 *
 * Two different things get recorded here and both matter. One is friction —
 * the thing was confusing, the error pointed at the wrong place. The other is
 * *expense*: how many tokens it took to find the problem, or to fix it. The
 * second is the one that decides what to build next, because a painpoint that
 * cost 40,000 tokens to work around outranks six that cost 500 each, and no
 * amount of describing how annoying something felt says that.
 *
 * Deliberately the cheapest thing in this file: no server, no editor, no
 * network. Friction is worst when the dev server is down, the index is stale,
 * or a change will not load — so recording it cannot depend on any of those
 * being healthy. One `fs.appendFileSync` and back to work.
 */
const KINDS = ['engine', 'cli', 'docs', 'editor']

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

const readPain = () => {
  if (!fs.existsSync(PAIN_FILE)) return []
  return fs.readFileSync(PAIN_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

const appendPain = record => fs.appendFileSync(PAIN_FILE, JSON.stringify(record) + '\n', 'utf8')

/** Fold the append-only log into current state: a later `resolved` wins. */
function foldPain() {
  const open = new Map()
  for (const record of readPain()) {
    if (record.resolved) {
      const found = open.get(record.id)
      if (found) { found.resolved = record.at; found.note = record.note }
    } else open.set(record.id, { ...record })
  }
  return [...open.values()]
}

if (op === 'pain') {
  const what = words.join(' ').trim()
  if (!what) die(1, 'say what was hard:  pain "had to read four files to find where collisions resolve"')

  const kind = typeof flags.kind === 'string' ? flags.kind : 'engine'
  if (!KINDS.includes(kind)) die(1, `--kind must be one of: ${KINDS.join(' ')}`)

  // Ids are short because an agent has to type one back to resolve it.
  const taken = new Set(readPain().map(r => r.id))
  let n = taken.size + 1
  while (taken.has(`p${n}`)) n++

  const cost = num(flags.cost)
  const reads = num(flags.reads)

  const record = {
    id: `p${n}`,
    at: new Date().toISOString(),
    kind,
    what,
    // What it cost, not just how it felt. A rough order of magnitude is worth
    // far more than nothing — this is what pain.list ranks by.
    ...(cost !== null ? { cost } : {}),
    ...(reads !== null ? { reads } : {}),
    ...(typeof flags.where === 'string' ? { where: flags.where } : {}),
    ...(typeof flags.fix === 'string' ? { fix: flags.fix } : {})
  }
  appendPain(record)
  out(record)
  process.exit(0)
}

if (op === 'pain.resolve') {
  const id = words.shift()
  const note = words.join(' ').trim()
  if (!id) die(1, 'which one?  pain.resolve p3 "added world.hook so there is one call site"')
  if (!foldPain().some(r => r.id === id)) die(1, `no painpoint "${id}". Try pain.list`)
  appendPain({ id, resolved: true, at: new Date().toISOString(), note: note || undefined })
  out({ id, resolved: true })
  process.exit(0)
}

if (op === 'pain.list') {
  const all = foldPain()
  const open = all.filter(r => !r.resolved)
  const shown = flags.all ? all : open

  // Grouped by kind with the token cost summed, because one painpoint in `cli`
  // is an anecdote and 40,000 tokens spent in `cli` is the next thing to build.
  const byKind = {}
  for (const record of shown) {
    const k = byKind[record.kind] || (byKind[record.kind] = { n: 0, cost: 0 })
    k.n++
    k.cost += record.cost || 0
  }

  // Most expensive first. An unpriced painpoint sorts last rather than as a
  // zero, so "nobody estimated this" never reads as "this was free".
  const ranked = [...shown].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))

  out({
    open: open.length,
    resolved: all.length - open.length,
    cost: shown.reduce((sum, r) => sum + (r.cost || 0), 0),
    unpriced: shown.filter(r => r.cost == null).length,
    byKind,
    painpoints: ranked
  })
  process.exit(0)
}

// ------------------------------------------------------------------ ops
/**
 * What is in the project, read straight off disk.
 *
 * These used to go through the dev server. They do not need to: the index
 * builder is a module now, so the answer is the same and it arrives with
 * nothing running. That matters most when something is broken — the moment you
 * want `check` is rarely the moment the server is healthy.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))

/**
 * Which checkout, and which project inside it.
 *
 * `--root` moves the checkout and `--project NAME` names a directory inside it.
 * Neither given is the whole default case: this checkout, and `project` —
 * exactly what these ops read before either flag existed.
 */
const CHECKOUT = path.resolve(typeof flags.root === 'string' ? flags.root : REPO)
const PROJECT = path.resolve(CHECKOUT, typeof flags.project === 'string' ? flags.project : 'project')
// The same rule the dev server and the headless runner already enforce, said
// here too. `path.resolve` accepts an absolute path, so without this `index`
// wrote its generated files into any directory on the machine and exited 0 —
// and a project further away would read its instructions out of one tree while
// reading its levels from another.
if (path.dirname(PROJECT) !== CHECKOUT) {
  die(1, `--project must name a directory directly inside ${CHECKOUT} — got ${JSON.stringify(flags.project)}`)
}
const readProject = async () => import('../engine/project-index.mjs')

// Agent context and worktree setup are file/git operations, not world
// operations. They must work before a dev server or browser exists.
if (op.startsWith('agent.')) {
  const agents = await import('../engine/agent-workspace-node.mjs')
  try {
    if (op === 'agent.context') {
      const request = args[0] && typeof args[0] === 'object'
        ? args[0]
        : args.length ? { files: args.map(String) } : {}
      out(await agents.contextFromDisk(REPO, request, path.basename(PROJECT)))
      process.exit(0)
    }

    /**
     * Rewrite the generated agent files — AGENTS.md, CLAUDE.md and the skill
     * copies of every enabled plugin guide.
     *
     * The dev server writes them at start-up, so an edit to a guide made while
     * it runs leaves `check` failing with no command to run.
     */
    if (op === 'agent.skills') {
      const registration = await import('../engine/agent-registration.mjs')
      const written = await registration.writeGeneratedAgentFiles(CHECKOUT, path.basename(PROJECT))
      out(written ?? { ok: true })
      process.exit(0)
    }

    if (op === 'agent.prepare') {
      const id = args[0]
      if (typeof id !== 'string') die(1, 'usage: agent.prepare <id> [JSON task request]')
      const supplied = args[1]
      const request = supplied && typeof supplied === 'object'
        ? { ...supplied }
        : { task: id, files: args.slice(1).map(String) }
      if (flags.parallel) request.parallel = true
      out(await agents.prepareAgent(REPO, id, request, path.basename(PROJECT)))
      process.exit(0)
    }

    if (op === 'agent.status') {
      out(agents.readAgentRegistry(REPO))
      process.exit(0)
    }

    if (op === 'agent.release') {
      const id = args[0]
      if (typeof id !== 'string') die(1, 'usage: agent.release <id> [JSON result]')
      const result = args[1] && typeof args[1] === 'object' ? { ...args[1] } : {}
      // `--checked` used to be the whole gate: it copied the required list into
      // the record without running anything. Release runs them now, so the flag
      // asks for what already happens. Say so rather than accepting it quietly,
      // because a caller passing it believes it is doing something.
      if (flags.checked) process.stderr.write('[agents] --checked is no longer needed; release runs the checks itself\n')
      if (flags.blocked) result.status = 'blocked'
      out(agents.releaseAgent(REPO, id, result))
      process.exit(0)
    }

    if (op === 'agent.merge') {
      const id = args[0]
      if (typeof id !== 'string') die(1, 'usage: agent.merge <id>')
      out(agents.mergeAgent(REPO, id))
      process.exit(0)
    }

    die(1, `no agent op "${op}". Try agent.context, agent.prepare, agent.status, agent.release, or agent.merge`)
  } catch (error) {
    die(1, String(error?.message || error), error?.stack)
  }
}

if (op === 'index') {
  const { buildIndex } = await readProject()
  out(await buildIndex(PROJECT))
  process.exit(0)
}

if (op === 'tree') {
  const { walk, KIND } = await readProject()
  const files = await walk(PROJECT)
  out(files.filter(f => !f.startsWith('.engine')).map(f => ({ path: f, kind: KIND(f) })))
  process.exit(0)
}

// `check` exits non-zero when something is wrong, so it works in a shell chain:
//   node bin/engine.mjs check && node bin/engine.mjs --headless run tests.run
if (op === 'check') {
  const { buildIndex, problemsIn, fatal, pluginImportFailures, pluginProblems } = await readProject()
  // A plugin that will not import is listed first because it is the loudest
  // thing wrong and the quietest to find: the loader carries on without it, so
  // the only symptom anywhere else is a command that has stopped existing.
  //
  // The failures are found by importing the files off disk, because `check`
  // answers with nothing running and a world it never booted has no loader to
  // ask. A live loader keeps the same list in the same shape, so this one line
  // is the only thing that would change to read it instead.
  //
  // Gathered separately from the index so a broken plugin cannot stop the rest
  // of the project being reported, and the other way round.
  const failed = await pluginImportFailures(CHECKOUT, PROJECT)
  // What a fresh agent reads before its first call: the generated files against
  // their source, and every plugin's guide against the commands it registers.
  // These are the only problems whose cost falls entirely on an agent — a stale
  // guide is read all session and there is no second chance to correct it.
  const { agentRegistrationProblems } = await import('../engine/agent-registration.mjs')
  const problems = [
    ...pluginProblems(failed),
    ...problemsIn(await buildIndex(PROJECT)),
    ...await agentRegistrationProblems(CHECKOUT, path.basename(PROJECT))
  ]
  // Warnings are reported and never fail the run. A warning that broke the
  // chain would be turned off, and then it reports nothing at all.
  const failures = fatal(problems)
  out({ ok: failures.length === 0, problems })
  process.exit(failures.length === 0 ? 0 : 1)
}

/**
 * What is running, and how to stop it.
 *
 * These come before the lane guard below on purpose. A lane's whole reason for
 * running this is to clean up after itself, and a command that refused to run
 * in a worktree would leave the servers exactly where the problem started.
 */
if (op === 'servers' || op === 'servers.stop') {
  const { listServers, stopServers } = await readProject()
  const named = typeof args[0] === 'number' ? args[0] : flags.port ? Number(flags.port) : null
  if (op === 'servers') {
    // The default port is asked about whether or not a record mentions it. A
    // server nobody wrote down, sitting where every command looks by default,
    // is the one an agent cannot otherwise see.
    out(await listServers(CHECKOUT, [Number(flags.port || PORT)]))
    process.exit(0)
  }
  if (args[0] !== undefined && named === null && args[0] !== 'all') {
    die(1, `servers.stop takes a port number, "all", or nothing — got ${JSON.stringify(args[0])}`)
  }
  // Parallel lanes each drive their own server, and a bare stop took every one
  // of them down mid-measurement. Sweeping several at once has to be asked for.
  if (named === null && args[0] !== 'all') {
    const running = (await listServers(CHECKOUT, [])).servers.filter(server => server.state === 'running')
    if (running.length > 1) {
      die(1, `${running.length} servers are running, on ports ${running.map(server => server.port).join(', ')}. `
        + `Name the one to stop, or say "servers.stop all" to take them all down.`)
    }
  }
  const result = await stopServers(CHECKOUT, named)
  out(result)
  // Non-zero only when something was asked for and is still running, so a
  // cleanup step in a shell chain fails exactly when cleanup did not happen.
  process.exit(result.ok ? 0 : 1)
}

/**
 * A lane talks to its own world, never the shared editor.
 *
 * The DEFAULT editor serves the main workspace, so an op that drives it writes
 * straight past the worktree that was created to keep the lane apart. Three
 * lanes each ran `spawn` without `--headless`, reached the one dev server, and
 * left a `_probe_<pid>` entity in the shared level — and `check` failed in a
 * workspace none of them were working in. Claim Guard cannot catch this: it
 * knows which run owns a file, and the write arrives from the server's process,
 * which is nobody.
 *
 * A lane MAY run a dev server of its own and drive that — it names the port,
 * and `call()` refuses any server whose reply says it serves a different
 * checkout. The guard here only stops the silent default, where "the" editor
 * is somebody else's.
 *
 * Being inside `.agent-worktrees/` is the whole test. It needs no environment
 * variable to be passed down, which is what makes it hold for a lane that spawns
 * a shell of its own.
 */
// Every op that reads the project off disk — pain, agent, index, tree, check —
// has already run and exited above. What is left here drives a world.
const LANE = /[\\/]\.agent-worktrees[\\/]([^\\/]+)/.exec(REPO)
if (LANE && !flags.headless && !flags.port) {
  die(1, `"${op}" would drive the default editor, which serves the main workspace — not lane "${LANE[1]}".\n` +
    `Run it headless, or name this lane's own dev server:\n` +
    `  node bin/engine.mjs --headless ${process.argv.slice(2).join(' ')}\n` +
    `  node bin/engine.mjs --port <this lane's port> ${process.argv.slice(2).join(' ')}\n` +
    `Either way the server's reply is checked against this workspace before any op lands.`)
}

/**
 * Run the op in a world of this process's own.
 *
 * No dev server, no port, no browser tab, and nothing shared with any other
 * run. That is the whole reason it exists: agents can fan out and simulate at
 * the same moment without trampling one another's world, which one shared
 * editor makes impossible.
 */
if (flags.headless) {
  // Anything the engine prints goes to stderr, so stdout stays one JSON value.
  // A caller that has to strip log lines out of the result is a caller that
  // will eventually strip the wrong one.
  const original = console.log
  const toStderr = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')
  console.log = toStderr
  console.warn = toStderr
  // console.info writes to stdout by default in node; it must join the redirect.
  console.info = toStderr

  const { startWorldInNode } = await import('../engine/start-world-node.mjs')
  let engine, editor
  try {
    ({ engine, editor } = await startWorldInNode({ root: CHECKOUT, project: PROJECT }))
  } catch (e) {
    console.log = original
    die(1, `could not start a world — ${e.message}`, e.stack)
  }

  if (typeof flags.level === 'string') {
    try { await editor.loadLevel(flags.level) }
    catch (e) { die(1, `no level "${flags.level}" — ${e.message}`) }
  }

  /**
   * `script` runs several ops in THIS one world, in order. One op per process
   * was the rule, and it made "simulate 30, then look" impossible without a
   * bespoke harness — every measurement task wrote one. A step is a JSON list,
   * op first: script '[["simulate",30],["run","see.describe",{...}]]'.
   * A step that throws stops the script and reports which step and why.
   */
  if (op === 'script') {
    const steps = args[0]
    if (!Array.isArray(steps) || !steps.every(step => Array.isArray(step) && typeof step[0] === 'string')) {
      die(1, `script takes one JSON array of steps, op first in each:\n  script '[["simulate",30],["run","see.describe"]]'`)
    }
    const results = []
    for (const [stepOp, ...stepArgs] of steps) {
      const stepVerb = engine[stepOp]
      if (typeof stepVerb !== 'function') die(1, `step ${results.length + 1}: no op "${stepOp}"`)
      try { results.push(await stepVerb.apply(engine, stepArgs)) }
      catch (e) { die(1, `step ${results.length + 1} (${stepOp}): ${String(e?.message || e)}`, e?.stack) }
    }
    console.log = original
    finish(results.map(result => result === undefined ? { ok: true } : result))
  }

  const verb = engine[op]
  if (typeof verb !== 'function') {
    die(1, `no op "${op}" — every op is a method on the engine. Try: node bin/engine.mjs --headless commands`)
  }

  let result
  try { result = await verb.apply(engine, args) }
  catch (e) { die(1, String(e?.message || e), e?.stack) }

  console.log = original
  // The loop may hold a timer open. The op is done, so leave rather than wait.
  finish(result)
}

if (op === 'watch') {
  // Poll rather than stream: the reply channel is request/response, and an
  // agent tailing errors wants lines, not a socket to manage.
  let last = -1
  process.stdout.write(`watching ${host} — ctrl-c to stop\n`)
  for (;;) {
    try {
      const log = await call('log', [200])
      for (const l of log) {
        if (l.t <= last) continue
        last = l.t
        process.stdout.write(`${String(l.t).padStart(7)}  ${l.level.padEnd(5)} ${l.source}  ${l.message}\n`)
      }
    } catch { /* editor restarting; keep waiting */ }
    await new Promise(r => setTimeout(r, 500))
  }
}

// `simulate 60` legitimately takes a while, so give the wall clock room.
const ms = op === 'simulate' ? Math.max(timeout, 2000 + Number(words[0] || 1) * 1000) : timeout

const result = await call(op, args, ms)
finish(result)
