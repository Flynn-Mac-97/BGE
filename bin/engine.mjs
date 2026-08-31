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
lanes     lanes                every headless browser started for a lane, each
                               proved against its own debugging port
          lanes.start <client> [--profile 540x960] [--debugPort N]
                               start one and wait for its page. Refused when a
                               browser of that name is already running, so a
                               second start can never orphan the first
          lanes.stop [<client>]     stop one, or all of them
          clients              who is attached to this server, and which one an
                               untargeted call would reach
          lock                 whether lanes are working, and so whether anybody
                               else may write
debug     errors    log [n]    watch    eval '<js>'
friction  pain "<what the ENGINE made hard>" [--kind engine|cli|docs|editor]
               engine friction only — a game defect goes in your report, not here
               [--cost <tokens>] [--reads <n>] [--where path] [--fix "..."]
          pain.list [--all]    pain.resolve <id> "<what you did>"
agents    agent.context [file...]
          agent.prepare <id> [file...] [--parallel]
          agent.status [--all] live runs, lanes to merge, leftovers on disk
          agent.release <id> [--blocked "<why>"]
          agent.merge <id>     merge the lane, run its deferred checks, remove
                               its worktree and branch
          agent.sweep [--dry-run]
                               delete worktrees and directories left by lanes
                               whose work is already in HEAD

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
  --client NAME  which attached page answers. Required once two are attached
  --verbose      name the answering client on stderr, and print error detail

Exit 0 ok, 1 error, 2 no editor attached (open ${HOST}).

Every reply says which client answered. With --client the name is printed on
stderr, and an answer from any other client fails the call. stdout stays the
op's plain JSON, so nothing parsing it has to change.

index, tree, check and pain read the project straight off disk, so they answer
with nothing running. Everything else drives a live editor unless --headless
says to start a world here instead.

servers and servers.stop need no editor either. They read what each dev server
wrote down and then prove every line by asking the port, because a server killed
outright leaves its record behind and a record alone is not evidence. A port
answering for somebody else's checkout is named and never stopped for you.

lanes proves every entry against its debugging port the same way. A lane browser
has no window, so the registry is the only handle on one: one name is one
browser, and lanes.start refuses a name a live browser holds rather than
replacing the record. A record keeps windowAsked, the size Chrome was told, and
viewportReported, what the page says — editor chrome makes them differ, so no
single number is the frame size.

