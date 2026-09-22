/**
 * Stress the engine supervisor with real dev servers and real Chrome.
 *
 * The supervisor owns every process the engine starts, so its two hard parts
 * only fail under load: a port picked twice at the same moment, and a record
 * that outlives the process it names. Each case here drives the real daemon,
 * asks the real ports, and kills real processes, then reports what it read.
 *
 * The run is isolated: it starts a supervisor of its own on a port of its own,
 * in a temp checkout whose registries nothing else shares, and removes every
 * process, profile and file when it ends. It never touches the person's
 * supervisor.
 *
 *   node tools/supervisor-stress.mjs [--case <name>] [--list]
 *
 * Exit 0 when every selected case passes, 1 when any fails.
 */
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findChrome } from '../engine/chrome-path.mjs'

const REAL_CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MEMORY_LIMIT_BYTES = 50 * 1024 * 1024

/** Case names in the order they run. Memory is last because it spans the rest. */
const CASE_NAMES = [
  'dev-servers', 'browsers', 'outside-kill', 'open-close',
  'race', 'adoption', 'detached-browser', 'server-choice', 'same-name-and-stop',
  'editor-reuse', 'memory'
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Fail the current case with a sentence a reader can act on. */
function check(condition, message) {
  if (!condition) throw new Error(message)
}

/** Every Windows process, with its parent, command line and working set. */
function windowsProcesses() {
  const command = 'Get-CimInstance Win32_Process | '
    + 'Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize | ConvertTo-Json -Compress'
  let text
  try {
    text = execFileSync('powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  } catch (error) {
    throw new Error(`could not read the Windows process list: ${error.message}`)
  }
  const parsed = JSON.parse(text)
  return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    name: String(row.Name || ''),
    commandLine: String(row.CommandLine || ''),
    workingSetBytes: Number(row.WorkingSetSize || 0)
  }))
}

/** Every TCP port something is listening on, with the process that owns it. */
function listeningPorts() {
  const text = execFileSync('netstat', ['-ano'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  const ports = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP' || parts[3].toUpperCase() !== 'LISTENING') continue
    const port = Number(parts[1].slice(parts[1].lastIndexOf(':') + 1))
    if (Number.isInteger(port)) ports.push({ port, pid: Number(parts[4]) })
  }
  return ports
}

/** The temp profile directories the supervisor has made under this run. */
function profileDirectories(context) {
  let names = []
  try { names = fs.readdirSync(context.tmp) } catch { return [] }
  return names.filter(name => name.startsWith('supervisor-'))
    .map(name => path.join(context.tmp, name)).filter(full => fs.statSync(full).isDirectory())
}

/**
 * The processes this run started, found by process tree rather than by name.
 *
 * Chrome and vite both start children, and a child's command line does not
 * repeat the profile or checkout its parent was given. A Windows parent id is
 * not rewritten when the parent dies, so a browser killed from outside still
 * points at its own dead pid and its children stay findable here.
 */
function engineProcessesIn(processes, context) {
  const engine = new Set()
  const isOurs = process => {
    if (process.pid === context.supervisorPid) return true
    if (context.instancePids.has(process.pid)) return true
    const line = process.commandLine.toLowerCase()
    return [context.root, context.checkout, context.tmp]
      .some(where => line.includes(where.toLowerCase()))
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const process of processes) {
      if (engine.has(process.pid)) continue
      if (isOurs(process) || engine.has(process.parentPid)) engine.add(process.pid)
    }
  }
  return processes.filter(process => engine.has(process.pid))
}

const engineProcesses = context => engineProcessesIn(windowsProcesses(), context)

/** A process and everything it started, found through Windows parent ids. */
function processesUnder(pid, processes) {
  const under = new Set()
  for (let pass = 0; pass < 4; pass++) {
    for (const process of processes) {
      if (!under.has(process.pid) && (process.pid === pid || under.has(process.parentPid))) under.add(process.pid)
    }
  }
  return processes.filter(process => under.has(process.pid))
}

/** One count of everything a leak would change, for a before/after comparison. */
async function snapshot(context) {
  const all = windowsProcesses()
  const engine = engineProcessesIn(all, context)
  const enginePids = new Set(engine.map(process => process.pid))
  const ports = listeningPorts()
  return {
    chrome: all.filter(process => /^chrome\.exe$/i.test(process.name)).length,
    node: all.filter(process => /^node\.exe$/i.test(process.name)).length,
    ports: ports.length,
    engineChrome: engine.filter(process => /^chrome\.exe$/i.test(process.name)).length,
    engineNode: engine.filter(process => /^node\.exe$/i.test(process.name)).length,
    engineProcesses: engine.map(process => ({ pid: process.pid, name: process.name, workingSetBytes: process.workingSetBytes })),
    enginePorts: ports.filter(port => enginePids.has(port.pid)).map(port => port.port),
    profiles: profileDirectories(context),
    engineWorkingSetBytes: engine.reduce((sum, process) => sum + process.workingSetBytes, 0)
  }
}

