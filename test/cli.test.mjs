#!/usr/bin/env node
/**
 * CLI -> engine tests.
 *
 * These cover the bridge itself rather than any game: argument coercion, exit
 * codes, the command fallback, determinism, and the failure modes an agent will
 * actually hit. They run from outside the browser, spawning the real CLI, because
 * that is how the thing is used — testing the functions from inside would skip
 * the layer most likely to be wrong.
 *
 *   npm test              needs `npm run dev` and an open editor tab
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'bin/engine.mjs')
const LEVEL = path.join(ROOT, 'project/levels/level1.json')

// ------------------------------------------------------------------ harness
const results = []
let only = process.argv[2]

async function test(name, fn) {
  if (only && !name.includes(only)) return
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0 })
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message })
  }
}

const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) throw new Error(`${what}\n    got  ${g}\n    want ${w}`)
}
const ok = (cond, what) => { if (!cond) throw new Error(what) }

/** Run the CLI exactly as an agent would: capture stdout, keep the exit code. */
function cli(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout || '', stderr: e.stderr || '' }
  }
}

const json = args => {
  const r = cli(args)
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`)
  try { return JSON.parse(r.stdout) } catch { throw new Error(`not JSON: ${r.stdout.slice(0, 120)}`) }
}

let probeSeq = 0
const uniq = () => `_probe_${process.pid}_${probeSeq++}`

const settle = ms => execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`])

/**
 * Delete a project file and wait for the fallout.
 *
 * Vite reloads the page on unlink — it does not consult plugins for that event
 * — so a delete left un-awaited lands in the middle of the next test and looks
 * like a hot-reload failure. Wait until the editor answers again.
 */
function removeAndSettle(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file)
  settle(3000)
  cli(['snapshot'])
  settle(500)
}

// ------------------------------------------------------------------ preflight
const probe = cli(['snapshot'])
if (probe.code === 2) {
  console.error(probe.stderr.trim())
  console.error('\nStart the editor first:  npm run dev')
  process.exit(2)
}

const original = fs.readFileSync(LEVEL, 'utf8')

// ------------------------------------------------------------------ tests
await test('snapshot returns the fields an agent depends on', () => {
  const s = json(['snapshot'])
  ok(s.mode === 'edit' || s.mode === 'play', 'mode is edit or play')
  ok(typeof s.level === 'string', 'level is named')
  ok(s.counts.entities > 0, 'entities are counted')
  ok(Array.isArray(s.selection), 'selection is a list')
  ok(Array.isArray(s.errors), 'errors is a list')
})

await test('panel layout can be inspected, resized, and restored', () => {
  const before = json(['layout.read'])
  const wanted = before.left === 260 ? 276 : 260
  const changed = json(['layout.set', JSON.stringify({ left: wanted })])
  eq(changed.left, wanted, 'left dock changed size')
  const restored = json(['layout.set', JSON.stringify(before)])
  eq(restored, before, 'the previous layout was restored')
})

await test('captured output is compact, --pretty is indented', () => {
  const compact = cli(['snapshot']).stdout
  const indented = cli(['snapshot', '--pretty']).stdout
  ok(!compact.includes('\n  '), 'no indentation when captured')
  ok(indented.includes('\n  '), '--pretty indents')
  eq(JSON.parse(compact).level, JSON.parse(indented).level, 'same data either way')
})

await test('exit codes: 0 ok, 1 bad op, 1 bad command, 2 unreachable', () => {
  eq(cli(['snapshot']).code, 0, 'success is 0')
  eq(cli(['nosuchop']).code, 1, 'unknown op is 1')
  eq(cli(['run', 'does.not.exist']).code, 1, 'unknown command is 1')
  eq(cli(['snapshot', '--port', '5999', '--timeout', '1500']).code, 2, 'unreachable is 2')
})

await test('an unknown op names both methods and commands', () => {
  const err = cli(['nosuchop']).stderr
  ok(err.includes('snapshot'), 'lists a method')
  ok(err.includes('tests.run') || err.includes('view.frameAll'), 'lists a command')
})

