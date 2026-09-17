/**
 * One agent in the fan-out, with as many headless processes as it needs.
 *
 * Four shapes of work, because they are the four ways a fan-out can fail:
 *
 *   work       the loop an agent lives in, and the invariants that make it trustworthy
 *   processes  many one-shot headless processes, at once and in a row
 *   crowd      many worlds inside one process, interleaved
 *   faults     the refusals, because a message that does not name the thing costs more
 *              than no message at all
 *
 * A report goes to a file rather than to stdout: a fan-out of children piping their logs
 * into one parent deadlocks on the first reply bigger than a pipe buffer, and the
 * deadlock looks like a hung engine.
 *
 * Run by `tools/fanout/harness.mjs`, which is a by-hand tool and not a test. The work
 * here is a plain node process running a deterministic loop: no model is called and no
 * token is spent.
 *
 * Usage: node tools/fanout/agent.mjs '<config json>'
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { stateHash } from '../../engine/world.js'
import { temporaryProject } from '../../test/fixture-project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECKOUT = path.resolve(HERE, '../..')
const CLI = path.join(CHECKOUT, 'bin/engine.mjs')

const config = JSON.parse(process.argv[2])
const problems = []
const started = process.hrtime.bigint()
const ms = () => Math.round(Number(process.hrtime.bigint() - started) / 1e6)
const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024)
const fail = (what, detail) => problems.push(detail === undefined ? what : `${what} — ${detail}`)

const open = async (project, level) => {
  const surface = await startWorldInNode({ root: CHECKOUT, project })
  if (level) await surface.editor.loadLevel(level)
  return surface
}

const snapshotOf = context => ({
  steps: context.loop.steps,
  hash: stateHash(context.world),
  entities: context.world.entities.length
})

/**
 * The loop an agent lives in: simulate, look, go back, simulate again, agree.
 *
 * Every round checks that the cheap read carries the same data as the expensive one —
 * a projection that quietly drops a field is worse than none — and that a rewind
 * followed by the same steps lands on the hash the run had, which is the one invariant
 * that proves the clock, the stream and the solver all came back.
 */
async function work({ project, level, rounds }) {
  const surface = await open(project, level)
  const { engine, loop, world } = surface
  let ops = 0
  let rewinds = 0
  let everChanged = false

  for (let round = 0; round < rounds; round++) {
    const rows = engine.snapshot({ entities: true }); ops++
    const columns = engine.snapshot({ entities: ['id', 'at'] }); ops++
    if (!Array.isArray(columns.entities?.columns)) fail('projected entities came back as rows')
    else {
      if (columns.entities.columns.join(',') !== 'id,at') fail('the columns are not the ones asked for', columns.entities.columns.join(','))
      if (columns.entities.rows.length !== rows.entities.length) fail('the projection lost rows', `${columns.entities.rows.length} of ${rows.entities.length}`)
      const wrong = columns.entities.rows.findIndex((row, at) => row[0] !== rows.entities[at].id || JSON.stringify(row[1]) !== JSON.stringify(rows.entities[at].at))
      if (wrong >= 0) fail('a projected row is not the row it stands for', `row ${wrong}`)
      if (columns.counts.entities !== rows.entities.length) fail('the count disagrees with the list', `${columns.counts.entities} vs ${rows.entities.length}`)
    }

    const before = loop.steps
    const wasThere = stateHash(world)
    engine.simulate(0.5); ops++

    // The clock is what has to move every time. The WORLD does not: a scene of bodies that
    // have settled goes to sleep, and thirty steps of a sleeping scene are thirty steps of
    // nothing. What the hash checks is that the run changed at least once, so the
    // comparisons below are not two readings of a world that never moved.
    if (loop.steps - before !== 30) {
      fail('the clock did not advance by the half second asked for', `step ${before} to ${loop.steps}, held by ${JSON.stringify(loop.holds)}`)
    }
    const ranOn = stateHash(world)
    if (ranOn !== wasThere) everChanged = true

    const back = engine.stepBack(30); ops++
    if (!back.reached) fail('the rewind did not land', JSON.stringify(back))
    else if (loop.steps !== before) fail('the rewind landed on the wrong count', `${loop.steps} wanted ${before}`)
    rewinds++

    engine.simulate(0.5); ops++
    if (stateHash(world) !== ranOn) fail('the replay is not the run', `step ${loop.steps}`)

    const described = await engine.run('see.describe', {}); ops++
    if (!described || typeof described !== 'object') fail('see.describe answered nothing')
  }

  if (!everChanged) fail('nothing in this run ever changed, so every comparison here is vacuous')

  const marks = engine.marks(); ops++
  if (marks.stride === undefined) fail('the ring does not say its stride')

  return { ops, rewinds, ...snapshotOf(surface), rssMb: rssMb() }
}

