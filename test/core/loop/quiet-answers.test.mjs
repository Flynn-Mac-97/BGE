/**
 * The engine must not answer confidently when it is wrong.
 *
 * Three places it once did, and the rule each now keeps:
 * - a hidden tab drives the loop from a clamped timer, so the game runs slow
 *   while every other number reads healthy; `loop.state` names the driver and
 *   measures the speed, and a slow run is reported.
 * - a tint on a type multiplies into every textured placement that did not state
 *   its own; `check` reports the pair without failing the build.
 * - a three-axis rotation is a list, and a list rounded as a number is NaN; a
 *   level round trip keeps every axis and rounds each one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { makeLoop, FIXED_STEP } from '../../../engine/loop.js'
import { makeWorld } from '../../../engine/world.js'
import { buildIndex } from '../../../engine/project-index.mjs'
import { tintProblems } from '../../../engine/index-invariants.js'
import { problemsIn, fatal } from '../../../engine/project-problems.mjs'

// ------------------------------------------------------- the loop's own report

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

  const set = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

  set('performance', { now: () => wall })
  set('document', { hidden, addEventListener() {} })
  set('requestAnimationFrame', callback => {
    frameCallback = callback
    return 1
  })
  set('cancelAnimationFrame', () => {})
  set('setInterval', callback => {
    intervalCallback = callback
    return 2
  })
  set('clearInterval', () => {})
  console.error = line => errors.push(String(line))

  const loop = makeLoop({ onFixed: () => {}, onFrame: () => {} })

  return {
    loop,
    errors,
    /** Move the wall clock on and let whichever driver is fitted have one tick. */
    tick(milliseconds) {
      wall += milliseconds
      if (frameCallback) {
        const next = frameCallback
        frameCallback = null
        next(wall)
      } else if (intervalCallback) intervalCallback()
    },
    /** Move the wall clock on and give the driver nothing. */
    starve(milliseconds) {
      wall += milliseconds
    },
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
  } finally {
    driven.restore()
  }
})

test('a visible tab reports requestAnimationFrame at real speed, and warns about nothing', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    driven.loop.start()
    assert.equal(driven.loop.state.driver, 'requestAnimationFrame')
    for (let index = 0; index < 90; index++) driven.tick(1000 / 60)

    const state = driven.loop.state
    assert.equal(state.driver, 'requestAnimationFrame')
    assert.ok(state.ticksPerSecond > 55 && state.ticksPerSecond < 65, `ticksPerSecond ${state.ticksPerSecond}`)
    assert.ok(state.gameSpeed > 0.9 && state.gameSpeed < 1.1, `gameSpeed ${state.gameSpeed}`)
    assert.equal(state.warning, undefined)
    assert.deepEqual(driven.errors, [])
  } finally {
    driven.restore()
  }
})

test('a hidden tab names the timer, measures the crawl, and reports it as an error', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    assert.equal(driven.loop.state.driver, 'setInterval (tab hidden)')

    // A background timer is clamped to roughly this. Every tick is then capped
    // at 0.25s of catch-up and the rest is thrown away.
    for (let index = 0; index < 4; index++) driven.tick(3000)

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
  } finally {
    driven.restore()
  }
})

test('the clock really does fall behind, so the run is not just under-reported', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    for (let index = 0; index < 4; index++) driven.tick(3000)
    assert.ok(driven.loop.time < 1, `engine clock reached ${driven.loop.time}s in 12 wall seconds`)
  } finally {
    driven.restore()
  }
})

test('a driver that stops firing collapses the rate, not holds the speed it used to run at', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    driven.loop.start()
    for (let index = 0; index < 90; index++) driven.tick(1000 / 60)
    assert.ok(driven.loop.state.gameSpeed > 0.9)

    // The open window wins once it is longer than a full one, so a hundred
    // silent seconds drown whatever the last closed window had counted.
    driven.starve(100_000)
    const state = driven.loop.state
    assert.ok(state.ticksPerSecond < 1, `ticksPerSecond ${state.ticksPerSecond}`)
    assert.ok(state.gameSpeed < 0.05, `gameSpeed ${state.gameSpeed}`)
    assert.match(state.warning, /real time/)
  } finally {
    driven.restore()
  }
})

test('reset re-baselines the measurement instead of claiming the run is hours behind', () => {
  const driven = drivenLoop({ hidden: false })
  try {
    driven.loop.start()
    for (let index = 0; index < 120; index++) driven.tick(1000 / 60)
    driven.loop.reset()
    assert.ok(driven.loop.state.behindSeconds < 0.001, `behindSeconds ${driven.loop.state.behindSeconds} after reset`)
  } finally {
    driven.restore()
  }
})

// ------------------------------------------------------ the tint lint

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
    assert.deepEqual(tintProblems(indexWithTintedType(white), { arena: [textured] }), [], `tint ${white} was reported`)
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

// ----------------------------------------------------- the level round trip

/** One entity in a world, saved back out. The bus is only emitted to. */
function savedPlacement(placement) {
  const world = makeWorld({ on() {}, emit() {} })
  world.retype('prop', {})
  world.spawn('prop', { type: 'prop', at: [1, 2, 3], ...placement })
  return world.toLevel().entities[0]
}

