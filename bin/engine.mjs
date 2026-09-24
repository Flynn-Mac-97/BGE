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
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveProject } from '../engine/project-path.mjs'

const PORT = process.env.ENGINE_PORT || 5180
const HOST = process.env.ENGINE_HOST || `http://localhost:${PORT}`

/**
 * Where the two ledgers are written.
 *
 * Both are anchored to the MAIN worktree, not to this checkout: a parallel
 * agent runs in `.agent-worktrees/<id>`, and a log written there is deleted
 * with the worktree — so what the runs we most want to learn from found would
 * be exactly what disappeared. The run registry is anchored the same way.
 *
 * Append-only: two agents working at once both get their line, and nothing
 * rewrites what came before. `ENGINE_PAIN_FILE` and `ENGINE_INSIGHT_FILE`
 * point them elsewhere, so a test can isolate a log.
 */
const HERE = fileURLToPath(new URL('..', import.meta.url))

/**
 * The main worktree, found once, and only when a ledger is actually reached.
 *
 * Finding it runs `git`, and a subprocess costs about what starting node costs.
 * Read at the module's top it was charged to every command, including the many
 * that never look at a ledger; one that does read a ledger pays it once.
 */
let ledgerRoot = null
const ledgerHome = () => {
  if (ledgerRoot !== null) return ledgerRoot
  ledgerRoot = HERE
  try {
    const line = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: HERE, encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/).find(value => value.startsWith('worktree '))
    if (line) ledgerRoot = path.resolve(line.slice('worktree '.length))
  } catch { /* not a git checkout — this repo is still the right answer */ }
  return ledgerRoot
}

/** The two ledger paths. A function, so an op that never reads one never finds it. */
const PAIN_FILE = () => process.env.ENGINE_PAIN_FILE || path.join(ledgerHome(), 'agent-runs/painpoints.jsonl')
const INSIGHT_FILE = () => process.env.ENGINE_INSIGHT_FILE || path.join(ledgerHome(), 'agent-runs/insights.jsonl')