await test('arguments that read as JSON arrive as JSON', () => {
  const before = json(['entity', 'coin-2']).properties.value
  const after = json(['set', 'coin-2', 'value', '99']).properties.value
  eq(after, 99, 'a numeric argument arrives as a number, not "99"')
  json(['set', 'coin-2', 'value', String(before)])

  // A path is not JSON and must survive as a string.
  const r = cli(['run', 'code.open', 'types/coin.js'])
  eq(r.code, 0, 'a string argument reaches the command intact')
})

await test('select takes several ids as one list', () => {
  const r = cli(['select', 'coin-0', 'coin-1'])
  eq(r.code, 0, 'two ids do not produce a circular payload')
  eq(json(['snapshot']).selection, ['coin-0', 'coin-1'], 'both ended up selected')
  cli(['select'])
})

await test('flags become an options object on the call', () => {
  ok(!json(['snapshot']).entities, 'absent by default')
  ok(Array.isArray(json(['snapshot', '--entities']).entities), '--entities turns it on')
})

await test('a bulk entity list omits type defaults', () => {
  const list = json(['snapshot', '--entities']).entities
  const plain = list.find(e => e.id === 'coin-0')
  const overridden = list.find(e => e.id === 'coin-2')
  ok(!plain.properties, 'an entity with no overrides carries no properties')
  eq(overridden.properties, { value: 50 }, 'an overridden entity carries only the override')
})

await test('a single entity lookup is complete', () => {
  const e = json(['entity', 'coin-2'])
  eq(e.properties, { value: 50, spin: 120 }, 'defaults included')
  eq(e.overrides, ['value'], 'and which of them were overridden')
})

await test('any plugin command is a CLI verb', () => {
  const ids = json(['commands']).map(c => c.id)
  ok(ids.includes('tests.run'), 'a plugin contributed tests.run')
  const r = json(['tests.run'])
  ok(typeof r.passed === 'number', 'and it runs straight from the terminal')
})

await test('simulate is deterministic for every entity, not just the player', () => {
  // The earlier version of this test checked player-0 only, and passed for
  // weeks while the bat sampled performance.now(). Compare the whole world.
  const run = () => {
    cli(['stop'])
    const s = json(['simulate', '1.5'])
    return { time: s.time, entities: s.entities.map(e => [e.id, ...e.at]) }
  }
  const a = run(), b = run(), c = run()
  eq(b, a, 'second run matches the first')
  eq(c, a, 'third run matches too')
  eq(a.time, 1.5, 'engine time advanced by exactly the amount asked for')
  cli(['stop'])
})

await test('the random stream replays from a seed', () => {
  const draw = seed => json(['eval',
    `engine.seed(${seed}); return [...Array(6)].map(() => engine.editor.context.random())`])
  eq(draw(7), draw(7), 'same seed, same numbers')
  ok(JSON.stringify(draw(7)) !== JSON.stringify(draw(8)), 'a different seed differs')
  json(['seed', '1'])
})

await test('timers run on engine time and land on exact multiples', () => {
  cli(['stop'])
  json(['eval', `globalThis._t = []
    const c = engine.editor.context
    c.after(0.5, () => _t.push(['after', +c.time.toFixed(4)]))
    c.every(0.25, () => _t.push(['every', +c.time.toFixed(4)]))
    return 1`])
  json(['simulate', '1'])
  eq(json(['eval', 'return _t']),
    [['every', 0.25], ['after', 0.5], ['every', 0.5], ['every', 0.75], ['every', 1]],
    'no drift, and no step-late firing')
  cli(['stop'])
})

await test('a throwing timer is contained and reported', () => {
  cli(['stop'])
  json(['clearLog'])
  json(['eval', `engine.editor.context.after(0.1, () => { throw new Error('timer boom') }); return 1`])
  json(['simulate', '0.5'])
  const errs = json(['errors'])
  ok(errs.some(e => /timer boom/.test(e.message)), 'the throw was logged')
  eq(json(['snapshot']).mode, 'edit', 'and the engine is still answering')
  json(['clearLog'])
  cli(['stop'])
})

await test('uncaught errors and rejections reach engine.errors()', () => {
  json(['clearLog'])
  json(['eval', `setTimeout(() => { throw new Error('async boom') }, 0); return 1`])
  json(['eval', `Promise.reject(new Error('rejected boom')); return 1`])
  execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 700)'])
  const errs = json(['errors'])
  ok(errs.some(e => e.source === 'uncaught' && /async boom/.test(e.message)), 'uncaught throw captured')
  ok(errs.some(e => e.source === 'rejection' && /rejected boom/.test(e.message)), 'rejection captured')
  json(['clearLog'])
})

