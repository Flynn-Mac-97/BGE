/**
 * A fan-out of agents, run by hand. Not a test, and deliberately not in `test/`.
 *
 * It is a measurement and a hunt, not an assertion: it opens a dozen worlds and spawns
 * two dozen processes, takes ten seconds, and what it finds is a report to read rather
 * than a pass or a fail. The suite covers the invariants it checks — `rewind.test.mjs`,
 * `state-hash.test.mjs`, `rapier-worlds.test.mjs`, and the exit-code case in
 * `cli.offline.test.mjs` — at a thousandth of the cost. Nothing that runs on every
 * change should be a fan-out.
 *
 * What it is for is the question the suite cannot ask: several agents, working at once in
 * one checkout, each driving many worlds and processes, getting the same answers as one
 * agent working alone, and being told clearly when they cannot do something.
 *
 *   the same level and steps in two processes    one state hash
 *   worlds in one process, interleaved           the world run alone
 *   a wave of headless processes                 one answer each, and a project index
 *                                                that still parses
 *   an agent killed mid-run                      the others still answer
 *   a refusal                                    names the thing it refused
 *   memory                                       measured per world, and stopped short
 *                                                of the machine rather than at it
 *
 * The children are plain node processes running deterministic work loops. Nothing here
 * calls a model, and nothing here spends a token.
 *
 * Four agents, because the number of agents is not the interesting axis — the number of
 * worlds and processes they drive is. Each agent reports its own peak memory, and the
 * parent stops a crowd before the machine is out of room.
 *
 * Usage: node tools/fanout/harness.mjs [--rounds N] [--waves N] [--row N] [--worlds N] [--keep]
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { temporaryProject } from '../../test/fixture-project.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECKOUT = path.resolve(HERE, '../..')
const AGENT = path.join(HERE, 'agent.mjs')
const CLI = path.join(CHECKOUT, 'bin/engine.mjs')
const STRESS = path.join(CHECKOUT, 'agent-runs/2026-09-12-physics-stress/stress')

const argument = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback
}

const ROUNDS = argument('rounds', 8)
const WAVES = argument('waves', 16)
const ROW = argument('row', 6)
const WORLDS = argument('worlds', 12)
const keep = process.argv.includes('--keep')

/** A level with plenty of bodies in it, written for the test rather than borrowed. */
async function crowdProject(name, count) {
  return temporaryProject({
    'game.json': { title: name, startLevel: 'main', plugins: { disabled: ['Physics 3D', 'Physics 2D'] } },
    'levels/main.json': {
      camera: { at: [0, 4] },
      entities: [
        { type: 'floor', at: [0, -1, 0] },
        ...Array.from({ length: count }, (unused, at) => ({
          type: 'crate',
          at: [(at % 20) * 0.6 - 6, 1 + Math.floor(at / 20) * 0.8, (at % 3) * 0.3]
        }))
      ]
    },
    'types/floor.js': "export default { collider: { box: [16, 0.4, 16] }, properties: { body: 'solid' } }\n",
    'types/crate.js': "export default { collider: { box: [0.5, 0.5, 0.5] }, properties: { body: 'dynamic' } }\n"
  }, `fanout-${name}-`)
}

const crowd = await crowdProject('crowd', 240)

/**
 * Four agents.
 *
 * The worker and the crowd are on the same project, the same level and the same step
 * count, so the parent compares their hashes: two agents, two processes, one answer —
 * and the crowd reached it through thirteen worlds at once, twelve of them stepped turn
 * and turn about.
 */
const roster = [
  { name: 'worker', kind: 'work', project: crowd, level: 'main', rounds: ROUNDS },
  { name: 'crowd', kind: 'crowd', project: crowd, level: 'main', steps: ROUNDS * 30, most: WORLDS },
  { name: 'processes', kind: 'processes', project: crowd, level: 'main', atOnce: WAVES, inARow: ROW, steps: 60 },
  { name: 'faults', kind: 'faults', project: STRESS, level: 'flat-200' }
]

// Reports go to a scratch directory rather than into the checkout: a test that writes
// into the tree it is testing leaves files behind when it fails.
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-fanout-'))
const scratch = path.join(runDirectory, 'scratch')
await fs.mkdir(scratch, { recursive: true })

const freeMemoryMb = () => Math.round(os.freemem() / 1024 / 1024)
const startedAll = Date.now()
const freeBefore = freeMemoryMb()

// All four at once. A roster launched in waves measures the waves.
const children = roster.map(agent => {
  const report = path.join(runDirectory, `${agent.name}.json`)
  const child = spawn(process.execPath, [AGENT, JSON.stringify({ ...agent, report, scratch })], {
    cwd: CHECKOUT,
    stdio: 'ignore',
    env: { ...process.env },
    windowsHide: true
  })
  return { agent, child, report }
})

await Promise.all(children.map(({ child }) => new Promise(resolve => child.on('exit', resolve))))
const wallMs = Date.now() - startedAll

