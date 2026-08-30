#!/usr/bin/env node
/**
 * Proof: the engine can list and stop what it started.
 *
 * One dev server is started on port 5199 — the only way to prove a listing and
 * a stop — and it is stopped again before this script ends, with the port shown
 * free afterwards by netstat as well as by the engine.
 *
 * No browser is opened. The attached-tab half is proved two ways short of a real
 * tab: the page's beacon is shown to be injected and wired to the hot socket by
 * the dev server's own transform, and a websocket client speaking Vite's HMR
 * protocol from node stands in for the tab so the server half is exercised end
 * to end. What a real browser does with that script is not proved here.
 *
 *   node agent-runs/server-registry/proof-servers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { recordServer, readServerRegistry, serverRegistryFile } from '../../engine/project-index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = path.join(ROOT, 'bin/engine.mjs')
const PORT = 5199
const REPORT = path.join(ROOT, 'agent-runs/server-registry/servers-proof.txt')
const SERVER_LOG = path.join(ROOT, 'agent-runs/server-registry/dev-server-5199.log')

const lines = []
const say = text => { lines.push(text); process.stdout.write(text + '\n') }

let failures = 0
const expect = (claim, ok) => {
  say(`${ok ? 'PASS' : 'FAIL'}  ${claim}`)
  if (!ok) failures++
}

const engine = (...args) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args, '--raw'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, value: JSON.parse(stdout) }
  } catch (error) {
    const stdout = error.stdout || ''
    let value = null
    try { value = JSON.parse(stdout) } catch { /* the failure itself is the answer */ }
    return { code: error.status ?? -1, stdout, stderr: error.stderr || '', value }
  }
}

const show = (title, result) => {
  say('')
  say(`### ${title}`)
  say(`$ node bin/engine.mjs ${result.command}`)
  say((result.stdout || '').trim() || (result.stderr || '').trim() || '(no output)')
  say(`exit code: ${result.code}`)
}

const run = (...args) => ({ ...engine(...args), command: [...args, '--raw'].join(' ') })

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const ask = async (pathname, ms = 1000) => {
  try {
    const response = await fetch(`http://localhost:${PORT}${pathname}`, { signal: AbortSignal.timeout(ms) })
    return response.ok ? response : null
  } catch { return null }
}

const listeningOn = port => execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(line => /LISTENING/i.test(line) && new RegExp(`[:.]${port}\\b`).test(line))

let devServer = null