test('a three-axis rotation survives a toLevel round trip unchanged', () => {
  const saved = savedPlacement({ rotation: [10, 20, 30] })
  assert.deepEqual(saved.rotation, [10, 20, 30])
  // JSON is where the loss showed: Math.round of a list is NaN, written as null.
  assert.equal(JSON.parse(JSON.stringify(saved)).rotation.join(), '10,20,30')
})

test('a bare yaw still comes back as exactly the number it was', () => {
  assert.equal(savedPlacement({ rotation: 45 }).rotation, 45)
})

test('every axis of a rotation is rounded, not just carried through', () => {
  assert.deepEqual(savedPlacement({ rotation: [10.00049, 20.5, 30.12349] }).rotation, [10, 20.5, 30.123])
})

test('positions still round to three places', () => {
  assert.deepEqual(savedPlacement({ at: [1.00049, 2.5, 3.12349] }).at, [1, 2.5, 3.123])
})

// ------------------------------------------------- the lint through a project

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
  const directory = await temporaryProject(TINTED_TYPE, [{ id: 'one', type: 'prop', mesh: { texture: 'probe.png' } }])
  try {
    const index = await buildIndex(directory)
    assert.equal(index.types.prop.meshTint, '#7a3cff')
    assert.equal(index.tintProblems.length, 1)

    const problems = problemsIn(index)
    const said = problems.filter(problem => /multiplies the texture/.test(problem.why))
    assert.equal(said.length, 1)
    // A tinted type may be deliberate, so it is reported and never fatal.
    assert.equal(fatal(problems).length, 0, JSON.stringify(fatal(problems)))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('an untinted type over the same level says nothing, so a clean project stays clean', async () => {
  const directory = await temporaryProject(PLAIN_TYPE, [{ id: 'one', type: 'prop', mesh: { texture: 'probe.png' } }])
  try {
    const index = await buildIndex(directory)
    assert.equal(index.types.prop.meshTint, undefined)
    assert.deepEqual(index.tintProblems, [])
    assert.equal(fatal(problemsIn(index)).length, 0)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

// --------------------------------------------- the clock's own answers

test('behindSeconds is wall time minus engine time since the clock was last set', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.loop.resume({ steps: 600 })
    driven.tick(1000)

    // One second of wall time, five steps of engine time past the resumed count.
    const engineSeconds = driven.loop.time - 600 * FIXED_STEP
    const expected = Math.round((1 - engineSeconds) * 1000) / 1000
    assert.equal(driven.loop.state.behindSeconds, expected)
  } finally {
    driven.restore()
  }
})

test('a window of exactly one second with no ticks reports zero ticks and a warning', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.starve(1000)

    const state = driven.loop.state
    assert.equal(state.ticksPerSecond, 0)
    assert.equal(typeof state.warning, 'string', 'a run with no ticks is slow and must say so')
  } finally {
    driven.restore()
  }
})

test('a window still open reports no movement when no step ran since it opened', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.tick(1000)
    driven.starve(2000)
    assert.equal(driven.loop.state.gameSpeed, 0)
  } finally {
    driven.restore()
  }
})

test('a run at exactly half speed is not reported as slow', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    // Twenty-five steps before the window, five inside it, over one wall second.
    driven.loop.step(25)
    driven.tick(1000)
    assert.deepEqual(driven.errors, [])
  } finally {
    driven.restore()
  }
})

test('a run at exactly half speed carries no warning', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.loop.step(25)
    driven.tick(1000)
    assert.equal(driven.loop.state.warning, undefined)
  } finally {
    driven.restore()
  }
})

test('a slow loop is reported again after the report interval', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    for (let index = 0; index < 11; index++) driven.tick(1000)
    assert.equal(driven.errors.length, 2, 'once when the window first closes, once ten seconds later')
  } finally {
    driven.restore()
  }
})

test('a rate window closes on the first tick that fills it', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.tick(1000)
    assert.equal(driven.errors.length, 1)
  } finally {
    driven.restore()
  }
})

test('a rate window stays open until a full window has passed', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.tick(1000)
    driven.tick(500)
    assert.equal(driven.loop.state.ticksPerSecond, 1, 'the half-full window is not a window yet')
  } finally {
    driven.restore()
  }
})

test('a closed window measures its own ticks and engine seconds', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.tick(1000)
    driven.tick(1000)

    const state = driven.loop.state
    assert.equal(state.ticksPerSecond, 1)
    assert.equal(state.gameSpeed, 0.083, 'five steps over the second the window measured')
  } finally {
    driven.restore()
  }
})

test('a frame that elapsed exactly one step runs that step', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.tick(1000 / 60)
    assert.equal(driven.loop.steps, 1)
  } finally {
    driven.restore()
  }
})

test('a frame never runs more than five catch-up steps', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    driven.tick(1000)
    assert.equal(driven.loop.steps, 5, 'a quarter second of backlog, capped at MAX_CATCHUP')
    assert.equal(driven.loop.blend, 1, 'and the backlog is dropped rather than drawn through')
  } finally {
    driven.restore()
  }
})

test('stop leaves the loop not running', () => {
  const driven = drivenLoop({ hidden: true })
  try {
    driven.loop.start()
    assert.equal(driven.loop.running, true)
    driven.loop.stop()
    assert.equal(driven.loop.running, false)
    assert.deepEqual(driven.loop.state, { driver: 'stopped' })
  } finally {
    driven.restore()
  }
})