/** One HTTP request, or null when nothing answers in time. */
function request(port, method, requestPath, body, milliseconds, host = '127.0.0.1') {
  return new Promise(resolve => {
    const payload = body == null ? null : JSON.stringify(body)
    const call = http.request({
      host, port, path: requestPath, method, agent: false, timeout: milliseconds,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
        : {}
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.once('end', () => {
        call.destroy()
        let parsed = null
        try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
        resolve({ status: response.statusCode, body: parsed, text })
      })
    })
    const fail = () => { call.destroy(); resolve(null) }
    call.once('error', fail)
    call.once('timeout', fail)
    if (payload) call.write(payload)
    call.end()
  })
}

/** Ask the supervisor. A non-2xx answer is an error naming the supervisor's sentence. */
async function askSupervisor(context, method, requestPath, body, milliseconds = 15_000) {
  const answer = await request(context.supervisorPort, method, requestPath, body, milliseconds)
  if (!answer) throw new Error(`the supervisor on port ${context.supervisorPort} did not answer ${method} ${requestPath}`)
  if (answer.status >= 400) throw new Error(answer.body?.error || `the supervisor answered ${answer.status}`)
  return answer.body
}

const listInstances = context => askSupervisor(context, 'GET', '/instances', null, 30_000)

async function openInstance(context, instanceRequest, milliseconds = 180_000) {
  const instance = await askSupervisor(context, 'POST', '/instances', instanceRequest, milliseconds)
  if (Number.isInteger(instance?.pid)) context.instancePids.add(instance.pid)
  return instance
}

const stopInstance = (context, id, milliseconds = 60_000) =>
  askSupervisor(context, 'DELETE', `/instances/${encodeURIComponent(id)}`, null, milliseconds)

/** The supervisor's sentence when it refuses an open, or null when it opened one. */
async function refusal(context, instanceRequest) {
  try { await openInstance(context, instanceRequest); return null }
  catch (error) { return error.message }
}

/**
 * Ask a port on either loopback address.
 *
 * A dev server binds `localhost`, which is the IPv6 address first on Windows,
 * while a Chrome debugging port binds `127.0.0.1`. One address alone reports a
 * healthy process as missing.
 */
async function askPort(port, requestPath, milliseconds = 2_000) {
  for (const host of ['127.0.0.1', '::1']) {
    const answer = await request(port, 'GET', requestPath, null, milliseconds, host)
    if (answer) return { ...answer, host }
  }
  return null
}