try {
  say('proof: list the dev servers this checkout started, and stop them')
  say(`checkout: ${ROOT}`)
  say(`registry: ${serverRegistryFile(ROOT)}`)

  expect(`nothing is listening on ${PORT} before this starts`, listeningOn(PORT).length === 0)

  // ------------------------------------------------------------ start one
  say('')
  say(`$ ENGINE_PORT=${PORT} ENGINE_NO_OPEN=1 npm run dev`)
  const log = fs.createWriteStream(SERVER_LOG)
  devServer = spawn('npm run dev', {
    cwd: ROOT, shell: true,
    env: { ...process.env, ENGINE_PORT: String(PORT), ENGINE_NO_OPEN: '1' }
  })
  devServer.stdout.pipe(log)
  devServer.stderr.pipe(log)

  let answered = null
  for (let attempt = 0; attempt < 120 && !answered; attempt++) {
    await wait(500)
    answered = await ask('/api/server')
  }
  expect(`the dev server answers on port ${PORT}`, !!answered)
  if (!answered) throw new Error(`the dev server never started; see ${SERVER_LOG}`)

  // ------------------------------------------------------------ list it
  const listed = run('servers')
  show('the server is listed while it runs', listed)
  const found = listed.value.servers.find(server => server.port === PORT)
  expect('the listing names the port', !!found)
  expect('it is reported running and alive', found?.state === 'running' && found?.alive === true)
  expect('it names the checkout it serves', path.resolve(found?.serves || '') === ROOT)
  expect('it names the project directory', found?.project === 'project')
  expect('it names the process id', Number.isInteger(found?.pid))
  expect('it says when it started', typeof found?.startedAt === 'string')
  expect('it carries a tab list', Array.isArray(found?.tabs))
  expect('the record lives in the main worktree, not this one',
    !serverRegistryFile(ROOT).includes('.agent-worktrees'))

  // ------------------------------------------------- the page's own half
  const page = await ask('/')
  const html = page ? await page.text() : ''
  expect('every page this server serves carries the tab beacon',
    html.includes('/@id/__x00__virtual:engine-tab-beacon'))
  const beacon = await ask('/@id/__x00__virtual:engine-tab-beacon')
  const beaconSource = beacon ? await beacon.text() : ''
  say('')
  say('### the beacon module as the dev server transforms it')
  say(beaconSource.split('//# sourceMappingURL')[0].trim())
  expect('the beacon is wired to the hot socket', beaconSource.includes('createHotContext'))
  expect('the beacon reports whether the tab is hidden', beaconSource.includes('document.hidden'))

  // -------------------------------------------------- a tab, stood in for
  // A websocket speaking Vite's HMR protocol is exactly what a tab is to this
  // server. It proves the server half; it does not prove what a browser does.
  const socket = new WebSocket(`ws://localhost:${PORT}/`, 'vite-hmr')
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
    setTimeout(() => reject(new Error('the websocket never opened')), 5000)
  })
  socket.send(JSON.stringify({
    type: 'custom',
    event: 'engine:tab',
    data: { id: 'proof-tab', url: `http://localhost:${PORT}/`, title: 'engine', hidden: true }
  }))
  await wait(500)

  const withTab = run('servers')
  show('a hidden tab attached to it', withTab)
  const tabs = withTab.value.servers.find(server => server.port === PORT)?.tabs || []
  expect('the tab is listed', tabs.length === 1)
  expect('the tab has an identity', tabs[0]?.id === 'proof-tab')
  expect('the tab names its page url', tabs[0]?.url === `http://localhost:${PORT}/`)
  expect('the tab names its project', tabs[0]?.project === 'project')
  expect('the tab is reported hidden', tabs[0]?.hidden === true)
  expect('the listing says why a hidden tab matters', /blank/.test(tabs[0]?.why || ''))
  socket.close()

  // ------------------------------------------------------------ stop it
  const stopped = run('servers.stop', String(PORT))
  show('stopping it by port', stopped)
  expect('the stop exits 0', stopped.code === 0)
  expect('it says what was stopped', stopped.value.stopped.some(server => server.port === PORT))
  expect('nothing was refused', stopped.value.refused.length === 0)

  await wait(500)
  expect(`nothing answers on ${PORT} any more`, !(await ask('/api/server')))
  expect(`netstat shows nothing listening on ${PORT}`, listeningOn(PORT).length === 0)
  const after = run('servers')
  show('the listing after the stop', after)
  expect('the stopped server is gone from the record', !after.value.servers.some(server => server.port === PORT))

  // ------------------------------------- a record whose server is really dead
  // A server killed outright never gets to tidy up, so the record outlives it.
  // The rule is that a dead entry is never reported alive, and this is the case
  // that would break it.
  const corpse = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  await wait(300)
  recordServer(ROOT, {
    port: PORT, pid: corpse.pid, serves: ROOT, project: 'project',
    url: `http://localhost:${PORT}`, startedAt: new Date().toISOString()
  })
  corpse.kill('SIGKILL')
  await wait(500)

  const haunted = run('servers')
  show('a record left behind by a server that was killed', haunted)
  const ghost = haunted.value.servers.find(server => server.port === PORT)
  expect('the leftover record is listed', !!ghost)
  expect('it is reported dead, never alive', ghost?.state === 'dead' && ghost?.alive === false)
  expect('it says why', /gone|reused/.test(ghost?.why || ''))

  const swept = run('servers.stop')
  show('stopping everything, with only a corpse to find', swept)
  expect('the stop exits 0', swept.code === 0)
  expect('it says the entry was already dead', swept.value.alreadyDead.some(server => server.port === PORT))
  expect('nothing was killed', swept.value.stopped.length === 0)
  expect('the record is cleared', !readServerRegistry(ROOT).servers.some(server => server.port === PORT))

  const empty = run('servers.stop')
  show('stopping again with nothing running', empty)
  expect('stopping nothing is still exit 0', empty.code === 0)
} finally {
  // Whatever happened above, no server of this proof's is left behind.
  if (devServer?.pid) {
    try { execFileSync('taskkill', ['/PID', String(devServer.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
  }
  try { execFileSync(process.execPath, [CLI, 'servers.stop', String(PORT), '--raw'], { cwd: ROOT, stdio: 'ignore' }) } catch { /* nothing to stop */ }

  const left = listeningOn(PORT)
  say('')
  say(`netstat for port ${PORT} at the end: ${left.length ? left.join(' | ') : '(nothing listening)'}`)
  if (left.length) failures++
  say(`server registry at the end: ${JSON.stringify(readServerRegistry(ROOT))}`)

  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8')
}

say('')
say(failures ? `${failures} check(s) failed` : 'every check passed')
process.exit(failures ? 1 : 0)