const reports = []
for (const { agent, report } of children) {
  try { reports.push(JSON.parse(await fs.readFile(report, 'utf8'))) }
  catch (error) { reports.push({ agent: agent.name, kind: agent.kind, ok: false, problems: [`no report — ${error.message}`], ms: 0 }) }
}

/**
 * Two agents ending on the same count of the same level must agree.
 *
 * Independent processes, one checkout, one set of engine modules — and in this case one
 * of the two got there through twelve worlds at once.
 */
const byLevel = new Map()
for (const report of reports) {
  if (!report.ok || report.hash === undefined) continue
  const key = `${report.project}|${report.level}|${report.steps}`
  if (!byLevel.has(key)) byLevel.set(key, [])
  byLevel.get(key).push(`${report.agent}=${report.hash}`)
}
const agreements = [...byLevel.entries()].filter(([, members]) => members.length > 1)
const disagreements = agreements.filter(([, members]) => new Set(members.map(one => one.split('=')[1])).size > 1)

// Every project the agents read is still a project.
const indexProblems = []
for (const project of [STRESS, crowd]) {
  try { JSON.parse(await fs.readFile(path.join(project, '.engine/index.json'), 'utf8')) }
  catch (error) { indexProblems.push(`${path.basename(project)}: ${error.message}`) }
}

// One more process, alone, after all of it: the checkout still works.
const afterAll = await new Promise(resolve => {
  const at = Date.now()
  const child = spawn(process.execPath, [CLI, '--headless', '--project', crowd, 'snapshot'], { cwd: CHECKOUT, stdio: 'ignore', windowsHide: true })
  child.on('exit', code => resolve({ code, ms: Date.now() - at }))
})

const failed = reports.filter(report => !report.ok)
const worlds = reports.reduce((total, report) => total + (report.worlds || 0), 0)
const processes = reports.reduce((total, report) => total + (report.processes || 0), 0)
const ops = reports.reduce((total, report) => total + (report.ops || 0), 0)

const summary = {
  at: stamp,
  wallMs,
  agents: reports.length,
  worldsOpened: worlds,
  processesSpawned: processes,
  ops,
  peakAgentRssMb: Math.max(...reports.map(report => report.rssMb || 0)),
  freeMemoryMb: { before: freeBefore, after: freeMemoryMb() },
  agreements,
  disagreements,
  indexProblems,
  afterAll,
  failed: failed.map(one => ({ agent: one.agent, problems: one.problems })),
  agentsDetail: reports
}

await fs.writeFile(path.join(runDirectory, 'report.json'), JSON.stringify(summary, null, 2), 'utf8')

process.stdout.write(`${reports.length} agents, ${worlds} worlds, ${processes} headless processes, ${ops} ops, ${wallMs} ms\n`)
process.stdout.write(`peak agent rss ${summary.peakAgentRssMb} MB · free memory ${freeBefore} MB -> ${freeMemoryMb()} MB\n`)
for (const report of reports) {
  const verdict = report.ok ? 'ok  ' : 'FAIL'
  const extra = [
    report.worlds ? `${report.worlds} worlds${report.stoppedBeforeTheCap ? ` (stopped at the ${WORLDS} cap)` : ''}` : null,
    report.processes ? `${report.processes} processes (${report.atOnceMsAverage} ms each in a wave, ${report.inARowMsAverage} ms in a row)` : null,
    report.rssPerWorldMb ? `${report.rssPerWorldMb} MB a world, peak ${report.rssMbPeak} MB` : null,
    report.refusals ? `${report.refused}/${report.refusals} refusals named the thing` : null,
    report.killedExit !== undefined ? `killed child exit ${report.killedExit}` : null
  ].filter(Boolean).join(' · ')
  process.stdout.write(`  ${verdict} ${report.agent.padEnd(10)} ${String(report.ms).padStart(6)} ms  ${extra}\n`)
  for (const problem of report.problems || []) process.stdout.write(`         ${problem}\n`)
}
for (const [key, members] of agreements) process.stdout.write(`  agree ${key}: ${members.join(' ')}\n`)
for (const [key, members] of disagreements) process.stdout.write(`  DISAGREE ${key}: ${members.join(' ')}\n`)
for (const one of indexProblems) process.stdout.write(`  INDEX ${one}\n`)
process.stdout.write(`  one more process after all of it: exit ${afterAll.code} in ${afterAll.ms} ms\n`)
process.stdout.write(`report: ${path.join(runDirectory, 'report.json')}\n`)

const bad = failed.length + disagreements.length + indexProblems.length + (afterAll.code === 0 ? 0 : 1)
if (!keep) await fs.rm(runDirectory, { recursive: true, force: true }).catch(() => {})
await fs.rm(crowd, { recursive: true, force: true })

// Not `process.exit()`: this process booted worlds, and a world that stepped a Rapier
// body makes an exit assert on Windows. The code is what a caller reads either way.
process.exitCode = bad ? 1 : 0