/** Wait until a condition holds, or give up after the deadline. */
async function waitUntil(predicate, milliseconds, description) {
  const deadline = Date.now() + milliseconds
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`)
    await sleep(100)
  }
}

/** Kill a process and every child it started. */
function killTree(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }) } catch { /* already gone */ }
}

/** Kill exactly one process and leave its children, as a force-killed daemon is. */
function killOne(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }) } catch { /* already gone */ }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** A free TCP port for the run's own supervisor. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * A checkout of its own, so this run's registries and record never meet the
 * person's.
 *
 * The real directory is reached through junctions, so the supervisor runs the
 * real vite and the real engine modules, while `.engine`, `agent-runs` and
 * `.browsers` are real directories inside the temp root. The temp root sits
 * outside git, so every `mainWorktree` lookup falls back to it and no record
 * lands in the repo. `.browsers` is not shared because a visible editor's
 * profile is persistent: sharing it would leave this run's tabs in the
 * person's own window.
 */
function makeCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-stress-'))
  const checkout = path.join(root, 'checkout')
  fs.mkdirSync(checkout)
  const own = new Set(['.git', '.engine', 'agent-runs', '.agent-worktrees', '.tmp-agent-tests', '.browsers'])
  for (const entry of fs.readdirSync(REAL_CHECKOUT)) {
    if (own.has(entry)) continue
    const from = path.join(REAL_CHECKOUT, entry)
    const to = path.join(checkout, entry)
    if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, to, 'junction')
    else fs.copyFileSync(from, to)
  }
  fs.mkdirSync(path.join(checkout, '.engine'), { recursive: true })
  fs.mkdirSync(path.join(checkout, 'agent-runs/supervisor'), { recursive: true })
  fs.mkdirSync(path.join(checkout, '.browsers/profiles'), { recursive: true })
  const tmp = path.join(root, 'tmp')
  fs.mkdirSync(tmp, { recursive: true })
  const projects = path.join(root, 'projects')
  fs.mkdirSync(projects, { recursive: true })
  return { root, checkout, tmp, projects }
}

/** Start the supervisor as a detached process of this run's own. */
function spawnSupervisor(context) {
  const moduleUrl = pathToFileURL(path.join(REAL_CHECKOUT, 'engine/supervisor.mjs')).href
  const entry = `import { startSupervisor } from ${JSON.stringify(moduleUrl)}; `
    + 'startSupervisor(process.argv[1]).catch(error => { console.error(error); process.exit(1) })'
  const environment = {
    ...process.env,
    ENGINE_SUPERVISOR_PORT: String(context.supervisorPort),
    TEMP: context.tmp,
    TMP: context.tmp,
    ENGINE_PROJECTS_ROOT: context.projects,
    // `.browsers` is not shared, so the browser is named instead of found.
    CHROME_PATH: findChrome(REAL_CHECKOUT)
  }
  const log = fs.openSync(path.join(context.root, 'supervisor.log'), 'a')
  try {
    const child = spawn(process.execPath, ['--input-type=module', '-e', entry, context.checkout],
      { env: environment, detached: true, stdio: ['ignore', log, log], windowsHide: true })
    child.unref()
    return child.pid
  } finally {
    fs.closeSync(log)
  }
}

async function startSupervisor(context) {
  context.supervisorPid = spawnSupervisor(context)
  await waitUntil(async () => {
    const health = await request(context.supervisorPort, 'GET', '/health', null, 2_000)
    return health?.status === 200 && health.body?.ok === true
  }, 30_000, 'the supervisor to answer /health')
  const health = await request(context.supervisorPort, 'GET', '/health', null, 5_000)
  context.supervisorRecordedPid = health.body.pid
}

/** Stop every instance, however it was started, and wait for the processes to go. */
async function stopEveryInstance(context) {
  let listed
  try { listed = await listInstances(context) } catch { return }
  for (const instance of listed.instances) {
    try { await stopInstance(context, instance.id) } catch { /* the prover may have dropped it */ }
  }
  const pids = listed.instances.map(instance => instance.pid).filter(Number.isInteger)
  await waitUntil(() => pids.every(pid => !processAlive(pid)), 20_000, 'every instance process to exit')
}

/** Kill any instance process a case left, so the next case starts from a clean baseline. */
function killEngineLeftovers(context) {
  for (let pass = 0; pass < 3; pass++) {
    const left = engineProcesses(context).filter(process => process.pid !== context.supervisorPid)
    if (left.length === 0) return
    for (const process of left) killTree(process.pid)
  }
}

/** Take the supervisor down and wait for its process and record to go. */
async function shutdownSupervisor(context) {
  if (!context.supervisorPid) return
  try { await askSupervisor(context, 'POST', '/shutdown', null, 30_000) } catch { /* already gone */ }
  await waitUntil(() => !processAlive(context.supervisorPid), 20_000, 'the supervisor to exit')
  const record = path.join(context.checkout, '.engine/supervisor.json')
  await waitUntil(() => !fs.existsSync(record), 10_000, 'the supervisor record to go')
  context.supervisorPid = null
}

/** Kill anything this run left, remove its temp profiles, and delete its root. */
function sweepLeftovers(context) {
  for (let pass = 0; pass < 3; pass++) {
    const left = engineProcesses(context)
    if (left.length === 0) break
    for (const process of left) killTree(process.pid)
  }
  try { fs.rmSync(context.root, { recursive: true, force: true }) } catch { /* Windows may hold it briefly */ }
}

/** The one line every case prints, then the evidence it read. */
function report(name, passed, evidence) {
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${name}\n`)
  for (const line of evidence) process.stdout.write(`      ${line}\n`)
}

/** Start `count` instances at the same moment and return what the daemon said. */
const openTogether = (context, count, makeRequest) =>
  Promise.all(Array.from({ length: count }, (_, index) => openInstance(context, makeRequest(index))))

/** A stranger on the first dev-server port, answering /api/server as somebody else. */
function holdSquatter(port) {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ pid: 999999, serves: 'somewhere else' }))
    })
    server.once('error', () => resolve(null))
    server.listen(port, '::1', () => resolve(server))
  })
}