/**
 * Many one-shot headless processes: at once, then in a row.
 *
 * This is the shape an agent without a session uses, so what it costs and whether the
 * shared project survives it are both worth knowing. Each child writes its reply to its
 * own file, so nothing comes back through a pipe and fifty of them cannot deadlock.
 *
 * One is killed mid-run. The rest must answer, the project's index must still read, and
 * a fresh process afterwards must start — a fan-out where a cancelled agent takes the
 * others down with it is worse than no fan-out.
 */
async function processes({ project, level, atOnce, inARow, steps, scratch }) {
  const directory = path.join(scratch, 'children')
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })

  const script = JSON.stringify([['simulate', steps / 60], ['snapshot', { entities: ['id', 'at'] }]])
  const costs = []
  let reference = null

  const once = index => new Promise(resolve => {
    const out = path.join(directory, `${index}.json`)
    const err = path.join(directory, `${index}.err`)
    const at = process.hrtime.bigint()
    const fd = fsSync.openSync(out, 'w')
    const errFd = fsSync.openSync(err, 'w')
    const child = spawn(process.execPath, [CLI, '--headless', '--project', project, ...(level ? ['--level', level] : []), 'script', script],
      { cwd: CHECKOUT, stdio: ['ignore', fd, errFd] })
    child.on('exit', (code, signal) => {
      fsSync.closeSync(fd)
      fsSync.closeSync(errFd)
      resolve({ index, code, signal, out, err, ms: Number(process.hrtime.bigint() - at) / 1e6 })
    })
  })

  /** What a process that did not answer said, so a failure is diagnosable rather than a code. */
  const whyItFailed = async one => {
    const said = await fs.readFile(one.err, 'utf8').catch(() => '')
    const reply = await fs.readFile(one.out, 'utf8').catch(() => '')
    return `${said.trim().split('\n').slice(0, 2).join(' | ')}${reply ? ` | out: ${reply.slice(0, 120)}` : ''}`
  }

  const wave = await Promise.all(Array.from({ length: atOnce }, (unused, at) => once(at)))
  for (const one of wave) {
    costs.push(one.ms)
    if (one.code !== 0) { fail(`headless process ${one.index} exited ${one.code ?? one.signal}`, await whyItFailed(one)); continue }
    try {
      const reply = JSON.parse(await fs.readFile(one.out, 'utf8'))
      const shot = reply[1]
      if (!Array.isArray(shot.entities?.columns)) fail(`process ${one.index} answered without the projected list`)
      if (shot.counts.entities !== shot.entities.rows.length) fail(`process ${one.index} disagrees with itself`, `${shot.counts.entities} vs ${shot.entities.rows.length}`)
      reference ??= shot.hash
      if (shot.hash !== reference) fail(`process ${one.index} disagrees with the first`, `${shot.hash} vs ${reference}`)
    } catch (error) { fail(`process ${one.index} reply is not JSON`, error.message) }
  }

  // One killed in flight. The others must not notice, the project must still read, and
  // a fresh process afterwards must start.
  const doomed = spawn(process.execPath, [CLI, '--headless', '--project', project, 'script', JSON.stringify([['simulate', 600], ['snapshot', {}]])],
    { cwd: CHECKOUT, stdio: 'ignore' })
  setTimeout(() => doomed.kill(), 120)
  const killed = await new Promise(resolve => doomed.on('exit', (code, signal) => resolve(code ?? signal)))

  const inRow = []
  for (let at = 0; at < inARow; at++) {
    const one = await once(1000 + at)
    inRow.push(one.ms)
    if (one.code !== 0) fail(`sequential process ${at} exited ${one.code ?? one.signal}`, await whyItFailed(one))
  }

  // A project whose index twenty processes read at once must still parse.
  try { JSON.parse(await fs.readFile(path.join(project, '.engine/index.json'), 'utf8')) }
  catch (error) { fail('the shared project index no longer reads', error.message) }

  const afterTheKill = await once(2000)
  if (afterTheKill.code !== 0) fail(`a process after the kill exited ${afterTheKill.code ?? afterTheKill.signal}`, await whyItFailed(afterTheKill))

  const average = list => Math.round((list.reduce((total, one) => total + one, 0) / list.length) * 100) / 100
  return {
    ops: atOnce + inARow + 2,
    atOnce,
    processes: atOnce + inARow + 2,
    atOnceMsAverage: average(costs),
    inARowMsAverage: average(inRow),
    killedExit: killed,
    afterTheKillCode: afterTheKill.code,
    rssMb: rssMb()
  }
}