const HELP = `engine — read and drive the running editor

  node bin/engine.mjs <op> [args...]

state     snapshot [--entities --log --plugins --commands --timers]
          entity <id>          index          tree
          check                exits 1 if anything is broken, nondeterministic,
                               or a plugin file that will not load, or if the
                               kernel fails format, lint, Trellis or Codemap
                               (agents/code-style.md). A problem marked
                               "warning" is reported and exits 0
          test [files]         run only the core test areas the files call;
                               no files means the files git says changed
          a list can name its columns instead of repeating them every row:
          snapshot '{"entities":["id","at"]}'                  the whole level
          commands '{"fields":["id"]}'                          every verb
drive     select <id...>       set <id> <key> <value>
          spawn <type> ['{"at":[1,2,0]}']     destroy <id>
          run <command-id> [arg]              commands
run       play    stop    simulate <seconds>    seed <n>
          marks                what this run can be put back to, oldest first
          mark                 mark this moment, to come back to exactly
          stepBack [n]         go back n fixed steps, exactly
          seek <step>          go back to a step count. Forward is refused —
                               step with simulate instead
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
          lanes.stop [<client>|all]  stop one, or all of them when no client
                               is given. "all" includes the visible window
          clients              who is attached to this server, and which one an
                               untargeted call would reach
          lock                 whether lanes are working, and so whether anybody
                               else may write
desktop   desktop [<action>] [json]   console state or a desktop action
                               terminal.start/read/write/resize/interrupt/stop,
                               engine.open/activate/reload, instance.stop,
                               dev.start, project.open

supervisor
          supervisor [--watch]
                               what the supervisor is running, or the sentence
                               that starts one. --watch prints a live table and
                               takes keys: d dev server, e editor tab, h
                               headless, s stop, a stop all, q.
                               Exit 2 when none is up
          supervisor.start     start it detached if it is not up; idempotent,
                               and prints the port
          supervisor.open <kind> [json]
                               start one instance: dev-server, editor-browser,
                               lane-browser or headless-session. Every
                               editor-browser is a tab of its own in the one
                               visible window, and drives from the terminal as
                               --client <its id>
          supervisor.stop [<id>|all]
                               stop one instance, or every owned one. --down
                               stops the supervisor itself. Exit 1 while any
                               asked-for instance is still running
session   serve                one headless world, many ops, read from stdin:
                               one JSON request per line, one JSON reply per
                               line. What --headless pays per command, a session
                               pays once
debug     errors    log [n]    watch    eval '<js>'
friction  pain "<what the ENGINE made hard>" [--kind engine|cli|docs|editor]
               engine friction only — a game defect goes in your report, not here
               [--cost <tokens>] [--reads <n>] [--where path] [--fix "..."]
          pain.list [--all]    pain.resolve <id> "<what you did>"
insight   insight "<what worked>" [--kind method|engine|cli|docs|editor]
               [--problem "<when to use it>"] [--saves <tokens>] [--where path]
               [--tool "<what would make this one step>"]
          insight.list [<words to search>] [--all]
          insight.adopt <id> "<the tool that now does it>"
evolve    evolve [<id>|<words>] one read-only maintenance brief; newest matching
                               open pain or insight, not a priority score.
                               Reproduce first; small compatible fixes may
                               proceed directly. Ask for risky changes.
          pain / insight accept --repro "<steps>" --expected "<result>"
                               --actual "<result>" as evidence, never executed.
agents    agent.context [file...]
          agent.prepare <id> [file...] [--parallel]
          agent.status [--all] live runs, lanes to merge, leftovers on disk
          agent.release <id> [--blocked "<why>"]
          agent.merge <id>     merge the lane, run its deferred checks, remove
                               its worktree and branch
          agent.sweep [--dry-run] [--days N]
                               delete worktrees and directories left by lanes
                               whose work is already in HEAD, and rounds of
                               agent output older than N days (default 7). The
                               two ledgers and the README are never swept
jev       jev.status           the opt-in switch, the pinned model, and whether
                               a key and a proxy are present (never the key)
          jev.mode '{"on":true}'  turn Jev on or off for this project; no
                               argument reads it. Off means no network call
          jev.guides '{"task":"..."}'  rank the optional plugin guides a
                               task looks like it needs
          jev.records '{"text":"..."}'  rank open ledger records related to
                               a new finding; advisory, never decides work is
                               fixed

Jev runs from node and reaches OpenRouter alone: OPENROUTER_PROXY_URL is
attached to that one request as a dispatcher. The pi process, a global
dispatcher and the Windows proxy are never touched.

Args that parse as JSON are sent as JSON, everything else as a string.
Flags (--foo) collect into a trailing options object.

  --headless     run the op in a private world in this process — no dev server,
                 no browser, no port. Many of these run at once without ever
                 seeing each other, which is how several agents work in parallel.
  --level NAME   headless only: open this level first
  --project PATH open this project directory. A path resolved against the
                 checkout, so a bare name is a directory inside it and \`../x\` or
                 an absolute path reaches one anywhere. index, tree, check and
                 --headless read it; a live editor serves whatever its dev
                 server started with, so switch that one with
                 ENGINE_PROJECT=PATH npm run dev
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

index, tree, check, pain and insight read the project straight off disk, so they
answer with nothing running. Everything else drives a live editor unless --headless
says to start a world here instead.

servers and servers.stop need no editor either. They read what each dev server
wrote down and then prove every line by asking the port, because a server killed
outright leaves its record behind and a record alone is not evidence. A port
answering for somebody else's checkout is named and never stopped for you.

supervisor and its verbs need no editor either. The supervisor owns every
instance this checkout starts and proves each against its own port; a record
alone is not evidence, so a stale one is dropped rather than reported running.

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

serve is --headless held open. It boots one private world, then reads one JSON
object per line on stdin and writes one JSON line per request on stdout, so a
hundred questions cost one boot instead of a hundred. An op is a method on the
engine, or a dotted path to one, because a session that could not open a level
would need a second session per level:

  {"op":"simulate","args":[10]}
  {"op":"editor.loadLevel","args":["level1"]}
  {"op":"snapshot","args":[{entities:true}]}
  {"op":"exit"}

A request that throws answers {"error":"..."} and the session stays up. Anything
the engine prints goes to stderr, so stdout stays one JSON value per line.

Headless cannot draw — there is no canvas, so no screenshot and no picking.
Everything else behaves as it does on screen, because it is the same engine.

pain needs no dev server and no editor — friction is worst exactly when
nothing is running, so recording it must never depend on anything working.
Record what it COST as well as what it was: --cost is a rough token estimate,
and pain.list ranks by it. A vague number beats no number.

insight is the other half of the same loop. A painpoint says the engine made
something hard; an insight says you found a way through, and --saves is what
the next agent will not spend because you wrote it down. Give --problem so the
solution can be found again: insight.list <words> searches it. insight.adopt
closes one, meaning the engine now has a tool that reaches the same answer.
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
                             'profile', 'debugPort', 'problem', 'saves', 'tool', 'repro', 'expected', 'actual'])

const argv = process.argv.slice(2)
const flags = process.env.ENGINE_CLIENT ? { client: process.env.ENGINE_CLIENT } : {}
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
  try { return JSON.parse(w) } catch { return repairStrippedJSON(w) ?? w }
}

/**
 * The object behind a JSON argument whose quotes a shell removed.
 *
 * A shell that strips quotes hands `{"task":"fix the bug"}` over as
 * `{task:fix the bug}` — a string, not JSON, so the op receives one long
 * filename and answers an empty packet with no error. PowerShell does this to
 * every quoted argument, so the invocation written in AGENTS.md needs the
 * quotes put back. Nothing else can be recovered: a shell that removed the
 * quotes removed the only marks saying where a key ends and a value begins, so
 * this reads the shape that survives — pairs, and lists of words.
 *
 * @param {string} text One argument, braces included.
 * @returns {object|null} The request, or null when the shape is not readable.
 */
function repairStrippedJSON(text) {
  if (typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return null
  // Quoted input already failed JSON.parse for another reason. Guessing again
  // would turn a syntax error into a wrong request.
  if (text.includes('"')) return null

  /** The text inside one bracket pair, at the depth it opens. */
  const inner = (value, open, close) => value.startsWith(open) && value.endsWith(close)
    ? value.slice(1, -1).trim()
    : null

  /** Split on commas that are not inside brackets. */
  const split = value => {
    const parts = []
    let depth = 0, from = 0
    for (let at = 0; at < value.length; at++) {
      const character = value[at]
      if ('[{'.includes(character)) depth++
      else if (']}'.includes(character)) depth--
      else if (character === ',' && depth === 0) { parts.push(value.slice(from, at)); from = at + 1 }
    }
    parts.push(value.slice(from))
    return parts
  }

  /** One value: a nested collection, a literal, or a bare word that was a string. */
  const read = value => {
    const word = value.trim()
    const list = inner(word, '[', ']')
    if (list !== null) return split(list).map(read)
    const object = inner(word, '{', '}')
    if (object !== null) return repairStrippedJSON(`{${object}}`)
    if (/^-?\d+(\.\d+)?$/.test(word)) return Number(word)
    if (word === 'true') return true
    if (word === 'false') return false
    if (word === 'null') return null
    return word
  }

  const request = {}
  for (const part of split(text.slice(1, -1))) {
    const colon = part.indexOf(':')
    if (colon < 1) return null
    const key = part.slice(0, colon).trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) return null
    request[key] = read(part.slice(colon + 1))
  }
  return Object.keys(request).length ? request : null
}

/**
 * The arguments as one request when a shell split it.
 *
 * `{"task":"fix the bug"}` arrives as three words once the quotes are gone, and
 * an op that takes a request would read the first word as a filename. One
 * argument starting with a brace or a bracket, and the last ending the pair, is
 * the whole test: a file path never looks like that.
 */
function rejoinSplitRequest(list) {
  const from = list.findIndex(word => word.startsWith('{') || word.startsWith('['))
  if (from < 0 || from === list.length - 1) return list
  const joined = list.slice(from).join(' ')
  const opens = list[from][0]
  if (!joined.endsWith(opens === '{' ? '}' : ']')) return list
  return [...list.slice(0, from), joined]
}

// Flags the CLI itself consumes never reach the browser.
const options = { ...flags }
for (const k of ['port', 'timeout', 'raw', 'pretty', 'verbose', 'help',
                 'kind', 'where', 'fix', 'cost', 'reads', 'all', 'problem', 'saves', 'tool', 'repro', 'expected', 'actual',
                 'headless', 'level', 'root', 'project', 'parallel', 'checked', 'blocked',
                 'client', 'dry-run', 'dryRun', 'profile', 'debugPort', 'down', 'watch']) delete options[k]

let args = rejoinSplitRequest(words).map(coerce)
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
    die(2, `cannot reach the dev server at ${host}. Start one through the supervisor: `
      + 'node bin/engine.mjs supervisor.start, then supervisor.open dev-server', String(e))
  }
  const body = await res.json().catch(() => ({ error: `bad response ${res.status}` }))
  // The server names the checkout it serves; refuse to drive somebody else's.
  // This is what makes it safe for a lane to drive its own dev server — the
  // reply proves whose workspace is on the other end before any op lands.
  if (body.serves && path.resolve(body.serves) !== path.resolve(REPO)) {
    die(2, `the server at ${host} serves\n  ${path.resolve(body.serves)}\nbut this command runs from\n  ${path.resolve(REPO)}\nDrive this workspace's own server with --port, or run --headless. `
      + `See every instance with: node bin/engine.mjs supervisor, then stop one with: supervisor.stop <id>`) 
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
    die(2, `cannot reach the dev server at ${host}. Start one through the supervisor: `
      + 'node bin/engine.mjs supervisor.start, then supervisor.open dev-server')
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