await test('check passes clean and fails on nondeterminism', () => {
  const clean = cli(['check'])
  eq(clean.code, 0, 'the project is clean')
  eq(JSON.parse(clean.stdout).problems, [], 'and says so with no problems')

  const scratch = path.join(ROOT, `project/types/${uniq()}.js`)
  fs.writeFileSync(scratch, [
    'export default {',
    '  update(e) {',
    '    e.rotation = performance.now()',
    '    if (Math.random() < 0.5) setTimeout(() => {}, 1)',
    '  }',
    '}'
  ].join('\n'))
  try {
    const bad = cli(['check'])
    eq(bad.code, 1, 'a violation exits 1 so it can gate a shell chain')
    const p = JSON.parse(bad.stdout).problems
    ok(p.some(x => /performance\.now/.test(x.why)), 'names the wall clock')
    ok(p.some(x => /Math\.random/.test(x.why)), 'names the random source')
    ok(p.some(x => /setTimeout/.test(x.why)), 'names the scheduler')
    ok(p.every(x => x.line > 0), 'every problem has a line number')
  } finally {
    removeAndSettle(scratch)
  }
  eq(cli(['check']).code, 0, 'clean again once removed')
})

await test('a simulated world refuses to save', () => {
  const before = fs.readFileSync(LEVEL, 'utf8')
  cli(['stop'])
  json(['simulate', '1'])
  json(['set', 'coin-2', 'value', '61'])       // would write the simulated state
  eq(fs.readFileSync(LEVEL, 'utf8'), before, 'the level file was left alone')
  cli(['stop'])
})

await test('stop returns the world to its authored state', () => {
  cli(['stop'])
  const start = json(['entity', 'player-0']).at
  json(['simulate', '1.5'])
  ok(json(['entity', 'player-0']).at[1] !== start[1], 'the player moved')
  cli(['stop'])
  eq(json(['entity', 'player-0']).at, start, 'and went back')
})

await test('entity ids survive a reload', () => {
  const before = json(['snapshot', '--entities']).entities.map(e => e.id)
  json(['eval', 'location.reload(); return 1'])
  execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'])   // let it boot
  const after = json(['snapshot', '--entities']).entities.map(e => e.id)
  eq(after, before, 'the same entity has the same id')
})

await test('set persists to the level file', () => {
  cli(['stop'])
  json(['set', 'coin-2', 'value', '77'])
  const onDisk = JSON.parse(fs.readFileSync(LEVEL, 'utf8'))
  const coin = onDisk.entities.filter(e => e.type === 'coin')[2]
  eq(coin.properties.value, 77, 'the write reached disk, not just memory')
  json(['set', 'coin-2', 'value', '50'])
})

await test('index and tree answer without an editor attached', () => {
  const index = json(['index'])
  ok(index.types.coin, 'the index knows the coin type')
  eq(index.types.coin.properties, ['value', 'spin'], 'and its exact properties')
  ok(json(['tree']).some(f => f.path === 'types/coin.js'), 'the tree lists files')
})

await test('eval reaches the page and awaits', () => {
  eq(json(['eval', 'return 6*7']), 42, 'a value comes back')
  eq(json(['eval', 'await 0; return engine.snapshot().level']), 'level1', 'await works')
})

await test('a dev server with no editor attached exits 2, not 1', async () => {
  const vite = spawn('npx', ['vite', '--port', '5188', '--strictPort'], {
    cwd: ROOT, env: { ...process.env, ENGINE_NO_OPEN: '1' }, shell: true, stdio: 'ignore'
  })
  try {
    await new Promise(r => setTimeout(r, 6000))
    const r = cli(['snapshot', '--port', '5188', '--timeout', '2000'])
    eq(r.code, 2, 'exit 2')
    ok(/no editor attached/.test(r.stderr), 'and says how to fix it')
  } finally {
    vite.kill()
  }
})

// ---------------------------------------------------------------- hot reload
/**
 * A fresh name per run.
 *
 * Vite keeps a module-graph entry for a path even after the file is deleted, so
 * re-creating the same path is not an "add" as far as Vite is concerned and it
 * reloads the page. Reusing one name would mean this suite passed on a cold
 * server and failed on every run after — testing the server's history rather
 * than the engine.
 */
