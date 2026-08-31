#!/usr/bin/env node
/**
 * CLI offline tests — the door itself, with nothing running.
 *
 * The bridge suite (test/cli.test.mjs) needs a dev server and an open editor
 * tab, so its offline assertions are unreachable without one. This suite
 * proves the same door works with nothing running: exit codes, argument
 * coercion, the determinism lint, offline check, and both ledger lifecycles
 * (isolated into temp files via ENGINE_PAIN_FILE and ENGINE_INSIGHT_FILE).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lint, invariantProblems } from '../engine/project-index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'bin/engine.mjs')

const run = (args, options = {}) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout || '', stderr: e.stderr || '' }
  }
}

const painFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-pain-')), 'painpoints.jsonl')
const withPain = (file, args) => run(args, { env: { ...process.env, ENGINE_PAIN_FILE: file } })

const insightFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-insight-')), 'insights.jsonl')
const withInsight = (file, args) => run(args, { env: { ...process.env, ENGINE_INSIGHT_FILE: file } })

test('help exits 0 and names the verb groups', () => {
  const r = run(['help'])
  assert.equal(r.code, 0)
  for (const word of ['snapshot', 'check', 'pain', 'agent.context']) {
    assert.ok(r.stdout.includes(word), `help mentions ${word}`)
  }
})

test('exit codes: 0 ok, 1 bad argument, 2 nothing to talk to', () => {
  assert.equal(run(['check']).code, 0, 'an offline op succeeds')
  const badKind = run(['pain', 'x', '--kind', 'nonsense'])
  assert.equal(badKind.code, 1, 'a bad argument is 1')
  assert.ok(badKind.stderr.includes('--kind must be one of'), 'and says which rule')
  assert.equal(run(['snapshot', '--port', '5999']).code, 2, 'no editor on that port is 2')
})

test('a JSON argument is sent as JSON, not a string', () => {
  // agent.context coerces a JSON array into a file list.
  const r = run(['agent.context', '["engine/world.js"]'])
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.stdout).files, ['engine/world.js'])
})

test('the determinism lint names each banned source with a line', () => {
  const problems = lint('probe.js', [
    'export default {',
    '  update() {',
    '    const now = performance.now()',
    '    const r = Math.random()',
    '    setTimeout(() => {}, 1)',
    '    // a comment may say performance.now() without being a problem',
    '  }',
    '}'
  ].join('\n'))
  assert.ok(problems.some(p => /performance\.now/.test(p.why)), 'names the wall clock')
  assert.ok(problems.some(p => /Math\.random/.test(p.why)), 'names the random source')
  assert.ok(problems.some(p => /setTimeout/.test(p.why)), 'names the scheduler')
  assert.ok(problems.every(p => p.line > 0), 'every problem has a line number')
  assert.equal(problems.length, 3, 'the comment line is not a problem')
})

test('check passes clean with nothing running, and a warning never fails it', () => {
  const r = run(['check'])
  const reply = JSON.parse(r.stdout)
  assert.equal(r.code, 0)
  assert.equal(reply.ok, true)
  assert.deepEqual(reply.problems.filter(p => !p.warning), [], 'nothing fatal')
  // Undescribed types are reported and must never fail the run: a check that
  // failed the build the day it shipped is a check somebody switches off.
  assert.ok(reply.problems.every(p => p.warning), 'anything left is a warning')
})

test('the meadow floor satisfies the invariant its type declares', () => {
  // A real level against a real declaration, so re-breaking the placement turns
  // this red. The machinery itself is proven below, on fixtures — this only
  // asks whether the shipped level keeps the rule.
  const reply = JSON.parse(run(['check', '--project', 'kitten-survivors']).stdout)
  const broken = reply.problems.filter(problem => /invariant/.test(problem.why))
  assert.deepEqual(broken, [], 'the meadow breaks an invariant it declares')
})

test('invariantProblems: a placement that satisfies its type is silent', () => {
  const index = {
    types: { ground: { file: 'types/ground.js', invariant: { rule: 'topFaceAtY', value: 0 }, meshBox: [40, 1, 40] } },
    levels: { meadow: { file: 'levels/meadow.json' } }
  }
  const placements = { meadow: [{ id: 'floor', type: 'ground', at: [0, -0.5, 0] }] }
  assert.deepEqual(invariantProblems(index, placements), [])
})

test('invariantProblems: names the type, the placement, and both numbers', () => {
  const index = {
    types: { ground: { file: 'types/ground.js', invariant: { rule: 'topFaceAtY', value: 0, about: 'top face at y = 0' }, meshBox: [40, 1, 40] } },
    levels: { meadow: { file: 'levels/meadow.json' } }
  }
  const placements = { meadow: [{ id: 'floor', type: 'ground', at: [0, -6.5, 0] }] }
  const problems = invariantProblems(index, placements)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].file, 'levels/meadow.json')
  assert.equal(problems[0].warning, undefined, 'a proven break fails the check')
  assert.match(problems[0].why, /level "meadow"/)
  assert.match(problems[0].why, /placement "floor"/)
  assert.match(problems[0].why, /type "ground"/)
  assert.match(problems[0].why, /top face at y = 0/)
  assert.match(problems[0].why, /expected 0, got -6/)
})

test('invariantProblems: a placement collider with no box replaces the type\'s, not merges', () => {
  // engine/world.js makeEntity: `collider: placement.collider ?? type.collider`
  // — whole object, never key-merged. A placement that swaps in a circle
  // collider has no box at all, even though the type's box would have one.
  const index = {
    types: { ground: { file: 'types/ground.js', invariant: { rule: 'topFaceAtY', value: 0 }, colliderBox: [40, 1, 40] } },
    levels: { meadow: { file: 'levels/meadow.json' } }
  }
  const placements = { meadow: [{ id: 'floor', type: 'ground', at: [0, -0.5, 0], collider: { circle: 2 } }] }
  const problems = invariantProblems(index, placements)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].warning, true, 'unmeasurable is reported, never a silent pass')
  assert.match(problems[0].why, /cannot be checked/)
})

test('invariantProblems: an unknown rule name is reported, never ignored', () => {
  const index = {
    types: { ground: { file: 'types/ground.js', invariant: { rule: 'noSuchRule', value: 0 } } },
    levels: { meadow: { file: 'levels/meadow.json' } }
  }
  const placements = { meadow: [{ id: 'floor', type: 'ground', at: [0, 0, 0] }] }
  const problems = invariantProblems(index, placements)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].warning, true)
  assert.match(problems[0].why, /"noSuchRule"/)
  assert.match(problems[0].why, /does not know how to enforce/)
})

test('pain records, lists and resolves against an isolated file', () => {
  const file = painFile()
  try {
    const recorded = withPain(file, ['pain', 'the thing was hard', '--cost', '500', '--kind', 'cli', '--where', 'bin/engine.mjs'])
    assert.equal(recorded.code, 0)
    assert.equal(JSON.parse(recorded.stdout).id, 'p1', 'first id is p1')

    const listed = JSON.parse(withPain(file, ['pain.list']).stdout)
    assert.equal(listed.open, 1)
    assert.equal(listed.cost, 500)
    assert.equal(listed.byKind.cli.cost, 500)

    const resolved = withPain(file, ['pain.resolve', 'p1', 'added a test for it'])
    assert.equal(JSON.parse(resolved.stdout).id, 'p1')
    const after = JSON.parse(withPain(file, ['pain.list']).stdout)
    assert.equal(after.open, 0, 'the resolved entry no longer counts as open')
    assert.equal(after.resolved, 1)
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})

test('pain rejects a bad kind', () => {
  const file = painFile()
  try {
    const r = withPain(file, ['pain', 'x', '--kind', 'nonsense'])
    assert.equal(r.code, 1)
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})

test('insight records, ranks by saving, and adopts', () => {
  const file = insightFile()
  try {
    const recorded = withInsight(file, ['insight', 'derive it from live pids',
      '--problem', 'state that goes stale after a crash', '--saves', '6000',
      '--kind', 'method', '--tool', 'a lock verb'])
    assert.equal(recorded.code, 0)
    const first = JSON.parse(recorded.stdout)
    assert.equal(first.id, 'i1', 'first id is i1')
    assert.equal(first.problem, 'state that goes stale after a crash', 'the search key is stored')
    assert.equal(first.tool, 'a lock verb')

    withInsight(file, ['insight', 'a cheaper trick', '--saves', '100', '--kind', 'cli'])
    const listed = JSON.parse(withInsight(file, ['insight.list']).stdout)
    assert.equal(listed.open, 2)
    assert.equal(listed.saves, 6100)
    assert.equal(listed.byKind.method.saves, 6000)
    assert.deepEqual(listed.insights.map(record => record.id), ['i1', 'i2'], 'the bigger saving ranks first')

    const adopted = withInsight(file, ['insight.adopt', 'i1', 'added the lock verb'])
    assert.equal(JSON.parse(adopted.stdout).id, 'i1')
    const after = JSON.parse(withInsight(file, ['insight.list']).stdout)
    assert.equal(after.open, 1, 'an adopted insight is off the build queue')
    assert.equal(after.adopted, 1)
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})

test('insight.list searches every record, adopted or not', () => {
  const file = insightFile()
  try {
    withInsight(file, ['insight', 'the one that shipped', '--problem', 'ports collide'])
    withInsight(file, ['insight', 'something else', '--problem', 'unrelated'])
    withInsight(file, ['insight.adopt', 'i1', 'shipped'])

    const found = JSON.parse(withInsight(file, ['insight.list', 'ports', 'collide']).stdout)
    assert.equal(found.found, 1, 'every word must match')
    assert.equal(found.insights[0].id, 'i1', 'an adopted insight is the best answer to a search — a tool exists')

    // Without words the same adopted record is hidden, so searching and
    // listing cannot be answering the same question.
    const listed = JSON.parse(withInsight(file, ['insight.list']).stdout)
    assert.deepEqual(listed.insights.map(record => record.id), ['i2'])

    assert.equal(JSON.parse(withInsight(file, ['insight.list', 'nothingmatchesthis']).stdout).found, 0)
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})

test('insight refuses a bad kind, empty text, and an id it has never seen', () => {
  const file = insightFile()
  try {
    assert.equal(withInsight(file, ['insight', 'x', '--kind', 'nonsense']).code, 1)
    assert.equal(withInsight(file, ['insight']).code, 1, 'an insight with no words says nothing')
    assert.equal(withInsight(file, ['insight.adopt', 'i9', 'no such thing']).code, 1)
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  }
})

test('the two ledgers are separate files', () => {
  const pain = painFile()
  const insight = insightFile()
  try {
    run(['pain', 'friction'], { env: { ...process.env, ENGINE_PAIN_FILE: pain, ENGINE_INSIGHT_FILE: insight } })
    run(['insight', 'a solution'], { env: { ...process.env, ENGINE_PAIN_FILE: pain, ENGINE_INSIGHT_FILE: insight } })
    assert.equal(JSON.parse(withPain(pain, ['pain.list']).stdout).open, 1)
    assert.equal(JSON.parse(withInsight(insight, ['insight.list']).stdout).open, 1, 'one record each, not two in one')
  } finally {
    fs.rmSync(path.dirname(pain), { recursive: true, force: true })
    fs.rmSync(path.dirname(insight), { recursive: true, force: true })
  }
})

test('a headless world starts with nothing running', () => {
  const r = run(['--headless', 'snapshot'])
  assert.equal(r.code, 0, 'the world started')
  assert.equal(JSON.parse(r.stdout).mode, 'edit')
})

/** A read surface over a loader and nothing else. Enough to ask what it says. */
async function inspectOver(loader, bus, log) {
  const { makeInspect } = await import('../engine/inspect.js')
  return makeInspect({
    world: { types: new Map(), entities: [], behaviours: new Map(), all: () => [] },
    loader,
    loop: { running: false, paused: false, time: 0, random: { seed: 1 } },
    files: { pending: 0 },
    bus,
    editor: { levelName: '—', selection: new Set() },
    view: { x: 0, y: 0, zoom: 1, mode: 'ortho' },
    log
  })
}

