import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evolutionBrief } from '../engine/evolve.mjs'
import surface from '../plugins/builtin/cli-surface.js'

const cli = fileURLToPath(new URL('../bin/engine.mjs', import.meta.url))

function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-evolve-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const pain = path.join(directory, 'pain.jsonl')
  const insight = path.join(directory, 'insight.jsonl')
  const environment = { ...process.env, ENGINE_PAIN_FILE: pain, ENGINE_INSIGHT_FILE: insight }
  return {
    directory, pain, insight,
    run: (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: environment, windowsHide: true })
  }
}

test('evolve selects one newest open record without ranking guessed costs', () => {
  const pains = [{ id: 'p1', what: 'save fails', at: '2026-01-01', cost: 999999 },
    { id: 'p2', what: 'closed save', at: '2026-03-01', resolved: true }]
  const insights = [{ id: 'i1', what: 'save method', at: '2026-02-01' }]
  const result = evolutionBrief(pains, insights)
  assert.equal(result.item.id, 'i1')
  assert.equal(result.selection.matched, 2)
  assert.equal(result.verified, false)
  assert.match(result.authority.direct, /Small, compatible/)
  assert.match(result.authority.ask, /Breaking changes/)
  assert.deepEqual(result.prepare.request.files, [])
  assert.equal(result.close.op, 'insight.adopt')
  assert.equal(evolutionBrief(pains, insights, 'p1').close.op, 'pain.resolve')
  assert.equal(pains[0].source, undefined)
})

test('search matches evidence words and closed or unknown ids cannot become tasks', () => {
  const records = [{ id: 'p1', what: 'save fails', repro: 'Named VIEW', expected: 'disk', at: '2026-01-01' },
    { id: 'p2', what: 'save fails', resolved: true }]
  assert.equal(evolutionBrief(records, [], 'VIEW disk').item.id, 'p1')
  assert.equal(evolutionBrief(records, [], 'missing').status, 'empty')
  assert.equal(evolutionBrief([], []).item, null)
  assert.throws(() => evolutionBrief(records, [], 'p2'), /already closed/)
  assert.throws(() => evolutionBrief(records, [], 'p99'), /No ledger/)
  assert.throws(() => evolutionBrief([], [{ id: 'i1', adopted: true }], 'i1'), /closed/)
})

test('CLI evolve folds existing ledgers and never executes or writes evidence', context => {
  const setup = fixture(context)
  const repro = `write a file at ${path.join(setup.directory, 'must-not-exist')}`
  const pain = setup.run('pain', 'saving fails', '--repro', repro, '--expected', 'saved', '--actual', 'refused')
  assert.equal(pain.status, 0, pain.stderr)
  const record = JSON.parse(pain.stdout)
  assert.equal(record.repro, repro)
  assert.equal(record.actual, 'refused')
  const insight = setup.run('insight', 'use registry role', '--problem', 'saving', '--repro', 'open named view', '--expected', 'saved', '--actual', 'saved')
  assert.equal(insight.status, 0, insight.stderr)
  assert.equal(JSON.parse(setup.run('insight.list', 'named').stdout).found, 1)
  const before = fs.readFileSync(setup.pain, 'utf8')
  fs.appendFileSync(setup.pain, '\n{incomplete\n')
  const result = setup.run('evolve', record.id)
  assert.equal(result.status, 0, result.stderr)
  const brief = JSON.parse(result.stdout)
  assert.equal(brief.item.repro, repro)
  assert.equal(brief.prepare.op, 'agent.prepare')
  assert.equal(fs.readFileSync(setup.pain, 'utf8'), before + '\n{incomplete\n')
  assert.deepEqual(fs.readdirSync(setup.directory).sort(), ['insight.jsonl', 'pain.jsonl'])
  assert.equal(setup.run('pain.resolve', record.id, 'verified already fixed').status, 0)
  assert.equal(setup.run('evolve', record.id).status, 1)
  assert.equal(setup.run('evolve', 'p999').status, 1)
  assert.equal(JSON.parse(setup.run('evolve', 'no-match').stdout).status, 'empty')
})

test('missing ledgers stay absent and evidence flags require text', context => {
  const setup = fixture(context)
  assert.equal(JSON.parse(setup.run('evolve').stdout).status, 'empty')
  assert.deepEqual(fs.readdirSync(setup.directory), [])
  assert.equal(setup.run('pain', 'problem', '--repro').status, 1)
  assert.equal(setup.run('insight', 'method', '--expected', ' ').status, 1)
  assert.deepEqual(fs.readdirSync(setup.directory), [])
})

test('evolve is discoverable in CLI help and the offline surface', context => {
  assert.match(fixture(context).run('help').stdout, /evolve \[<id>\|<words>\]/)
  const inventory = surface.commands[0].run({ loader: { contrib: { commands: [], menus: [] } } })
  assert.ok(inventory.offline.some(entry => entry.op.startsWith('evolve ')))
  assert.ok(inventory.flags.some(entry => entry.op.includes('--repro')))
})