const typePath = name => path.join(ROOT, `project/types/${name}.js`)
const body = mass => `export default {\n  collider: { box: [0.8, 0.8] },\n  properties: { body: 'solid', mass: ${mass} }\n}\n`

const alive = () => json(['eval', 'return globalThis.__alive ?? "RELOADED"'])
const markAlive = () => json(['eval', 'globalThis.__alive = 1; return 1'])

await test('a type written while the editor runs is usable without a reload', () => {
  const name = uniq()
  markAlive()
  try {
    fs.writeFileSync(typePath(name), body(3))
    settle(2500)
    eq(alive(), 1, 'the page did not reload')
    ok(json(['eval', `return engine.world.types.has('${name}')`]), 'the new type is registered')
    eq(json(['spawn', name, '{"at":[5,1,0]}']).properties.mass, 3, 'and can be placed')
  } finally {
    removeAndSettle(typePath(name))
  }
})

await test('editing a type moves live entities onto it and keeps overrides', () => {
  const name = uniq()
  try {
    fs.writeFileSync(typePath(name), body(3))
    settle(2500)
    const id = json(['spawn', name, '{"at":[5,1,0]}']).id
    json(['set', id, 'body', 'dynamic'])            // an override the file must not win back
    markAlive()

    fs.writeFileSync(typePath(name), body(42))
    settle(2500)

    eq(alive(), 1, 'still no reload')
    const e = json(['entity', id])
    eq(e.properties.mass, 42, 'the new default reached the live entity')
    eq(e.properties.body, 'dynamic', 'and the per-entity override survived')
  } finally {
    removeAndSettle(typePath(name))
  }
})

await test('a broken type keeps the last good definition running', () => {
  const name = uniq()
  try {
    fs.writeFileSync(typePath(name), body(7))
    settle(2500)
    json(['spawn', name, '{"at":[5,1,0]}'])
    json(['clearLog'])
    markAlive()

    fs.writeFileSync(typePath(name), 'export default { properties: { oops }')   // syntax error
    settle(2500)

    eq(alive(), 1, 'a broken file does not reload the page')
    eq(json(['eval', `return engine.world.all('${name}')[0]?.properties.mass`]), 7,
      'entities keep running the last definition that parsed')
    ok(json(['errors']).some(l => new RegExp(name).test(l.message)), 'and the failure is reported')

    fs.writeFileSync(typePath(name), body(9))                              // recover
    settle(2500)
    eq(json(['eval', `return engine.world.all('${name}')[0]?.properties.mass`]), 9, 'fixing it applies live')
  } finally {
    removeAndSettle(typePath(name))
    json(['clearLog'])
  }
})

await test('a level edited on disk reloads, and the editor\'s own save does not loop', () => {
  const before = fs.readFileSync(LEVEL, 'utf8')
  try {
    const lvl = JSON.parse(before)
    lvl.entities[4].at = [6.5, 7, 0]
    fs.writeFileSync(LEVEL, JSON.stringify(lvl, null, 2))
    settle(2500)
    eq(json(['entity', 'coin-0']).at, [6.5, 7, 0], 'the external edit reached the editor')
  } finally {
    fs.writeFileSync(LEVEL, before)
    settle(2500)
  }

  json(['clearLog'])
  json(['set', 'coin-2', 'value', '50'])
  settle(2000)
  const hot = json(['log', 30]).filter(l => l.source === 'hot' && /level1/.test(l.message))
  eq(hot.length, 0, 'a save the editor made does not come back as a change')
})

await test('a test file written while the editor runs is runnable at once', () => {
  const name = uniq()
  const probe = path.join(ROOT, `project/tests/${name}.js`)
  try {
    fs.writeFileSync(probe, `export default {
      name: 'written while running',
      level: 'level1',
      run(t) { t.is(t.count('coin'), 3, 'three coins') }
    }\n`)
    settle(2500)
    const r = json(['tests.run', name])
    eq(r.passed, 1, 'it ran without a page reload')
    eq(r.failed, 0, 'and passed')
  } finally {
    removeAndSettle(probe)
  }
})