/**
 * A plugin file that throws on import takes every command it owns with it, and
 * the only symptom is the name of one of them. The loader and the read surface
 * have to say which file broke and why, or the search starts in the wrong place
 * — hunting a command that was never missing, only broken.
 */
test('a plugin that failed to import is named everywhere a command turns up missing', async () => {
  const { makeLoader } = await import('../engine/loader.js')
  const { makeBus } = await import('../engine/bus.js')

  const bus = makeBus()
  const healthy = makeLoader(bus)
  healthy.boot({})
  const wholesome = await inspectOver(healthy, bus)
  assert.deepEqual(healthy.failures(), [])
  assert.equal(wholesome.snapshot().pluginsFailed, undefined, 'a healthy snapshot gains nothing')
  await assert.rejects(() => wholesome.run('nope.nothing'),
    /^Error: no command "nope\.nothing"\. Try engine\.commands\(\)$/,
    'an ordinary typo keeps the short answer')

  const broken = makeLoader(makeBus())
  broken.failedImport('plugins/builtin/see.js', new SyntaxError("Unexpected token '}'"), true)
  broken.boot({})
  const engine = await inspectOver(broken, makeBus())

  assert.deepEqual(broken.failures(), [{
    name: null,
    file: 'plugins/builtin/see.js',
    error: "SyntaxError: Unexpected token '}'",
    builtin: true,
    failedToImport: true
  }])

  const snapshot = engine.snapshot()
  assert.match(snapshot.pluginsFailed[0], /plugins\/builtin\/see\.js failed to import/)
  assert.match(snapshot.errors.at(-1).message, /Every command it contributes is missing/,
    'the default snapshot carries it without being asked')
  assert.deepEqual(engine.snapshot({ plugins: true }).plugins, [{
    file: 'plugins/builtin/see.js', loaded: false, builtin: true, error: "SyntaxError: Unexpected token '}'"
  }])
  await assert.rejects(() => engine.run('see.capture'),
    /plugins\/builtin\/see\.js failed to import: SyntaxError: Unexpected token/,
    'the reply names the file and the reason')
})

/**
 * A log made before the plugins load hears the failure as it happens; one made
 * after has to be told. Both have to end with the same single line, or the
 * wiring that fixes the ordering would double every boot-time error.
 */
test('a log that was listening from the start records a failed plugin exactly once', async () => {
  const { makeLoader } = await import('../engine/loader.js')
  const { makeBus } = await import('../engine/bus.js')
  const { makeLog } = await import('../engine/inspect.js')

  const bus = makeBus()
  const log = makeLog(bus)
  const loader = makeLoader(bus)
  loader.failedImport('plugins/builtin/see.js', new SyntaxError("Unexpected token '}'"), true)
  loader.boot({})

  const engine = await inspectOver(loader, bus, log)
  const failures = engine.snapshot().errors.filter(l => /failed to import/.test(l.message))
  assert.equal(failures.length, 1, 'heard once, not seeded a second time')
  assert.match(failures[0].message, /plugins\/builtin\/see\.js failed to import — SyntaxError/)
})