/** Case 1: eight dev servers at once, each on its own port, each proved at /api/server. */
async function caseDevServers(context) {
  const evidence = []
  // A dev server binds localhost (::1 on Windows), so a port held only there is
  // taken. Holding it proves the port pick and the prover's pid check together:
  // a stranger's 200 must never pass as the server, and 5180 must be skipped.
  const squatter = await holdSquatter(5180)
  if (squatter) evidence.push(`a stranger answers ::1:5180 as pid 999999 before the eight start`)
  try {
    const instances = await openTogether(context, 8, () => ({ kind: 'dev-server' }))
    const ports = instances.map(instance => instance.port)
    evidence.push(`opened ${instances.length} dev servers on ports ${ports.join(', ')}`)
    check(new Set(ports).size === 8, `the eight dev servers did not get eight ports: ${ports.join(', ')}`)
    if (squatter) check(!ports.includes(5180), 'a dev server was given 5180, which a stranger holds on ::1')

    for (const instance of instances) {
      const answer = await askPort(instance.port, '/api/server', 5_000)
      check(answer?.status === 200, `dev server ${instance.id} on port ${instance.port} does not answer /api/server`)
      check(Number(answer.body?.pid) === instance.pid,
        `port ${instance.port} answers as pid ${answer.body?.pid}, not the recorded pid ${instance.pid}`)
      check(path.resolve(answer.body?.serves || '') === path.resolve(context.checkout),
        `port ${instance.port} serves ${answer.body?.serves}, not this checkout`)
      evidence.push(`${instance.id} pid ${instance.pid} port ${instance.port} answers /api/server as itself`)
    }

    const listed = await listInstances(context)
    for (const id of instances.map(instance => instance.id)) {
      const seen = listed.instances.filter(instance => instance.id === id)
      check(seen.length === 1, `${id} appears ${seen.length} times in GET /instances, not once`)
    }
    evidence.push(`GET /instances names each of the eight exactly once`)
  } finally {
    if (squatter) await new Promise(resolve => squatter.close(resolve))
  }
  return evidence
}

/** Case 2: eight headless lanes and one visible editor window, all at once. */
async function caseBrowsers(context) {
  const evidence = []
  const requests = Array.from({ length: 8 }, () => ({ kind: 'lane-browser', url: 'http://127.0.0.1:1/' }))
  requests.push({ kind: 'editor-browser', url: 'http://127.0.0.1:1/' })
  const instances = await openTogether(context, 9, index => requests[index])
  const ports = instances.map(instance => instance.port)
  evidence.push(`opened ${instances.length} browsers on ports ${ports.join(', ')}`)
  check(new Set(ports).size === instances.length, `two browsers share a debugging port: ${ports.join(', ')}`)

  const profiles = instances.map(instance => instance.profile)
  check(profiles.every(Boolean), 'a browser has no profile directory recorded')
  check(new Set(profiles).size === profiles.length, `two browsers share a profile: ${profiles.join(', ')}`)
  evidence.push(`${profiles.length} distinct profile directories`)

  for (const instance of instances) {
    const answer = await askPort(instance.port, '/json/list', 5_000)
    check(answer?.status === 200, `${instance.kind} ${instance.id} on port ${instance.port} does not answer /json/list`)
  }
  evidence.push(`every browser answers /json/list on its own port`)

  const editor = instances.find(instance => instance.kind === 'editor-browser')
  const editorProcess = windowsProcesses().find(process => process.pid === editor.pid)
  check(editorProcess, `the editor window process ${editor.pid} is not in the process list`)
  const headless = /--headless/.test(editorProcess.commandLine)
  check(!headless, `the editor-browser is headless: ${editorProcess.commandLine}`)
  evidence.push(`editor window pid ${editor.pid} runs without --headless`)
  return evidence
}

