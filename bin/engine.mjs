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
import { fileURLToPath } from 'node:url'

const PORT = process.env.ENGINE_PORT || 5180
const HOST = process.env.ENGINE_HOST || `http://localhost:${PORT}`

/**
 * Where friction gets written down.
 *
 * Anchored to the repo rather than the working directory, so `pain` records the
 * same file no matter where it was run from. Append-only: two agents working at
 * once both get their line, and nothing rewrites what came before.
 */
const PAIN_FILE = fileURLToPath(new URL('../painpoints.jsonl', import.meta.url))

const HELP = `engine — read and drive the running editor

  node bin/engine.mjs <op> [args...]

state     snapshot [--entities --log --plugins --commands --timers]
          entity <id>          index          tree
          check                exits 1 if anything is broken or nondeterministic
drive     select <id...>       set <id> <key> <value>
          spawn <type> ['{"at":[1,2,0]}']     destroy <id>
          run <command-id> [arg]              commands
run       play    stop    simulate <seconds>    seed <n>
debug     errors    log [n]    watch    eval '<js>'
friction  pain "<what was hard or expensive>" [--kind engine|cli|docs|editor]
               [--cost <tokens>] [--reads <n>] [--where path] [--fix "..."]
          pain.list [--all]    pain.resolve <id> "<what you did>"

Args that parse as JSON are sent as JSON, everything else as a string.
Flags (--foo) collect into a trailing options object.

  --headless     run the op in a private world in this process — no dev server,
                 no browser, no port. Many of these run at once without ever
                 seeing each other, which is how several agents work in parallel.
  --level NAME   headless only: open this level first
  --port N       default ${PORT}, or set ENGINE_PORT
  --timeout MS   default 8000
  --raw          force one-line JSON      --pretty  force indented
                 (default: indented at a terminal, compact when captured)

Exit 0 ok, 1 error, 2 no editor attached (open ${HOST}).

index, tree, check and pain read the project straight off disk, so they answer
with nothing running. Everything else drives a live editor unless --headless
says to start a world here instead.

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
const VALUE_FLAGS = new Set(['port', 'timeout', 'kind', 'where', 'fix', 'cost', 'reads', 'level', 'root'])

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
                 'headless', 'level', 'root']) delete options[k]

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

// Always JSON, including bare strings. A caller that has to guess whether the
// output is quoted has to parse two formats, and that is the caller's bug to
// hit at the worst moment.
const out = v => process.stdout.write(JSON.stringify(v, null, pretty ? 2 : 0) + '\n')

function die(code, message, detail) {
  process.stderr.write(message + '\n')
  if (detail && flags.verbose) process.stderr.write(detail + '\n')
  process.exit(code)
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
const PROJECT = fileURLToPath(new URL('../project/', import.meta.url))
const readProject = async () => import('../engine/project-index.mjs')

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
  const { buildIndex, problemsIn } = await readProject()
  const problems = problemsIn(await buildIndex(PROJECT))
  out({ ok: problems.length === 0, problems })
  process.exit(problems.length === 0 ? 0 : 1)
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
  console.log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')
  console.warn = console.log

  const { startWorldInNode } = await import('../engine/start-world-node.mjs')
  let engine, editor
  try {
    ({ engine, editor } = await startWorldInNode({ root: typeof flags.root === 'string' ? flags.root : REPO }))
  } catch (e) {
    console.log = original
    die(1, `could not start a world — ${e.message}`, e.stack)
  }

  if (typeof flags.level === 'string') {
    try { await editor.loadLevel(flags.level) }
    catch (e) { die(1, `no level "${flags.level}" — ${e.message}`) }
  }

  const verb = engine[op]
  if (typeof verb !== 'function') {
    die(1, `no op "${op}" — every op is a method on the engine. Try: node bin/engine.mjs --headless commands`)
  }

  let result
  try { result = await verb.apply(engine, args) }
  catch (e) { die(1, String(e?.message || e), e?.stack) }

  console.log = original
  out(result === undefined ? { ok: true } : result)
  // The loop may hold a timer open. The op is done, so leave rather than wait.
  process.exit(0)
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
out(result === undefined ? { ok: true } : result)