/**
 * Wall milliseconds a process is given to leave on its own before it is made to.
 *
 * Long enough that a world being torn down is not cut off mid-close, short enough that an
 * agent waiting on a command does not read a hang. See `stop`.
 */
const DRAIN_LIMIT = 2000

/**
 * Whether the op has been answered, so nothing below it runs.
 *
 * `process.exit()` used to do this, and it is also what `stop` no longer does.
 */
let finished = false

/**
 * End this file here, with an exit code, and let node leave when the loop drains.
 *
 * Not `process.exit()`, and that is the whole point. A world that has stepped a Rapier
 * body leaves the runtime with a handle still closing, and ending the process under it
 * asserts inside libuv: a headless `simulate` wrote a complete reply and then exited
 * 3221226505, so a caller reading the exit code saw a crash for a run that worked.
 * Measured four ways on the same run — natural exit 0, exit 3221226505, write-then-exit
 * 3221226505, write-then-set-the-code-and-drain 0.
 *
 * The bound is for the other half: a world in play mode holds a frame timer, and a plugin
 * may hold one of its own, so draining alone can wait for ever where an exit used to
 * work. The timer is unref'd, so it never delays a process that was going to leave
 * anyway, and it only fires for one that cannot.
 */
const stop = code => {
  finished = true
  process.exitCode = code
  setTimeout(() => process.exit(code), DRAIN_LIMIT).unref()
}

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
 * This ends the file. Every op runs at the top level of it, so an answer with nothing to
 * stop the rest would fall through into the ops below — which is what `finished` and the
 * two guards on it are for. See `stop` for why the process is not exited here.
 */