/** Case 3: three browsers killed from outside, proved gone, the rest still running. */
async function caseOutsideKill(context) {
  const evidence = []
  const instances = await openTogether(context, 6, () => ({ kind: 'lane-browser', url: 'http://127.0.0.1:1/' }))
  const killed = instances.slice(0, 3)
  const survivors = instances.slice(3)

  for (const instance of killed) killOne(instance.pid)
  evidence.push(`taskkill /F on ${killed.map(instance => `${instance.id}(pid ${instance.pid})`).join(', ')}`)

  // One prover round: a listing proves every instance before it answers.
  const listed = await listInstances(context)
  for (const instance of killed) {
    check(!listed.instances.some(entry => entry.id === instance.id), `${instance.id} is still listed after its process was killed`)
  }
  for (const instance of survivors) {
    const proved = listed.instances.find(entry => entry.id === instance.id)
    check(proved?.state === 'running', `${instance.id} is ${proved?.state ?? 'missing'} after an unrelated kill`)
  }
  evidence.push(`${killed.length} dropped, ${survivors.length} still running`)

  const registry = JSON.parse(fs.readFileSync(path.join(context.checkout, '.engine/lane-browsers.json'), 'utf8'))
  for (const instance of killed) {
    check(!registry.browsers.some(entry => entry.pid === instance.pid), `${instance.id} kept its record after being proved gone`)
  }
  evidence.push(`the killed records are gone from .engine/lane-browsers.json`)

  await waitUntil(() => killed.every(instance => !processAlive(instance.pid)), 10_000, 'the killed processes to go')
  await waitUntil(() => killed.every(instance => processesUnder(instance.pid, windowsProcesses()).length === 0),
    15_000, 'the killed browsers and every child they started to go')
  await waitUntil(() => killed.every(instance => !fs.existsSync(instance.profile)), 10_000, 'the killed profiles to go')
  const strays = killed.filter(instance => fs.existsSync(instance.profile)).map(instance => instance.profile)
  check(strays.length === 0, `a killed browser left its profile: ${strays.join(', ')}`)
  evidence.push(`no stray process and no stray profile from the three`)
  return evidence
}

/** Case 4: one browser opened and closed twenty times, with nothing left over. */
async function caseOpenClose(context) {
  const evidence = []
  const before = await snapshot(context)
  const evidenceLine = side => `engine chrome ${side.engineChrome}, engine node ${side.engineNode}, `
    + `engine ports ${side.enginePorts.length}, temp profiles ${side.profiles.length} `
    + `(all chrome ${side.chrome}, all node ${side.node}, all ports ${side.ports})`
  evidence.push(`before: ${evidenceLine(before)}`)

  for (let round = 1; round <= 20; round++) {
    const instance = await openInstance(context, { kind: 'lane-browser', url: 'http://127.0.0.1:1/' })
    await stopInstance(context, instance.id)
  }
  await waitUntil(async () => {
    const now = await snapshot(context)
    return now.engineChrome === before.engineChrome && now.engineNode === before.engineNode
      && now.enginePorts.length === before.enginePorts.length && now.profiles.length === before.profiles.length
  }, 30_000, 'every engine count to return to its start')

  const after = await snapshot(context)
  evidence.push(`after:  ${evidenceLine(after)}`)
  check(after.engineChrome === before.engineChrome, `engine chrome processes went from ${before.engineChrome} to ${after.engineChrome}`)
  check(after.engineNode === before.engineNode, `engine node processes went from ${before.engineNode} to ${after.engineNode}`)
  check(after.enginePorts.length === before.enginePorts.length, `engine listening ports went from ${before.enginePorts.length} to ${after.enginePorts.length}`)
  check(after.profiles.length === before.profiles.length, `temp profiles went from ${before.profiles.length} to ${after.profiles.length}`)
  return evidence
}

/** Case 5: twelve starts fired together all get different ports. */
async function caseRace(context) {
  const evidence = []
  const instances = await openTogether(context, 12, () => ({ kind: 'dev-server' }))
  const ports = instances.map(instance => instance.port)
  evidence.push(`twelve ports: ${ports.join(', ')}`)
  check(instances.length === 12, `twelve requests produced ${instances.length} instances`)
  check(new Set(ports).size === 12, `a port was handed out twice: ${ports.join(', ')}`)

  const listed = await listInstances(context)
  const running = listed.instances.filter(instance => instance.kind === 'dev-server' && instance.state === 'running')
  check(running.length === 12, `GET /instances reports ${running.length} running dev servers, not twelve`)
  evidence.push(`GET /instances reports twelve running dev servers`)
  return evidence
}

