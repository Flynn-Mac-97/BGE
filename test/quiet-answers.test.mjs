/**
 * Three places the engine used to give a confidently wrong answer.
 *
 * p105 — a hidden tab drives the loop from a clamped timer and the game runs in
 *        slow motion while every other number reads healthy. `loop.state` now
 *        names the driver and measures the speed.
 * p85  — a tint on a type multiplies into every textured placement that did not
 *        state its own. `check` now reports the pair.
 *
 * Run: node --test test/quiet-answers.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { makeLoop } from '../engine/loop.js'
import { buildIndex, problemsIn, fatal, tintProblems } from '../engine/project-index.mjs'

// ------------------------------------------------------------------ p105

/**
 * A loop with every clock it touches under the test's control.
 *
 * The real thing reads `performance.now`, `document.hidden`,
 * `requestAnimationFrame` and `setInterval` off the global object, so a driver
 * is chosen by replacing those four and nothing else. Wall time only moves when
 * the test moves it, so the measured rate is exact rather than whatever the
 * machine happened to manage.
 */
function drivenLoop({ hidden }) {
  const saved = {
    performance: globalThis.performance,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    error: console.error
  }

  let wall = 0
  let frameCallback = null
  let intervalCallback = null
  const errors = []

  const set = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

  set('performance', { now: () => wall })
  set('document', { hidden, addEventListener() {} })
  set('requestAnimationFrame', callback => { frameCallback = callback; return 1 })
  set('cancelAnimationFrame', () => {})
  set('setInterval', callback => { intervalCallback = callback; return 2 })
  set('clearInterval', () => {})
  console.error = line => errors.push(String(line))

  const loop = makeLoop({ onFixed: () => {}, onFrame: () => {} })

  return {
    loop,
    errors,
    /** Move the wall clock on and let whichever driver is fitted have one tick. */
    tick(milliseconds) {
      wall += milliseconds
      if (frameCallback) { const next = frameCallback; frameCallback = null; next(wall) }
      else if (intervalCallback) intervalCallback()
    },
    /** Move the wall clock on and give the driver nothing. */
    starve(milliseconds) { wall += milliseconds },
    restore() {
      for (const [name, value] of Object.entries(saved)) {
        if (name === 'error') console.error = value
        else Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
      }
    }
  }
}

test('a stopped loop says so and claims no rate', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    assert.deepEqual(driven.loop.state, { driver: 'stopped' })
  } finally { driven.restore() }
})

test('a visible tab reports requestAnimationFrame at real speed, and warns about nothing', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    driven.loop.start()
    assert.equal(driven.loop.state.driver, 'requestAnimationFrame')
    for (let i = 0; i < 90; i++) driven.tick(1000 / 60)

    const state = driven.loop.state
    assert.equal(state.driver, 'requestAnimationFrame')
    assert.ok(state.ticksPerSecond > 55 && state.ticksPerSecond < 65, `ticksPerSecond ${state.ticksPerSecond}`)
    assert.ok(state.gameSpeed > 0.9 && state.gameSpeed < 1.1, `gameSpeed ${state.gameSpeed}`)
    assert.equal(state.warning, undefined)
    assert.deepEqual(driven.errors, [])
  } finally { driven.restore() }
})

test('a hidden tab names the timer, measures the crawl, and reports it as an error', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    assert.equal(driven.loop.state.driver, 'setInterval (tab hidden)')

    // Chrome clamps a background timer to roughly this. Every tick is then
    // capped at 0.25s of catch-up and MAX_CATCHUP throws the rest away.
    for (let i = 0; i < 4; i++) driven.tick(3000)

    const state = driven.loop.state
    assert.equal(state.driver, 'setInterval (tab hidden)')
    assert.ok(state.ticksPerSecond < 1, `ticksPerSecond ${state.ticksPerSecond}`)
    assert.ok(state.gameSpeed < 0.1, `gameSpeed ${state.gameSpeed}`)
    assert.ok(state.behindSeconds > 10, `behindSeconds ${state.behindSeconds}`)
    assert.match(state.warning, /running at .* real time/)
    assert.match(state.warning, /setInterval \(tab hidden\)/)

    assert.ok(driven.errors.length >= 1, 'the slow loop was never reported to console.error')
    assert.match(driven.errors[0], /^\[loop\]/)
    assert.match(driven.errors[0], /behind the wall/)
  } finally { driven.restore() }
})

test('the clock really does fall behind, so the run is not just under-reported', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    for (let i = 0; i < 4; i++) driven.tick(3000)
    // Twelve wall seconds in, and MAX_CATCHUP has let through five steps a tick.
    assert.ok(driven.loop.time < 1, `engine clock reached ${driven.loop.time}s in 12 wall seconds`)
  } finally { driven.restore() }
})