/**
 * Many worlds inside one process, interleaved, then one after another.
 *
 * Two things are being measured and one thing checked. Measured: what a world costs in
 * memory, and how many fit before the machine is the problem — the fan-out is bounded
 * by memory, so a number for it is worth more than a limit nobody can reason about.
 * Checked: three worlds in one process answer exactly as one world run alone, which is
 * the shape that once found a solver shared by every world in the process.
 */
async function crowd({ project, level, steps, most }) {
  const alone = await open(project, level)
  alone.loop.step(steps)
  const expected = stateHash(alone.world)

  const before = rssMb()
  const freeBefore = Math.round(os.freemem() / 1024 / 1024)
  const holes = []
  let peak = before
  let stoppedAt = 0
  for (let at = 0; at < most; at++) {
    // Stop while there is room to finish rather than at the crash: an agent that runs
    // the machine out of memory takes every other agent with it.
    if (rssMb() > 1024 || os.freemem() / 1024 / 1024 < 512) { stoppedAt = at; break }
    holes.push(await open(project, level))
    peak = Math.max(peak, rssMb())
  }
  const after = rssMb()
  // The peak and not the last sample: an allocator that hands memory back would make a
  // world look free, and the question is what a world costs while it is held.
  const rssPerWorldMb = Math.round(((peak - before) / Math.max(1, holes.length)) * 10) / 10

  if (holes.length < 2) fail('not enough worlds to interleave', `${holes.length} opened`)
  if (steps % 10) fail('the crowd steps in tens', String(steps))

  // Every world on the schedule, every round of ten steps, and no two in lockstep:
  // even worlds take their ten in one go, odd worlds in two, so a world that is sharing
  // anything with another is stepped while that one is mid-round. A world left out of
  // the schedule would be compared at the level's start.
  const perRound = []
  for (let at = 0; at < holes.length; at++) {
    for (const chunk of (at % 2 ? [3, 7] : [10])) perRound.push([at, chunk])
  }

  let ops = 0
  for (let done = 0; done < steps; done += 10) {
    for (const [at, chunk] of perRound) {
      holes[at].loop.step(chunk)
      ops++
    }
  }

  for (const [at, surface] of holes.entries()) {
    if (stateHash(surface.world) !== expected) fail(`world ${at} of ${holes.length} does not answer as the world run alone`, `${stateHash(surface.world)} vs ${expected}`)
  }

  const listeners = process.listenerCount('unhandledRejection') + process.listenerCount('uncaughtException')
  if (listeners > 4) fail('worlds added process listeners', `${listeners} rejection and exception listeners for ${holes.length + 1} worlds`)

  return {
    ops,
    worlds: holes.length + 1,
    stoppedBeforeTheCap: stoppedAt,
    rssMbBefore: before,
    rssMbPeak: peak,
    rssMbAfter: after,
    rssPerWorldMb,
    freeMemoryMbBefore: freeBefore,
    freeMemoryMbAfter: Math.round(os.freemem() / 1024 / 1024),
    listeners,
    ...snapshotOf(alone)
  }
}