/** Case 6: a hard-killed supervisor is replaced, and the new one adopts every instance. */
async function caseAdoption(context) {
  const evidence = []
  const devServers = await openTogether(context, 2, () => ({ kind: 'dev-server' }))
  const lane = await openInstance(context, { kind: 'lane-browser', url: 'http://127.0.0.1:1/' })
  const editor = await openInstance(context, { kind: 'editor-browser', url: 'http://127.0.0.1:1/' })
  const started = [...devServers, lane, editor]
  evidence.push(`four instances: ${started.map(instance => `${instance.kind} ${instance.id}`).join(', ')}`)

  const oldPid = context.supervisorRecordedPid
  killOne(oldPid)
  await waitUntil(() => !processAlive(oldPid), 10_000, 'the old supervisor to die')
  await waitUntil(async () => (await request(context.supervisorPort, 'GET', '/health', null, 1_000)) === null,
    10_000, 'the old supervisor port to stop answering')
  evidence.push(`hard-killed the supervisor pid ${oldPid}`)

  await startSupervisor(context)
  evidence.push(`new supervisor pid ${context.supervisorRecordedPid}`)

  const listed = await listInstances(context)
  const kinds = listed.instances.map(instance => instance.kind)
  check(listed.instances.length === 4, `the new supervisor lists ${listed.instances.length} instances, not four: ${JSON.stringify(kinds)}`)
  for (const kind of ['dev-server', 'lane-browser', 'editor-browser']) {
    check(kinds.includes(kind), `the new supervisor did not adopt the ${kind}`)
  }
  check(listed.instances.every(instance => instance.state === 'running'), 'an adopted instance is not proved running')
  evidence.push(`adopted ${listed.instances.length}: ${listed.instances.map(instance => `${instance.kind}:${instance.state}`).join(', ')}`)

  const pids = listed.instances.map(instance => instance.pid)
  for (const instance of listed.instances) await stopInstance(context, instance.id)
  await waitUntil(() => pids.every(pid => !processAlive(pid)), 20_000, 'the adopted processes to stop')
  const remaining = await listInstances(context)
  check(remaining.instances.length === 0, `the new supervisor still lists ${remaining.instances.length} after stopping all`)

  const browserRecords = JSON.parse(fs.readFileSync(path.join(context.checkout, '.engine/lane-browsers.json'), 'utf8')).browsers
  const serverRecords = JSON.parse(fs.readFileSync(path.join(context.checkout, '.engine/servers.json'), 'utf8')).servers
  check(browserRecords.length === 0, `stopping left ${browserRecords.length} browser records behind`)
  check(serverRecords.length === 0, `stopping left ${serverRecords.length} server records behind`)
  evidence.push(`the new supervisor stopped all four and dropped every record`)
  return evidence
}

/** Case 8: a dev server killed while a browser is attached leaves the browser findable. */
async function caseDetachedBrowser(context) {
  const evidence = []
  const server = await openInstance(context, { kind: 'dev-server' })
  const browser = await openInstance(context, {
    kind: 'lane-browser', url: `http://localhost:${server.port}/`, client: 'attached'
  })
  evidence.push(`dev server ${server.id} port ${server.port} with ${browser.id} attached to it`)

  killOne(server.pid)
  await waitUntil(() => !processAlive(server.pid), 10_000, 'the killed dev server to go')
  const listed = await listInstances(context)
  check(!listed.instances.some(instance => instance.id === server.id), `the killed dev server ${server.id} is still listed`)
  const stillThere = listed.instances.find(instance => instance.id === browser.id)
  check(stillThere?.state === 'running', `the attached browser is ${stillThere?.state ?? 'missing'}, not running`)
  evidence.push(`after one prover round: dev server gone, ${browser.id} still running`)

  await stopInstance(context, browser.id)
  await waitUntil(() => !processAlive(browser.pid), 10_000, 'the attached browser to stop')
  await waitUntil(() => !fs.existsSync(browser.profile), 10_000, 'the attached browser profile to go')
  check(!fs.existsSync(browser.profile), `the attached browser left its profile at ${browser.profile}`)
  evidence.push(`the browser stopped cleanly and left no profile`)
  return evidence
}

/** Case: a browser with no url uses the one dev server, refuses none or several. */
async function caseServerChoice(context) {
  const evidence = []

  const none = await refusal(context, { kind: 'editor-browser' })
  check(none && /supervisor\.open dev-server/.test(none),
    `with no dev server the refusal did not name the start verb: ${none}`)
  evidence.push(`with no dev server: ${none}`)

  const server = await openInstance(context, { kind: 'dev-server' })
  const before = await listInstances(context)
  const browserCount = listed => listed.instances
    .filter(instance => instance.kind === 'editor-browser' || instance.kind === 'lane-browser').length
  const editor = await openInstance(context, { kind: 'editor-browser' })
  check(editor.url === server.url, `the editor opened on ${editor.url}, not the running dev server ${server.url}`)
  const after = await listInstances(context)
  check(browserCount(after) === browserCount(before) + 1,
    `the browser count went from ${browserCount(before)} to ${browserCount(after)}, not up by one`)
  evidence.push(`${server.id} on port ${server.port}: editor ${editor.id} opened on ${editor.url}, browsers up to ${browserCount(after)}`)

  const second = await openInstance(context, { kind: 'dev-server' })
  const several = await refusal(context, { kind: 'editor-browser' })
  check(several && several.includes(server.id) && several.includes(second.id),
    `with two dev servers the refusal did not name both (${server.id}, ${second.id}): ${several}`)
  evidence.push(`with ${server.id} and ${second.id} running: ${several}`)
  return evidence
}