// ---------------------------------------------------- headless, and parallel
/**
 * These are the tests that matter for working in parallel.
 *
 * Every one of them points the CLI at a port nothing is listening on, so a pass
 * proves the world really did start in this process rather than quietly finding
 * the editor that the tests above are using.
 */
const NOWHERE = ['--headless', '--port', '5999']

const headless = args => {
  const r = cli([...args, ...NOWHERE])
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`)
  return JSON.parse(r.stdout)
}

/** The same call, not waited on, so several can be in flight together. */
const headlessAsync = args => new Promise(resolve => {
  const child = spawn(process.execPath, [CLI, ...args, ...NOWHERE], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', c => (stdout += c))
  child.stderr.on('data', c => (stderr += c))
  child.on('close', code => resolve({ code, stdout, stderr }))
})

await test('a headless world starts with no dev server and no browser', () => {
  const s = headless(['snapshot'])
  eq(s.mode, 'edit', 'it opens in edit mode')
  ok(s.counts.entities > 0, 'the level loaded')
  ok(s.counts.plugins > 0, 'the plugins loaded')
  eq(s.errors, [], 'and nothing failed on the way up')
})

await test('headless and the browser agree about the same level', () => {
  const attached = json(['stop']) && json(['snapshot', '--entities'])
  const alone = headless(['snapshot', '--entities', '--level', attached.level])
  eq(alone.counts.entities, attached.counts.entities, 'same entity count')
  eq(alone.byType, attached.byType, 'same entities, type by type')
  eq(alone.entities, attached.entities, 'and every one in the same place')
})

await test('the project tests pass with nothing but node', () => {
  const r = headless(['run', 'tests.run'])
  ok(r.passed > 0, 'tests ran')
  eq(r.failed, 0, `all passed — ${JSON.stringify(r.tests.filter(t => !t.ok))}`)
})

await test('stdout stays one JSON value even when the engine logs', () => {
  const r = cli(['run', 'tests.run', ...NOWHERE])
  eq(r.code, 0, 'it succeeded')
  // Anything the engine prints must go to stderr. A caller that has to strip
  // log lines out of the result will eventually strip the wrong one.
  JSON.parse(r.stdout)
  ok(!r.stdout.trim().includes('\n'), 'exactly one line on stdout')
})

await test('worlds running at once cannot see each other', async () => {
  // Eight of them, all simulating the same level from the same seed. If they
  // shared any state at all — a world, a clock, a random stream — they would
  // not all land on the same answer.
  const runs = await Promise.all(
    Array.from({ length: 8 }, () => headlessAsync(['simulate', '2', '--entities']))
  )
  const bad = runs.filter(r => r.code !== 0)
  eq(bad.length, 0, `every run succeeded — ${bad[0]?.stderr || ''}`)

  const answers = new Set(runs.map(r => JSON.stringify(JSON.parse(r.stdout).entities)))
  eq(answers.size, 1, `all eight agreed, not ${answers.size} different results`)
})

await test('what a headless world changes in memory stays there', () => {
  // Spawn into a private world, then ask the real editor what it has. Memory is
  // private; the project files are not, and `set` writes one — which is why
  // this uses spawn. Two runs that both save a level will collide, and no
  // amount of process isolation fixes that.
  const added = headless(['spawn', 'coin', '{"at":[99,99,0]}'])
  ok(added.id.startsWith('coin-'), 'the private world spawned it')

  const editor = json(['snapshot', '--entities'])
  ok(!editor.entities.some(e => e.at[0] === 99), 'and the attached editor never saw it')
})

await test('index, tree and check need no server at all', () => {
  const port = ['--port', '5999']
  ok(Object.keys(json(['index', ...port]).types).length > 0, 'index lists types')
  ok(json(['tree', ...port]).some(f => f.path.endsWith('.json')), 'tree lists files')
  eq(cli(['check', ...port]).code, 0, 'check passes with nothing running')
})

// ------------------------------------------------------------------ report
fs.writeFileSync(LEVEL, original)   // whatever happened above, leave the file as found

const failed = results.filter(r => !r.ok)
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : '\n    ' + r.error}`)
}
console.log(`\n${results.length - failed.length}/${results.length} passing  ` +
  `(${results.reduce((n, r) => n + r.ms, 0)}ms)`)
process.exit(failed.length ? 1 : 0)