/**
 * The refusals, each of which has to name the thing it refused.
 *
 * An agent that cannot tell "no such level" from "the engine is broken" will debug the
 * wrong thing, and this is where that is caught rather than in a lane at midnight.
 */
async function faults({ project, level }) {
  const surface = await open(project, level)
  const { engine } = surface
  let ops = 0
  const checked = []

  /**
   * A refusal is either a throw or an answer that says it did not happen.
   *
   * `seek` answers — it has a reason to give rather than a call to abort — and a test
   * that only caught throws read that as a seek that worked.
   */
  const refused = async (what, run, mustName) => {
    ops++
    let said = null
    try {
      const answer = await run()
      if (answer && answer.reached === false) said = String(answer.why || 'refused without saying why')
      else { fail(`${what} was not refused`); checked.push({ what, said: null }); return }
    } catch (error) {
      said = String(error?.message || error)
    }
    checked.push({ what, said })
    if (mustName && !said.toLowerCase().includes(String(mustName).toLowerCase())) fail(`${what} does not name ${mustName}`, said.slice(0, 140))
  }

  await refused('a projection of a field that does not exist', () => engine.snapshot({ entities: ['nope'] }), 'id, type, at')
  await refused('a projection asked for as a bare value', () => engine.snapshot('id,at'), 'takes an options object')
  await refused('a command that does not exist', () => engine.run('nothing.likeThis', {}), 'nothing.likeThis')
  await refused('a forward seek', () => engine.seek(9_999_999), 'has not happened')
  await refused('a level that does not exist', () => surface.editor.loadLevel('no-such-level'), 'no-such-level')

  // A ring that has forgotten everything behind the clock: the oldest mark is the only
  // one it has, so a seek below it has to say how far back it can reach.
  surface.loop.step(200)
  surface.context.rewind.clear()
  surface.context.rewind.mark()
  await refused('a seek past the oldest mark', () => engine.seek(10), 'reaches back')

  // And the ones that must NOT be refused.
  ops++
  const marks = engine.marks()
  if (!Array.isArray(marks.marks)) fail('marks does not answer with a list')
  const committed = engine.mark()
  if (typeof committed.steps !== 'number') fail('mark does not answer with a count')

  return { ops, refusals: checked.length, refused: checked.filter(one => one.said).length, ...snapshotOf(surface), rssMb: rssMb() }
}

const KINDS = { work, processes, crowd, faults }

let report
try {
  const kind = KINDS[config.kind]
  if (!kind) throw new Error(`no scenario "${config.kind}"`)
  // The work runs first: an `ok` computed before it would say a scenario passed while
  // the problems it found were still being collected.
  const result = await kind(config)
  report = {
    agent: config.name,
    kind: config.kind,
    project: path.basename(config.project || ''),
    level: config.level || null,
    ok: problems.length === 0,
    problems,
    ms: ms(),
    rssMb: rssMb(),
    ...result
  }
} catch (error) {
  report = {
    agent: config.name,
    kind: config.kind,
    ok: false,
    problems: [`threw — ${error?.message || error}`, ...(error?.stack ? [String(error.stack).split('\n')[1].trim()] : [])],
    ms: ms(),
    rssMb: rssMb()
  }
}

await fs.writeFile(config.report, JSON.stringify(report, null, 2), 'utf8')