const finish = value => {
  if (finished) return
  out(value === undefined ? { ok: true } : value)
  stop(reportedFailure(value) ? 1 : 0)
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

const num = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

/**
 * Both ledgers are the same file format, so they share these four.
 *
 * A record is one JSON line. A line that will not parse is skipped rather than
 * thrown on: a half-written line from a killed process must not make the whole
 * log unreadable.
 */
const readLedger = file => {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

const appendLedger = (file, record) => fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8')

/**
 * Fold the append-only log into current state. A later closing line wins.
 *
 * `closedKey` is the field that closes a record — `resolved` for a painpoint,
 * `adopted` for an insight. The shape either side is identical.
 */
function foldLedger(file, closedKey) {
  const open = new Map()
  for (const record of readLedger(file)) {
    if (record[closedKey]) {
      const found = open.get(record.id)
      if (found) { found[closedKey] = record.at; found.note = record.note }
    } else open.set(record.id, { ...record })
  }
  return [...open.values()]
}

/** Short ids, because an agent types one back to close the record. */
function nextId(records, prefix) {
  const taken = new Set(records.map(record => record.id))
  let n = taken.size + 1
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

const readPain = () => readLedger(PAIN_FILE())
const appendPain = record => appendLedger(PAIN_FILE(), record)
const foldPain = () => foldLedger(PAIN_FILE(), 'resolved')

function ledgerEvidence() {
  const evidence = {}
  for (const name of ['repro', 'expected', 'actual']) {
    if (flags[name] === undefined) continue
    if (typeof flags[name] !== 'string' || !flags[name].trim()) die(1, `--${name} needs non-empty text`)
    evidence[name] = flags[name].trim()
  }
  return evidence
}

if (op === 'pain') {
  const what = words.join(' ').trim()
  if (!what) die(1, 'say what was hard:  pain "had to read four files to find where collisions resolve"')

  const kind = typeof flags.kind === 'string' ? flags.kind : 'engine'
  if (!KINDS.includes(kind)) die(1, `--kind must be one of: ${KINDS.join(' ')}`)

  const cost = num(flags.cost)
  const reads = num(flags.reads)

  const record = {
    id: nextId(readPain(), 'p'),
    at: new Date().toISOString(),
    kind,
    what,
    ...ledgerEvidence(),
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
  const { byKind, ranked } = grouped(shown, 'cost')

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

/**
 * Records grouped by kind with one number summed, and the records ranked by it.
 *
 * The group keeps the number under the field's own name, so the reply reads
 * `byKind.cli.cost`. An unpriced record sorts last rather than as a zero, so
 * "nobody estimated this" never reads as "this was free".
 */
function grouped(records, field) {
  const byKind = {}
  for (const record of records) {
    const group = byKind[record.kind] || (byKind[record.kind] = { n: 0, [field]: 0 })
    group.n++
    group[field] += record[field] || 0
  }
  const ranked = [...records].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1))
  return { byKind, ranked }
}

// ------------------------------------------------------------------ insights
/**
 * What worked, so the engine can make it the easy path.
 *
 * The twin of a painpoint, and the other half of the same loop. A painpoint
 * says the engine made something hard and ranks by what that cost. An insight
 * says an agent found a way through and ranks by what it saves next time. Fix
 * the first and the engine stops hurting; build the second and the engine gets
 * better at the work.
 *
 * An insight is only useful if it is found again, so `--problem` carries the
 * situation the solution answers and `insight.list <words>` searches it. A
 * record with no problem is a diary entry nobody can reach.
 *
 * `insight.adopt` closes one: the engine now has a tool, verb or instruction
 * that reaches the same answer directly, so nobody has to work it out again.
 * An un-adopted insight with a large saving is the next thing to build, the
 * way an open painpoint with a large cost is the next thing to fix.
 *
 * As cheap as `pain` on purpose: no server, no editor, no network. A discovery
 * is recorded at the moment it is made or it is lost.
 */

// `method` is a way of working rather than one surface, and most insights are
// one. The other four match the painpoint kinds so a fix and its discovery
// group together.
const INSIGHT_KINDS = ['method', 'engine', 'cli', 'docs', 'editor']

const readInsights = () => readLedger(INSIGHT_FILE())
const foldInsights = () => foldLedger(INSIGHT_FILE(), 'adopted')

if (op === 'evolve') {
  try {
    const { evolutionBrief } = await import('../engine/evolve.mjs')
    out(evolutionBrief(foldPain(), foldInsights(), words.join(' ')))
    process.exit(0)
  } catch (error) { die(1, error.message) }
}

/** Every word must appear somewhere in the record. Case is ignored. */
const insightMatches = (record, words) => {
  const haystack = [record.what, record.problem, record.where, record.tool, record.note, record.repro, record.expected, record.actual]
    .filter(Boolean).join(' ').toLowerCase()
  return words.every(word => haystack.includes(word))
}

if (op === 'insight') {
  const what = words.join(' ').trim()
  if (!what) {
    die(1, 'say what worked:  insight "derive the lock from live pids instead of storing it" ' +
      '--problem "state that must not go stale" --saves 6000')
  }

  const kind = typeof flags.kind === 'string' ? flags.kind : 'method'
  if (!INSIGHT_KINDS.includes(kind)) die(1, `--kind must be one of: ${INSIGHT_KINDS.join(' ')}`)

  const saves = num(flags.saves)

  const record = {
    id: nextId(readInsights(), 'i'),
    at: new Date().toISOString(),
    kind,
    what,
    ...ledgerEvidence(),
    // The problem is the search key. Without it the solution is unreachable
    // by anyone who has not already had the idea.
    ...(typeof flags.problem === 'string' ? { problem: flags.problem } : {}),
    // Tokens the next agent does not spend because this is written down. It is
    // what insight.list ranks by, and a rough number beats none.
    ...(saves !== null ? { saves } : {}),
    ...(typeof flags.where === 'string' ? { where: flags.where } : {}),
    // What would turn this into one step: a verb, a check, a line of guidance.
    ...(typeof flags.tool === 'string' ? { tool: flags.tool } : {})
  }
  appendLedger(INSIGHT_FILE(), record)
  out(record)
  process.exit(0)
}

if (op === 'insight.adopt') {
  const id = words.shift()
  const note = words.join(' ').trim()
  if (!id) die(1, 'which one?  insight.adopt i3 "added `lock`, which derives it the same way"')
  if (!foldInsights().some(record => record.id === id)) die(1, `no insight "${id}". Try insight.list`)
  appendLedger(INSIGHT_FILE(), { id, adopted: true, at: new Date().toISOString(), note: note || undefined })
  out({ id, adopted: true })
  process.exit(0)
}

if (op === 'insight.list') {
  const all = foldInsights()
  const open = all.filter(record => !record.adopted)
  const search = words.join(' ').trim().toLowerCase().split(/\s+/).filter(Boolean)

  // Searching looks through everything, listing shows only what is not adopted.
  // An adopted insight is the best answer to a search — there is already a tool
  // for it — but it is finished work, so it is not on the build queue.
  const shown = search.length ? all.filter(record => insightMatches(record, search))
    : flags.all ? all
      : open

  // Grouped by kind with the saving summed, because one insight an agent found
  // is worth telling and a kind that saves 40,000 tokens is worth building into
  // the engine. Biggest saving first.
  const { byKind, ranked } = grouped(shown, 'saves')

  out({
    ...(search.length ? { search: search.join(' '), found: shown.length } : {}),
    open: open.length,
    adopted: all.length - open.length,
    saves: shown.reduce((sum, record) => sum + (record.saves || 0), 0),
    unmeasured: shown.filter(record => record.saves == null).length,
    byKind,
    insights: ranked
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
 * Which checkout, and which project.
 *
 * `--root` moves the checkout. `--project` takes a path resolved against it, so
 * a bare name still reaches a directory inside the checkout and `../name` or an
 * absolute path reaches one anywhere else. Neither given opens the untitled
 * project, the same blank game the editor opens with.
 */
const CHECKOUT = path.resolve(typeof flags.root === 'string' ? flags.root : REPO)
const PROJECT = resolveProject(CHECKOUT, typeof flags.project === 'string' ? flags.project : process.env.ENGINE_PROJECT)
const readProject = async () => import('../engine/project-index.mjs')

// Agent context and worktree setup are file/git operations, not world
// operations. They must work before a dev server or browser exists.
if (op.startsWith('agent.')) {
  const agents = await import('../engine/agent-workspace-node.mjs')

  /**
   * Every plugin's interface, parsed from its source when a packet is built.
   *
   * Made on the first call and kept, because compiling the grammar costs about a
   * tenth of a second and a packet describes only the plugins it selects. A
   * packet built where the parser cannot run carries the guide alone.
   *
   * The parser is Plugin Master's, and the CLI is not the kernel, so it names
   * that plugin here and loads it lazily: only the agent ops that print an
   * interface pay for it, and a checkout without it answers every other verb.
   */
  let interfaceReader = null
  const interfaceText = async (scope, file) => {
    interfaceReader ??= (await import('../plugins/builtin/plugin-master/interface-block.js'))
      .makeInterfaceReader({ root: REPO, projectDirectory: PROJECT })
    return (await interfaceReader)(scope, file)
  }

  try {
    if (op === 'agent.context') {
      const request = args[0] && typeof args[0] === 'object'
        ? args[0]
        : args.length ? { files: args.map(String) } : {}
      out(await agents.contextFromDisk(REPO, request, PROJECT, interfaceText))
      // `stop`, not `process.exit`: the parser's wasm runtime still holds a
      // handle when the packet is answered, and ending the process under it
      // asserts inside libuv — a complete packet written, and 3221226505 for
      // an exit code, which every caller reads as a failure.
      stop(0)
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
      const written = await registration.writeGeneratedAgentFiles(CHECKOUT, PROJECT)
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
      out(await agents.prepareAgent(REPO, id, request, PROJECT, interfaceText))
      // The packet this writes carries parsed interfaces, so this op loads the
      // parser too. Leave the way `agent.context` leaves, for the same reason.
      stop(0)
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
      out(agents.sweepAgents(REPO, {
        dryRun: flags['dry-run'] === true || flags.dryRun === true,
        days: flags.days === undefined ? undefined : Number(flags.days)
      }))
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

    // `finished` is set by `stop`, which is how an op that loaded the parser
    // leaves — this fall-through would otherwise report the op it just answered.
    if (!finished) {
      die(1, `no agent op "${op}". Try agent.context, agent.prepare, agent.status, agent.release, agent.merge, agent.sweep, or agent.skills`)
    }
  } catch (error) {
    die(1, String(error?.message || error), error?.stack)
  }
}

// ---------------------------------------------------------------- jev (opt-in)
/**
 * Jev ranks supplied candidates; it never edits the ledger and never decides
 * that work is fixed. Off unless a project switched it on or a call asked for
 * it, and every fault returns the ordinary answer with a short reason.
 *
 * Both plugins are loaded here, lazily, so the CLI starts and answers every
 * other verb without them.
 */
if (op.startsWith('jev.')) {
  await (async () => {
    const jev = await import('../plugins/builtin/jev/context.mjs')
    const { DECISIONS_MODEL } = await import('../plugins/builtin/openrouter/decisions.mjs')
    const { pluginGuides } = await import('../engine/plugin-guides.mjs')
    const request = args[0] && typeof args[0] === 'object' ? args[0] : {}
    const spoken = typeof args[0] === 'string' ? args[0] : ''
    const { key, where } = await jev.readProjectKey(PROJECT)
    const state = {
      enabled: await jev.storedMode(PROJECT), model: DECISIONS_MODEL,
      proxy: Boolean(process.env.OPENROUTER_PROXY_URL),
      key: { found: key !== null, where, last4: key ? key.slice(-4) : null }
    }

    if (op === 'jev.mode') {
      if (typeof request.on === 'boolean') {
        const file = path.join(PROJECT, jev.MODE_FILE)
        await fs.promises.mkdir(path.dirname(file), { recursive: true })
        await fs.promises.writeFile(file, jev.modeText(request.on), 'utf8')
        state.enabled = request.on
      }
      out(state)
      stop(0)
      return
    }

    if (op === 'jev.status') {
      out(state)
      stop(0)
      return
    }

    if (op !== 'jev.guides' && op !== 'jev.records') {
      die(1, `no jev op "${op}". Try jev.status, jev.mode, jev.guides, or jev.records`)
    }
    if (!key) die(1, 'no OpenRouter key is set; export OPENROUTER_API_KEY or store one with openrouter.key')

    if (op === 'jev.guides') {
      const task = String(request.task || spoken).trim()
      if (!task) die(1, 'say what the task is:  jev.guides \'{"task":"make the level look better"}\'')
      const guides = await pluginGuides(CHECKOUT, PROJECT)
      const readGuide = (scope, file) => fs.promises.readFile(path.join(scope === 'engine' ? CHECKOUT : PROJECT, file), 'utf8')
      const candidates = await jev.allGuideCandidates(guides, readGuide, request.candidateLimit)
      if (!candidates.length) {
        out({ task, asked: 0, suggestions: [], why: 'no enabled plugin guide declares a description' })
        stop(0)
        return
      }
      const result = await jev.rankGuides({ task, files: request.files || [], candidates, key, minimum: request.minimum, limit: request.limit })
        .catch(error => die(1, `Jev could not rank guides: ${String(error?.message || error)}`))
      out({ task, where, model: result.model, asked: result.asked, suggestions: result.ranked, dropped: result.dropped, usage: result.usage })
      stop(0)
      return
    }

    const text = String(request.text || spoken).trim()
    if (!text) die(1, 'say what the finding is:  jev.records \'{"text":"..."}\'')
    const records = [...foldPain(), ...foldInsights()]
    const candidates = jev.recordShortlist(text, records, request.candidateLimit)
    if (!candidates.length) {
      out({ text, asked: 0, suggestions: [], why: 'no open record shares a word with the finding' })
      stop(0)
      return
    }
    const result = await jev.rankRecords({ finding: text, candidates, key, minimum: request.minimum, limit: request.limit })
      .catch(error => die(1, `Jev could not rank records: ${String(error?.message || error)}`))
    out({ text, where, model: result.model, asked: result.asked, suggestions: result.ranked, dropped: result.dropped, usage: result.usage })
    stop(0)
  })()
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
  const { buildIndex } = await readProject()
  const { problemsIn, fatal, pluginImportFailures, pluginProblems } = await import('../engine/project-problems.mjs')
  // A plugin that will not import is listed first because it is the loudest
  // thing wrong and the quietest to find: the loader carries on without it, so
  // the only symptom anywhere else is a command that has stopped existing.
  //
  // The failures are found by importing the files off disk, because `check`
  // answers with nothing running and a world it never booted has no loader to
  // ask.
  const failed = await pluginImportFailures(CHECKOUT, PROJECT)
  // What a fresh agent reads before its first call: the generated files against
  // their source, and every plugin's guide against the commands it registers.
  // These are the only problems whose cost falls entirely on an agent — a stale
  // guide is read all session and there is no second chance to correct it.
  const { agentRegistrationProblems } = await import('../engine/agent-registration.mjs')
  // The kernel gate — format, lint, Trellis and Codemap — runs on every check,
  // so an agent that only runs `check` still meets `agents/code-style.md`.
  const { kernelGateProblems } = await import('../scripts/kernel-gate.mjs')
  const problems = [
    ...await kernelGateProblems(CHECKOUT),
    ...pluginProblems(failed),
    // Building without writing saves the serialized index characters and leaves
    // no half-fresh artifact for the `index` route or a boot to disagree with;
    // the project alone decides every problem below.
    ...problemsIn(await buildIndex(PROJECT, undefined, { write: false })),
    ...await agentRegistrationProblems(CHECKOUT, PROJECT)
  ]

  // Warnings are reported and never fail the run. A warning that broke the
  // chain would be turned off, and then it reports nothing at all.
  const failures = fatal(problems)
  out({ ok: failures.length === 0, problems })
  process.exit(failures.length === 0 ? 0 : 1)
}

/**
 * Run only the core test areas a change needs.
 *
 * Files come from the words after `test`, or from git when there are none.
 * The map from kernel file to area is measured by `npm run test:areas`, so a
 * change runs the areas that call the changed code, not the whole suite.
 */
if (op === 'test') {
  const { readAreaMap, areasForFiles, changedFiles } = await import('../scripts/test-areas.mjs')
  const map = readAreaMap(CHECKOUT)
  if (!map) {
    out({ ok: false, error: 'no test area map: run npm run test:areas' })
    process.exit(1)
  }
  const files = words.length ? words.map(word => word.split('\\').join('/')) : changedFiles(CHECKOUT)
  const selected = areasForFiles(map, files)
  if (!selected.length) {
    out({ ok: true, areas: [], files, why: 'no core test area covers these files' })
    process.exit(0)
  }
  for (const { area, why } of selected) process.stderr.write(`[test] ${area}: ${why}\n`)
  const testFiles = selected.flatMap(({ area }) => map.areas[area])
  const { spawnSync } = await import('node:child_process')
  const run = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: CHECKOUT, stdio: 'inherit' })
  process.exit(run.status ?? 1)
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
      const client = typeof args[0] === 'string' ? args[0] : null
      finish(await browsers.stopLaneBrowsers(CHECKOUT, client === 'all' ? null : client, { all: client === 'all' }))
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
    die(2, `cannot reach the dev server at ${host}. Start one through the supervisor: `
      + 'node bin/engine.mjs supervisor.start, then supervisor.open dev-server', String(error))
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
  const { listServers, stopServers } = await import('../engine/project-servers.mjs')
  const named = typeof args[0] === 'number' ? args[0] : flags.port ? Number(flags.port) : null
  if (op === 'servers') {
    // The default port is asked about whether or not a record mentions it. A
    // server nobody wrote down, sitting where every command looks by default,
    // is the one an agent cannot otherwise see.
    const listed = await listServers(CHECKOUT, [Number(flags.port || PORT)])
    // A record for a server whose process is gone is litter. Keeping it makes
    // a person read four dead ports to find the one live one, so it is dropped
    // once the port has been asked and the process proved absent. A process that
    // is alive is kept whatever its port says: a server still binding answers
    // nothing, and dropping its record made a live start read as litter.
    // `--all` keeps them.
    const gone = (listed.servers || []).filter(entry => entry.pid && !entry.processAlive)
    if (gone.length && !flags.all) {
      const { forgetServer } = await import('../engine/project-servers.mjs')
      for (const entry of gone) {
        try { forgetServer(CHECKOUT, entry.port, entry.pid) } catch { /* already gone */ }
      }
      listed.servers = (listed.servers || []).filter(entry => entry.alive || !entry.pid)
      listed.forgot = gone.map(entry => ({ port: entry.port, why: entry.why }))
    }
    out(listed)
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
        + `Name the one to stop, say "servers.stop all" to take them all down, `
        + `or use the supervisor: node bin/engine.mjs supervisor.stop all.`)
    }
  }
  const result = await stopServers(CHECKOUT, named)
  out(result)
  // Non-zero only when something was asked for and is still running, so a
  // cleanup step in a shell chain fails exactly when cleanup did not happen.
  process.exit(result.ok ? 0 : 1)
}

/**
 * Start the supervisor as a detached background process.
 *
 * `engine/supervisor.mjs` exports `startSupervisor` but has no entry of its
 * own, and this checkout keeps no launcher file for it. The entry is `-e`:
 * one line that imports the module and calls it. Output is ignored because a
 * detached process outlives this one, and this one waits on `/health` anyway.
 */
function startSupervisorProcess(checkout) {
  const moduleUrl = pathToFileURL(path.join(REPO, 'engine/supervisor.mjs')).href
  const entry = `import { startSupervisor } from ${JSON.stringify(moduleUrl)}; `
    + 'startSupervisor(process.argv[1]).catch(error => { console.error(error); process.exit(1) })'
  const child = spawn(process.execPath, ['--input-type=module', '-e', entry, checkout], {
    detached: true, stdio: 'ignore', windowsHide: true
  })
  child.unref()
  return child
}

/**
 * The supervisor: one process that owns every engine instance here.
 *
 * It answers over HTTP on a loopback port, and its record names that port. The
 * record is a note; `GET /health` is the evidence, so a stale file naming a
 * dead port is not reported up. These verbs need no editor and no dev server:
 * the question "what is running" is worst to answer when nothing is.
 */
if (op === 'desktop') {
  try {
    const { askSupervisor } = await import('../engine/supervisor.mjs')
    const action = args[0] || 'snapshot'
    const details = typeof args[1] === 'object' ? args[1] : args[1] ? JSON.parse(args[1]) : {}
    finish(await askSupervisor(CHECKOUT, 'POST', '/desktop', { ...details, action }, 30000))
  } catch (error) { die(1, error.message) }
}

if (op === 'supervisor' || op === 'supervisor.start' || op === 'supervisor.open' || op === 'supervisor.stop') {
  const supervisor = await import('../engine/supervisor.mjs')
  const START = 'node bin/engine.mjs supervisor.start'
  const down = () => die(2, `no supervisor is running for ${CHECKOUT}; start one with \`${START}\``)
  const pause = () => new Promise(resolve => setTimeout(resolve, 250))
  // A dev server binds only after Vite has read the checkout and optimised its
  // dependencies, which can be minutes on a cold start. The open waits for the
  // instance to answer; a listing and a stop are quick.
  const OPEN_TIMEOUT = 180_000
  const LIST_TIMEOUT = 15_000
  const STOP_TIMEOUT = 30_000

  if (op === 'supervisor') {
    const live = await supervisor.supervisorAddress(CHECKOUT)
    if (!live) down()
    if (flags.watch) {
      // The same table the front door shows. A person gets keys; a stream gets
      // the table once, so an agent can read it from a pipe.
      const { watchSupervisor } = await import('../engine/supervisor-watch.mjs')
      try {
        await watchSupervisor(CHECKOUT)
        process.exit(0)
      } catch (error) {
        die(2, `the supervisor on port ${live.port} stopped answering: ${error.message}`)
      }
    }
    try {
      const health = await supervisor.askSupervisor(CHECKOUT, 'GET', '/health', null, LIST_TIMEOUT)
      const listed = await supervisor.askSupervisor(CHECKOUT, 'GET', '/instances', null, LIST_TIMEOUT)
      out({ up: true, port: live.port, pid: live.pid, startedAt: health.startedAt, instances: listed.instances })
      process.exit(0)
    } catch (error) {
      die(2, `the supervisor on port ${live.port} stopped answering: ${error.message}`)
    }
  }

  if (op === 'supervisor.start') {
    const already = await supervisor.supervisorAddress(CHECKOUT)
    if (already) {
      out({ up: true, port: already.port, pid: already.pid, started: false })
      process.exit(0)
    }
    startSupervisorProcess(CHECKOUT)
    for (let attempt = 0; attempt < 80; attempt++) {
      const live = await supervisor.supervisorAddress(CHECKOUT)
      if (live) {
        out({ up: true, port: live.port, pid: live.pid, started: true })
        process.exit(0)
      }
      await pause()
    }
    die(1, `the supervisor did not answer within 20 seconds; its output went nowhere. `
      + `Run \`${START}\` in a terminal to see why`)
  }

  if (op === 'supervisor.open') {
    const kinds = ['dev-server', 'editor-browser', 'lane-browser', 'headless-session']
    const kind = typeof args[0] === 'string' ? args[0] : null
    if (!kind) die(1, `usage: supervisor.open <${kinds.join('|')}> [json request]`)
    if (!kinds.includes(kind)) die(1, `"${kind}" is not an instance kind; expected ${kinds.join(', ')}`)
    // The optional argument is merged into the request, the same as every
    // other JSON argument here: `{ kind, ...request }`.
    const request = args[1] && typeof args[1] === 'object' ? args[1] : {}
    if (!await supervisor.supervisorAddress(CHECKOUT)) down()
    try {
      out(await supervisor.askSupervisor(CHECKOUT, 'POST', '/instances', { kind, ...request }, OPEN_TIMEOUT))
      process.exit(0)
    } catch (error) {
      die(1, String(error?.message || error))
    }
  }

  if (op === 'supervisor.stop') {
    const target = typeof args[0] === 'string' ? args[0] : 'all'
    const live = await supervisor.supervisorAddress(CHECKOUT)
    if (!live) down()
    try {
      if (flags.down) {
        // The supervisor writes its reply before it closes the door, so wait
        // for the record to go before calling it down.
        const answer = await supervisor.askSupervisor(CHECKOUT, 'POST', '/shutdown', null, STOP_TIMEOUT)
        let up = true
        for (let attempt = 0; attempt < 40; attempt++) {
          if (!await supervisor.supervisorAddress(CHECKOUT)) { up = false; break }
          await pause()
        }
        out({ stopped: answer.stopped, up })
        process.exit(up ? 1 : 0)
      }
      const answer = target === 'all'
        ? await supervisor.askSupervisor(CHECKOUT, 'DELETE', '/instances', null, STOP_TIMEOUT)
        : await supervisor.askSupervisor(CHECKOUT, 'DELETE', `/instances/${encodeURIComponent(target)}`, null, STOP_TIMEOUT)
      // Ask again: only what the listing no longer names is stopped. A leftover
      // instance leaves exit 1, so a cleanup step fails exactly when it should.
      const listed = await supervisor.askSupervisor(CHECKOUT, 'GET', '/instances', null, LIST_TIMEOUT)
      const running = listed.instances
        .filter(entry => target === 'all' ? entry.owned : entry.id === target)
        .map(entry => entry.id)
      out({
        stopped: answer.stopped,
        // A repeat stop is a success that says so, rather than a 404 that reads
        // as a wrong id.
        ...(answer.alreadyStopped?.length ? { alreadyStopped: answer.alreadyStopped } : {}),
        running
      })
      process.exit(running.length === 0 ? 0 : 1)
    } catch (error) {
      die(1, String(error?.message || error))
    }
  }
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
/**
 * Boot a world of this process's own, and send anything the engine prints to
 * stderr.
 *
 * stdout carries one JSON value per reply, so a log line written there makes the
 * reply unparseable — a caller that strips log lines out of the result is a
 * caller that will eventually strip the wrong one. `--headless` and `serve` need
 * the same world and the same redirect, so they boot it here rather than twice.
 */
async function startPrivateWorld() {
  const original = console.log
  const toStderr = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')
  console.log = toStderr
  console.warn = toStderr
  // console.info writes to stdout by default in node; it must join the redirect.
  console.info = toStderr

  const { startWorldInNode, writesRefusedHere } = await import('../engine/start-world-node.mjs')

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

  return { engine, editor, original, writesRefusedHere }
}

/**
 * One headless world, many ops: a session rather than a command.
 *
 * `--headless` boots a world per invocation, and that boot is most of what an
 * agent's look-decide-act loop costs. A session holds one world open and reads
 * requests from stdin, so the twentieth question pays nothing the first did not.
 *
 * An op is a method on the engine, or a dotted path to one — `editor.loadLevel`,
 * `loop.step` — because the engine already hands out those handles, and a
 * session that could not open a level would need a second session per level.
 */
if (op === 'serve') {
  const { engine, writesRefusedHere } = await startPrivateWorld()
  const readline = await import('node:readline')

  // Refusals already reported, so one refused write is not repeated on every
  // later reply. `writesRefusedHere` returns the whole list, oldest first.
  let reported = 0
  const newRefusals = () => {
    const all = writesRefusedHere()
    const fresh = all.slice(reported)
    reported = all.length
    return fresh
  }

  /** One reply. A refused write is named in it, because it must not read as done. */
  const reply = value => {
    const refusals = newRefusals()
    if (!refusals.length) return out(value === undefined ? { ok: true } : value)
    const named = refusals.map(refusal => refusal.file)
    out(value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value, refusedWrites: named }
      : { value, refusedWrites: named })
  }

  const methodAtPath = (path, from) => path.reduce((value, key) => value?.[key], from)

  for await (const line of readline.createInterface({ input: process.stdin })) {
    const text = line.trim()
    if (!text) continue
    let request
    try { request = JSON.parse(text) }
    catch (error) { out({ error: `not JSON: ${error.message}` }); continue }
    if (request.op === 'exit') break

    const path = String(request.op || '').split('.')
    const verb = methodAtPath(path, engine)
    if (typeof verb !== 'function') { out({ error: `no op "${request.op}"` }); continue }
    const owner = path.length > 1 ? methodAtPath(path.slice(0, -1), engine) : engine

    try { reply(await verb.apply(owner, request.args || [])) }
    catch (error) { out({ error: String(error?.message || error) }) }
  }

  // Not `process.exit()`: a session that stepped a solver would assert on the way out,
  // and the last reply is already written. The driver is stopped first, because a session
  // that played would otherwise hold the process open for ever.
  engine.loop?.stop()
  stop(0)
}

if (flags.headless) {
  const { engine, original, writesRefusedHere } = await startPrivateWorld()

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
    // A world left in play mode holds its own frame timer, and the op that put it there
    // has answered: the driver has nothing left to do, and nothing else would end it.
    engine.loop?.stop()
    finish(results.map(result => result === undefined ? { ok: true } : result))
  }

  // Only reached when the op above answered nothing. `script` finishes inside its own
  // block, and without this guard the file would keep going and die on "no op script"
  // after having answered — which is exactly what it did.
  if (!finished) {
    const verb = engine[op]
    if (typeof verb !== 'function') {
      die(1, `no op "${op}" — every op is a method on the engine. Try: node bin/engine.mjs --headless commands`)
    }

    let result
    try { result = await verb.apply(engine, args) }
    catch (e) { die(1, String(e?.message || e), e?.stack) }

    console.log = original
    failOnRefusedWrite()
    // The op may have started play, and a world in play mode holds its own frame timer.
    // Leaving it running would keep the process alive with nothing left to answer.
    engine.loop?.stop()
    finish(result)
  }
}

if (op === 'watch' && !finished) {
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

// The live path: an op that drives the editor through the dev server. Only reached when
// nothing above answered — an answered op has set `finished` and has no server to call.
if (!finished) {
  // `simulate 60` legitimately takes a while, so give the wall clock room.
  const ms = op === 'simulate' ? Math.max(timeout, 2000 + Number(words[0] || 1) * 1000) : timeout

  const result = await call(op, args, ms)
  finish(result)
}
