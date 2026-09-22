import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { main, parseQuickProbeArgs, quickProbe } from '../tools/dream/quick-probe.mjs'

test('the probe defaults to a short exploration sample with no heap cycles', () => {
  const parsed = parseQuickProbeArgs(['--project', 'game'])
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.options.frames, 30)
  assert.equal(parsed.options.warmSeconds, 3)
  assert.equal(parsed.options.cycles, 0)
  assert.equal(parsed.options.project, 'game')
})

test('--help answers usage instead of a measurement', () => {
  assert.deepEqual(parseQuickProbeArgs(['--help']), { help: true })
})

test('a missing project, an unknown flag and a bad value are refused before a browser starts', () => {
  assert.match(parseQuickProbeArgs([]).error, /--project is required/)
  assert.match(parseQuickProbeArgs(['--nope', 'x']).error, /unknown option/)
  assert.match(parseQuickProbeArgs(['--project', 'g', '--frames', 'many']).error, /--frames/)
  assert.match(parseQuickProbeArgs(['--project', 'g', '--warm-seconds', '-1']).error, /--warm-seconds/)
  assert.match(parseQuickProbeArgs(['--project', 'g', '--size', 'wide']).error, /--size/)
  assert.match(parseQuickProbeArgs(['--project', 'g', '--camera', '{oops']).error, /--camera/)
  assert.match(parseQuickProbeArgs(['--project']).error, /--project needs a value/)
})

test('a valid command line reads every supported option', () => {
  const parsed = parseQuickProbeArgs(['--project', 'g', '--level', 'main', '--frames', '12', '--warm-seconds', '2', '--cycles', '1', '--size', '640x360', '--camera', '{"x":1}', '--picture', 'p.png', '--compare-to', 'r.png', '--profile', 'c.cpuprofile', '--out', 'o.json'])
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.options.level, 'main')
  assert.equal(parsed.options.frames, 12)
  assert.equal(parsed.options.warmSeconds, 2)
  assert.equal(parsed.options.cycles, 1)
  assert.deepEqual(parsed.options.size, [640, 360])
  assert.deepEqual(parsed.options.camera, { x: 1 })
  assert.equal(parsed.options.profileOut, 'c.cpuprofile')
  assert.equal(parsed.options.out, 'o.json')
})

test('the probe measures the named checkout, project and level and reports all provenance', async () => {
  const seen = []
  const measure = async (checkout, project, options) => {
    seen.push({ checkout, project, options })
    return { measures: { cpuMs: 42, frameMs: 50, drawCalls: 10, browser: 'chrome' }, difference: null, problem: null }
  }
  const checkout = path.resolve('engine-checkout')
  const result = await quickProbe({
    checkout, project: 'the-game', level: 'main', frames: 12, warmSeconds: 1, cycles: 0, profileOut: 'p.cpuprofile', measure
  })

  assert.equal(result.ok, true)
  assert.equal(result.problem, null)
  assert.equal(result.exploratory, true)
  assert.equal(result.provenance.checkout, checkout)
  assert.equal(result.provenance.project, path.resolve(checkout, 'the-game'))
  assert.equal(result.provenance.level, 'main')
  assert.equal(result.provenance.frames, 12)
  assert.equal(result.provenance.warmSeconds, 1)
  assert.equal(result.provenance.profile, 'p.cpuprofile')
  assert.equal(result.provenance.browser, 'chrome')
  assert.equal(result.measures.cpuMs, 42)
  assert.equal(seen.length, 1, 'the measurement was not run once')
  assert.equal(seen[0].project, path.resolve(checkout, 'the-game'), 'the project was not resolved against the checkout')
  assert.equal(seen[0].options.level, 'main')
  assert.equal(seen[0].options.profileOut, 'p.cpuprofile')
  assert.equal(seen[0].options.cycles, 0)
})

test('a measurement problem or a thrown measurement is reported, not hidden', async () => {
  const problem = await quickProbe({ project: 'g', measure: async () => ({ measures: {}, problem: 'no drawn frame' }) })
  assert.equal(problem.ok, false)
  assert.equal(problem.problem, 'no drawn frame')

  const thrown = await quickProbe({ project: 'g', measure: async () => { throw new Error('boom') } })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.problem, 'boom')
  assert.deepEqual(thrown.measures, {})
})

test('the command prints its JSON, writes --out, and answers the result as an exit code', async () => {
  const out = path.join(os.tmpdir(), `dream-quick-probe-${process.pid}.json`)
  const writes = []
  const stdout = { write: text => { writes.push(text); return true } }
  const stderr = { write() {} }
  const measure = async () => ({ measures: { cpuMs: 1 }, difference: null, problem: null })

  const ok = await main(['--project', 'g', '--out', out], { measure, stdout, stderr })
  assert.equal(ok, 0)
  const result = JSON.parse(writes.join(''))
  assert.equal(result.ok, true)
  assert.equal(result.measures.cpuMs, 1)
  assert.equal(JSON.parse(await fs.readFile(out, 'utf8')).ok, true)
  await fs.rm(out, { force: true })

  const bad = await main(['--frames', '10'], { measure, stdout, stderr })
  assert.equal(bad, 1, 'a missing project did not fail')
  assert.equal(writes.length, 1, 'a refused command line still measured')
})

test('a failed measurement exits non-zero while printing the result', async () => {
  const writes = []
  const code = await main(['--project', 'g'], {
    measure: async () => ({ measures: {}, problem: 'timed out waiting for the dev server' }),
    stdout: { write: text => { writes.push(text); return true } },
    stderr: { write() {} }
  })
  assert.equal(code, 1)
  assert.equal(JSON.parse(writes.join('')).problem, 'timed out waiting for the dev server')
})