/**
 * Case: two callers race for one client name, then two race to stop the one
 * instance that opened.
 *
 * A name is one browser: the loser is refused and names the holder rather than
 * overwriting the winner's record. A stop is idempotent: both callers succeed,
 * and the one that arrives second says "already stopped" instead of naming a
 * wrong id.
 */
async function caseSameNameAndStop(context) {
  const evidence = []
  const name = 'contested'
  const starts = await Promise.allSettled([
    openInstance(context, { kind: 'lane-browser', url: 'http://127.0.0.1:1/', client: name }),
    openInstance(context, { kind: 'lane-browser', url: 'http://127.0.0.1:1/', client: name })
  ])
  const opened = starts.filter(result => result.status === 'fulfilled').map(result => result.value)
  const refusals = starts.filter(result => result.status === 'rejected').map(result => result.reason.message)
  check(opened.length === 1, `${opened.length} of two starts for "${name}" succeeded, not one`)
  check(refusals.length === 1, `${refusals.length} of two starts for "${name}" were refused, not one`)
  check(/already called "contested"/.test(refusals[0]),
    `the refusal did not say the name is held: ${refusals[0]}`)
  check(refusals[0].includes(`process ${opened[0].pid}`),
    `the refusal did not name the holder pid ${opened[0].pid}: ${refusals[0]}`)
  evidence.push(`one ${opened[0].id} on pid ${opened[0].pid}; the second start refused: ${refusals[0]}`)

  const listed = await listInstances(context)
  const named = listed.instances.filter(instance => instance.client === name)
  check(named.length === 1, `${named.length} instances are called "${name}", not one`)
  evidence.push(`GET /instances names one instance called "${name}"`)

  const stops = await Promise.allSettled([
    stopInstance(context, opened[0].id),
    stopInstance(context, opened[0].id)
  ])
  const failed = stops.filter(result => result.status === 'rejected')
  check(failed.length === 0,
    `a race to stop one instance failed: ${failed.map(result => result.reason.message).join('; ')}`)
  const already = stops.flatMap(result => result.value.alreadyStopped ?? [])
  check(already.includes(opened[0].id),
    `neither stop said ${opened[0].id} was already stopped: ${JSON.stringify(stops.map(result => result.value))}`)
  evidence.push(`two stops succeeded; the second said "${opened[0].id}" was already stopped`)

  await waitUntil(() => !processAlive(opened[0].pid), 20_000, 'the contested browser to exit')
  evidence.push(`pid ${opened[0].pid} is gone`)
  return evidence
}

/** The page urls a debugging port lists, or null when it does not answer. */
async function pageUrlsOn(port) {
  const answer = await askPort(port, '/json/list', 5_000)
  if (!Array.isArray(answer?.body)) return null
  return answer.body.filter(target => target.type === 'page').map(target => target.url)
}

/**
 * Case: the editor opened five times for one server keeps one page and one
 * instance, then five callers at once keep the same one. The count is of pages
 * through the debugging port, because one browser with two pages reads as one
 * instance and that is how the second page got through before. Stopping it
 * closes the page, and a fresh browser opens only the page asked for rather
 * than the session Chrome would restore.
 */