test('a driver that stops firing collapses the rate, not holds the speed it used to run at', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    driven.loop.start()
    for (let i = 0; i < 90; i++) driven.tick(1000 / 60)
    assert.ok(driven.loop.state.gameSpeed > 0.9)

    // The open window wins once it is longer than a full one, so a hundred
    // silent seconds drown whatever the last closed window had counted.
    driven.starve(100_000)
    const state = driven.loop.state
    assert.ok(state.ticksPerSecond < 1, `ticksPerSecond ${state.ticksPerSecond}`)
    assert.ok(state.gameSpeed < 0.05, `gameSpeed ${state.gameSpeed}`)
    assert.match(state.warning, /real time/)
  } finally { driven.restore() }
})

test('reset re-baselines the measurement instead of claiming the run is hours behind', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    driven.loop.start()
    for (let i = 0; i < 120; i++) driven.tick(1000 / 60)
    driven.loop.reset()
    assert.ok(driven.loop.state.behindSeconds < 0.001,
      `behindSeconds ${driven.loop.state.behindSeconds} after reset`)
  } finally { driven.restore() }
})

// ------------------------------------------------------------------- p85

/** An index shaped the way buildIndex shapes one, with a single tinted type. */
const indexWithTintedType = (tint = '#7a3cff') => ({
  types: { prop: { file: 'types/prop.js', meshTint: tint } },
  levels: { arena: { file: 'levels/arena.json' } }
})

const textured = { type: 'prop', id: 'a', mesh: { texture: 'grass.png' } }

test('a tinted type plus a textured placement with no tint is reported', () => {
  const found = tintProblems(indexWithTintedType(), { arena: [textured, { ...textured, id: 'b' }] })
  assert.equal(found.length, 1)
  assert.equal(found[0].file, 'levels/arena.json')
  assert.equal(found[0].warning, true)
  assert.match(found[0].why, /type "prop"/)
  assert.match(found[0].why, /2 times/)
  assert.match(found[0].why, /#7a3cff/)
})

test('a placement that states its own tint is not reported', () => {
  const placement = { type: 'prop', id: 'a', mesh: { texture: 'grass.png', tint: '#ffffff' } }
  assert.deepEqual(tintProblems(indexWithTintedType(), { arena: [placement] }), [])
})

test('a white tint on the type multiplies nothing and is not reported', () => {
  for (const white of ['#fff', '#FFFFFF', 'white', 0xffffff]) {
    assert.deepEqual(tintProblems(indexWithTintedType(white), { arena: [textured] }), [],
      `tint ${white} was reported`)
  }
})

test('a placement with no texture is not reported', () => {
  const placement = { type: 'prop', id: 'a', mesh: { box: [1, 1, 1] } }
  assert.deepEqual(tintProblems(indexWithTintedType(), { arena: [placement] }), [])
})

test('a type with no tint is not reported', () => {
  const index = { types: { prop: { file: 'types/prop.js' } }, levels: { arena: { file: 'levels/arena.json' } } }
  assert.deepEqual(tintProblems(index, { arena: [textured] }), [])
})

// --------------------------------------------------- p85, through buildIndex

/** A whole project on disk, so the index build and `check` are exercised for real. */
async function temporaryProject(typeSource, placements) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quiet-answers-'))
  await fs.mkdir(path.join(directory, 'types'), { recursive: true })
  await fs.mkdir(path.join(directory, 'levels'), { recursive: true })
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true })
  await fs.writeFile(path.join(directory, 'assets/probe.png'), '')
  await fs.writeFile(path.join(directory, 'types/prop.js'), typeSource)
  await fs.writeFile(path.join(directory, 'levels/arena.json'), JSON.stringify({ entities: placements }))
  return directory
}

const TINTED_TYPE = `export default {
  about: 'a prop',
  mesh: { box: [1, 1, 1], tint: '#7a3cff' }
}
`

const PLAIN_TYPE = `export default {
  about: 'a prop',
  mesh: { box: [1, 1, 1] }
}
`

test('buildIndex records the type tint and check reports the pair without failing', async () => {
  const directory = await temporaryProject(TINTED_TYPE, [
    { id: 'one', type: 'prop', mesh: { texture: 'probe.png' } }
  ])
  try {
    const index = await buildIndex(directory)
    assert.equal(index.types.prop.meshTint, '#7a3cff')
    assert.equal(index.tintProblems.length, 1)

    const problems = problemsIn(index)
    const said = problems.filter(problem => /multiplies the texture/.test(problem.why))
    assert.equal(said.length, 1)
    // A tinted type may be deliberate, so it is reported and never fatal.
    assert.equal(fatal(problems).length, 0, JSON.stringify(fatal(problems)))
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('an untinted type over the same level says nothing, so a clean project stays clean', async () => {
  const directory = await temporaryProject(PLAIN_TYPE, [
    { id: 'one', type: 'prop', mesh: { texture: 'probe.png' } }
  ])
  try {
    const index = await buildIndex(directory)
    assert.equal(index.types.prop.meshTint, undefined)
    assert.deepEqual(index.tintProblems, [])
    assert.equal(fatal(problemsIn(index)).length, 0)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