While a lane works the checkout is locked, on both routes to disk. Through the
dev server every writing op is refused; headless, every write to a project file
is refused. Either way the exit code is 1 and the reason names the lanes. Reads
answer as usual, and a headless run that only plays, simulates or measures keeps
working, because that world is private to the process. A lane's own render page
is refused every file write whatever the lock says, because its world is its own
and the checkout is shared. Which of the two you are is read from the lane
registry, never from what the page reports about itself. Say \`lock\` to see the
holders, \`lanes.stop\` to end a lane browser, \`agent.release\` to end a run.

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
const VALUE_FLAGS = new Set(['port', 'timeout', 'kind', 'where', 'fix', 'cost', 'reads', 'level', 'root', 'project', 'client',
                             'profile', 'debugPort'])

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
                 'headless', 'level', 'root', 'project', 'parallel', 'checked', 'blocked',
                 'client', 'dry-run', 'dryRun', 'profile', 'debugPort']) delete options[k]

let args = words.map(coerce)
// `select` takes a list, so two ids mean one array argument, not two arguments.
if (op === 'select' && args.length > 1) args = [args]
if (Object.keys(options).length) args.push(options)

// ------------------------------------------------------------------ transport
async function call(op, args, ms = timeout) {
  // Serialise outside the try: a bad argument is a usage error, and reporting
  // it as "server unreachable" sends you debugging the wrong machine.
  const payload = JSON.stringify({
    op, args, timeout: ms,
    ...(typeof flags.client === 'string' ? { client: flags.client } : {})
  })

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
  // Nothing to talk to is exit 2; the wrong number of things to talk to is a
  // usage error the caller fixes with --client, so it is exit 1.
  if (body.code === 'no-client' || body.code === 'no-reply') die(2, body.error)
  if (body.code) die(1, body.error)
  if (!body.ok) die(1, body.error || 'unknown error', body.stack)
  nameTheAnswerer(body.answeredBy)
  return body.result
}

/** One client on one line: enough to tell it from the others. */
function describeAnswerer(who) {
  const marks = [who.headless ? 'headless' : null, who.viewport || null, who.hidden ? 'hidden' : null]
    .filter(Boolean).join(', ')
  return marks ? `${who.id} (${marks})` : who.id
}

/**
 * Say which client answered, and refuse an answer from one nobody asked for.
 *
 * The server sends `answeredBy` with every reply. It goes to stderr so stdout
 * stays the op's plain JSON result, which is the shape callers parse.
 *
 * An untargeted call is refused by the server whenever two or more clients are
 * attached, so a call carrying `--client` is exactly the case where more than
 * one could have answered — that is when the name is printed without being
 * asked for. `--verbose` prints it with one client attached too.
 */
let lastAnswerer = null
function nameTheAnswerer(who) {
  const asked = typeof flags.client === 'string' ? flags.client : null
  if (asked && who?.id && who.id !== asked) {
    die(1, `"${asked}" was named but "${who.id}" answered. No client may answer for another.`)
  }
  if (!asked && !flags.verbose) return
  if (!who?.id) {
    if (flags.verbose) process.stderr.write('[bridge] the server did not say which client answered\n')
    return
  }
  // `watch` polls in a loop; say it once, and again only if somebody else answers.
  if (who.id === lastAnswerer) return
  lastAnswerer = who.id
  process.stderr.write(`[bridge] answered by ${describeAnswerer(who)}\n`)
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

/**
 * One exit code for every path: the op ran, and the answer says whether it
 * passed.
 *
 * This ends the process. Every op runs at the top level of this file, so a
 * `finish` that only set `process.exitCode` would fall through into the ops
 * below it and run one of them.
 */
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

    /**
     * What is live, and where the registry and git disagree.
     *
     * The whole registry carries every run's captured check output, so reading
     * it costs more than the collisions it prevents. The default answers the
     * two questions a lane actually asks — which files are claimed, and what
     * still needs merging — and `--all` keeps the raw records available.
     */
    if (op === 'agent.status') {
      if (flags.all) {
        out(agents.readAgentRegistry(REPO))
        process.exit(0)
      }
      const states = agents.agentState(REPO)
      const live = states.filter(state => state.live)
      const disagrees = states.filter(state => state.disagrees)
      const leftBehind = states.filter(state => !state.live && state.ownsWorktree && state.onDisk)
      out({
        runs: states.length,
        live: live.map(state => ({
          id: state.id, files: state.files, startedAt: state.startedAt, branch: state.branch
        })),
        // Named separately because the safe reading of a stale `complete` is to
        // merge again, and merging again is what wastes a lane.
        needsMerge: states
          .filter(state => !state.live && state.provenByGit && !state.landed)
          .map(state => ({ id: state.id, branch: state.branch, recorded: state.recorded })),
        alreadyInHead: disagrees.map(state => ({ id: state.id, recorded: state.recorded, branch: state.branch })),
        leftBehind: leftBehind.map(state => ({ id: state.id, workspace: state.workspace, listedByGit: state.hasWorktree })),
        // Only when a sweep has something to remove. A record that disagrees
        // with git and has nothing left on disk needs no action at all.
        ...(leftBehind.length || disagrees.some(state => state.branchExists)
          ? { next: 'node bin/engine.mjs agent.sweep' }
          : {})
      })
      process.exit(0)
    }

    /**
     * Delete what finished lanes left in `.agent-worktrees`.
     *
     * `--dry-run` lists without deleting.
     */
    if (op === 'agent.sweep') {
      out(agents.sweepAgents(REPO, { dryRun: flags['dry-run'] === true || flags.dryRun === true }))
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

    die(1, `no agent op "${op}". Try agent.context, agent.prepare, agent.status, agent.release, agent.merge, agent.sweep, or agent.skills`)
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
/**
 * Whether agents are working, and so whether anybody else may write.
 *
 * Read off disk, so it answers with no dev server: the question "may I edit
 * this" has to be answerable before anything is started.
 */
if (op === 'lock') {
  const { workLock } = await import('../engine/work-lock.mjs')
  finish(workLock(CHECKOUT))
}

/**
 * What a lane's page says its own viewport is, asked of the dev server.
 *
 * The debugging port answers as soon as the browser is up, which is before the
 * page has loaded and announced itself, so this polls for a few seconds. An
 * empty answer means the page never said, and nothing is recorded.
 */
async function laneViewport(client, tries = 12) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const answer = await fetch(`${host}/api/server`).then(reply => reply.json()).catch(() => null)
    const tab = (answer?.tabs || []).find(entry => entry.id === client)
    if (tab?.viewport) return { viewport: tab.viewport, pixelRatio: tab.pixelRatio }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return {}
}

/**
 * Headless browsers started to render for a lane.
 *
 * `lanes` lists them, each proved against its own debugging port. `lanes.start`
 * adds one, `lanes.stop` ends one or all. A browser with no window leaves no
 * other trace, so these are the only way to find one that outlived its run.
 */
if (op === 'lanes' || op === 'lanes.start' || op === 'lanes.stop') {
  const browsers = await import('../engine/lane-browsers.mjs')
  try {
    if (op === 'lanes') {
      const list = await browsers.listLaneBrowsers(CHECKOUT)
      finish({
        running: list.filter(entry => entry.alive).length,
        browsers: list,
        ...(list.some(entry => !entry.alive) ? { next: 'node bin/engine.mjs lanes.stop' } : {})
      })
    }

    if (op === 'lanes.start') {
      const name = typeof args[0] === 'string' ? args[0] : null
      if (!name) die(1, 'usage: lanes.start <client> [--port N] [--profile 540x960]')
      const asked = typeof flags.profile === 'string' ? flags.profile : '540x960'
      const [width, height] = asked.split('x').map(Number)
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        die(1, `--profile takes WIDTHxHEIGHT, got ${JSON.stringify(flags.profile)}`)
      }
      const started = await browsers.startLaneBrowser(CHECKOUT, {
        client: name,
        url: host + '/',
        port: Number(flags.debugPort || 0) || 9400 + (await browsers.listLaneBrowsers(CHECKOUT)).length,
        width, height
      })
      const { browser, ...said } = started
      // The window size is what Chrome was told; the frame is smaller by the
      // editor chrome. Record the page's own number beside it, never instead.
      const recorded = browsers.recordLaneViewport(CHECKOUT, name, await laneViewport(name)) || said
      finish({
        ...said, ...recorded,
        drive: `node bin/engine.mjs snapshot --client ${name}`
      })
    }

    if (op === 'lanes.stop') {
      finish(await browsers.stopLaneBrowsers(CHECKOUT, typeof args[0] === 'string' ? args[0] : null))
    }
  } catch (error) {
    die(1, String(error?.message || error))
  }
}

/**
 * Who is attached to this server, and which one a call would reach.
 *
 * Asked over HTTP rather than through the bridge, because the whole point is
 * to answer when more than one client is attached and the bridge refuses.
 */
if (op === 'clients') {
  let answer
  try {
    answer = await (await fetch(`${host}/api/server`)).json()
  } catch (error) {
    die(2, `cannot reach the dev server at ${host}. Is \`npm run dev\` running?`, String(error))
  }
  const attached = answer.tabs || []
  finish({
    server: { url: host, project: answer.project, serves: answer.serves, pid: answer.pid },
    attached,
    // An untargeted call needs exactly one, so say which one it would be.
    wouldAnswer: attached.length === 1 ? attached[0].id : null,
    ...(attached.length > 1 ? { next: `name one with --client <id>` } : {})
  })
}

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

  const { startWorldInNode, writesRefusedHere } = await import('../engine/start-world-node.mjs')

  /**
   * The work lock refused a write, so the run failed whatever the op answered.
   *
   * A command that awaits the write throws and dies before this. One that
   * ignores the rejection would otherwise print its usual result and exit 0,
   * and the caller would believe the file is on disk.
   */
  const failOnRefusedWrite = () => {
    const [first] = writesRefusedHere()
    if (first) die(1, `refused to write ${first.file} — ${first.why}`)
  }

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
    failOnRefusedWrite()
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
  failOnRefusedWrite()
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