async function caseEditorReuse(context) {
  const evidence = []
  const server = await openInstance(context, { kind: 'dev-server' })
  const url = server.url

  // Five asks in a row with no url, as a person pressing the editor key does.
  const sequential = []
  for (let round = 1; round <= 5; round++) sequential.push(await openInstance(context, { kind: 'editor-browser' }))
  const editor = sequential[0]
  for (const [index, again] of sequential.entries()) {
    check(again.id === editor.id,
      `sequential open ${index + 1} returned ${again.id}, not the running ${editor.id}`)
  }
  const afterSequential = await pageUrlsOn(editor.port)
  check(afterSequential?.length === 1,
    `after five opens in a row the browser holds ${afterSequential?.length ?? 'no'} pages: ${afterSequential?.join(', ')}`)
  check(afterSequential[0] === url, `the one page is ${afterSequential[0]}, not ${url}`)
  evidence.push(`editor ${editor.id} pid ${editor.pid} port ${editor.port} on ${url}`)
  evidence.push(`five opens in a row returned ${editor.id} and left one page`)

  // Five callers at once, the way parallel work reaches for the editor.
  const concurrent = await openTogether(context, 5, () => ({ kind: 'editor-browser' }))
  for (const [index, again] of concurrent.entries()) {
    check(again.id === editor.id,
      `concurrent open ${index + 1} returned ${again.id}, not the running ${editor.id}`)
  }
  const afterConcurrent = await pageUrlsOn(editor.port)
  check(afterConcurrent?.length === 1,
    `after five concurrent opens the browser holds ${afterConcurrent?.length ?? 'no'} pages: ${afterConcurrent?.join(', ')}`)
  check(afterConcurrent[0] === url, `the one page is ${afterConcurrent[0]}, not ${url}`)
  evidence.push(`five concurrent opens returned ${editor.id} and left one page`)

  const listed = await listInstances(context)
  const editors = listed.instances.filter(instance => instance.kind === 'editor-browser')
  check(editors.length === 1, `GET /instances reports ${editors.length} editor-browser instances, not one`)

  await stopInstance(context, editor.id)
  await waitUntil(async () => (await askPort(editor.port, '/json/list', 1_000)) === null,
    20_000, `the editor port ${editor.port} to stop answering`)
  evidence.push(`stop closed the page and ended the browser; port ${editor.port} no longer answers`)

  const reopened = await openInstance(context, { kind: 'editor-browser', url })
  const fresh = await askPort(reopened.port, '/json/list', 5_000)
  const freshPages = Array.isArray(fresh?.body) ? fresh.body.filter(target => target.type === 'page') : []
  check(freshPages.length === 1,
    `the restarted browser restored ${freshPages.length} pages, not one: ${freshPages.map(page => page.url).join(', ')}`)
  check(freshPages[0].url === url, `the restarted browser opened ${freshPages[0].url}, not ${url}`)
  evidence.push(`a fresh browser opened one page on ${url} and restored no tab`)

  await stopInstance(context, reopened.id)
  return evidence
}

/** Case 7: memory before case 1 against memory after the last cleanup. */
async function caseMemory(context) {
  const evidence = []
  const after = await snapshot(context)
  const start = context.memoryBefore.engineWorkingSetBytes
  const end = after.engineWorkingSetBytes
  evidence.push(`start: ${start} bytes (${Math.round(start / 1048576)} MB)`)
  evidence.push(`end:   ${end} bytes (${Math.round(end / 1048576)} MB)`)
  evidence.push(`end - start: ${end - start} bytes`)
  check(end - start <= MEMORY_LIMIT_BYTES,
    `engine memory grew by ${Math.round((end - start) / 1048576)} MB, more than the 50 MB allowed`)
  return evidence
}

const CASES = {
  'dev-servers': caseDevServers,
  browsers: caseBrowsers,
  'outside-kill': caseOutsideKill,
  'open-close': caseOpenClose,
  race: caseRace,
  adoption: caseAdoption,
  'detached-browser': caseDetachedBrowser,
  'server-choice': caseServerChoice,
  'same-name-and-stop': caseSameNameAndStop,
  'editor-reuse': caseEditorReuse,
  memory: caseMemory
}

/** Run one case, clean up after it, and never let its failure stop the others. */
async function runCase(name, context) {
  try {
    const evidence = await CASES[name](context)
    report(name, true, evidence)
    context.results.set(name, true)
  } catch (error) {
    report(name, false, [`${error.message}`])
    context.results.set(name, false)
  } finally {
    await stopEveryInstance(context).catch(() => {})
    killEngineLeftovers(context)
  }
}

function parseArguments(argv) {
  const options = { cases: [], list: false }
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--case') options.cases.push(argv[++index])
    else if (argv[index] === '--list') options.list = true
    else throw new Error(`unknown argument "${argv[index]}"`)
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.list) {
    process.stdout.write(`${CASE_NAMES.join('\n')}\n`)
    return 0
  }
  for (const name of options.cases) {
    if (!CASES[name]) throw new Error(`no case is called "${name}"; try --list`)
  }
  const selected = options.cases.length ? CASE_NAMES.filter(name => options.cases.includes(name)) : [...CASE_NAMES]

  const context = {
    ...makeCheckout(), supervisorPort: await freePort(),
    results: new Map(), supervisorPid: null, instancePids: new Set()
  }
  try {
    await startSupervisor(context)
    process.stdout.write(`supervisor pid ${context.supervisorRecordedPid} on port ${context.supervisorPort}\n`)
    context.memoryBefore = await snapshot(context)
    for (const name of selected) await runCase(name, context)
  } finally {
    await shutdownSupervisor(context).catch(() => {})
    sweepLeftovers(context)
  }

  const failed = selected.filter(name => context.results.get(name) === false)
  process.stdout.write(`\n${selected.length - failed.length}/${selected.length} cases passed`)
  process.stdout.write(failed.length ? `; failed: ${failed.join(', ')}\n` : '\n')
  return failed.length ? 1 : 0
}

main()
  .then(code => { process.exitCode = code })
  .catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
