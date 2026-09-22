/**
 * Draw-time blending: a body is drawn between its last two fixed steps, so a
 * high-refresh screen shows smooth motion without the simulation stepping
 * between frames.
 *
 * `loop.blend` is the fraction of a step the wall clock is past the last one,
 * and `world.drawnPlace(entity, blend)` gives where a body is drawn. Game code
 * reads `x`; a camera reads the drawn place. The fixed step itself is exactly
 * 1/60 and never wall time, which is what makes a stepped world repeat.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { makeWorld } from '../../engine/world.js'
import { makeBus } from '../../engine/bus.js'
import { makeLoop, FIXED_STEP } from '../../engine/loop.js'

test('a body is drawn between its last two steps by the blend fraction', () => {
  const world = makeWorld(makeBus())
  const body = { id: 'body', x: 0, y: 0, z: 0, yaw: 0 }
  world.entities.push(body)

  world.rememberPlaces()
  body.x = 2
  body.yaw = 1

  const halfway = world.drawnPlace(body, 0.5)
  assert.equal(halfway.x, 1, 'x is halfway between the two steps')
  assert.equal(halfway.yaw, 0.5, 'and so is the turn')
  assert.equal(world.drawnPlace(body, 1).x, 2, 'a blend of 1 is the current place')
  assert.equal(world.drawnPlace({ x: 7, y: 0 }, 0.5).x, 7, 'a body with no earlier place is drawn where it is')
})

/** Animation frames the test calls by hand, at times it chooses. Returns a function that undoes it. */
function fakeScreen(frames) {
  const saved = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    document: globalThis.document,
    now: performance.now
  }
  globalThis.requestAnimationFrame = callback => frames.push(callback)
  globalThis.cancelAnimationFrame = () => {}
  globalThis.document = { hidden: false, addEventListener() {} }
  performance.now = () => 0
  return () => {
    for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'document']) {
      if (saved[name] === undefined) delete globalThis[name]
      else globalThis[name] = saved[name]
    }
    performance.now = saved.now
  }
}

test('on a high-refresh screen a steadily moving body is drawn moving every frame', () => {
  const frames = []
  const restore = fakeScreen(frames)
  try {
    const world = makeWorld(makeBus())
    const body = { id: 'body', x: 0, y: 0, z: 0 }
    world.entities.push(body)
    const drawn = []
    const loop = makeLoop({
      onStepStart: () => world.rememberPlaces(),
      onFixed: seconds => { body.x += seconds },
      onFrame: () => drawn.push(world.drawnPlace(body, loop.blend).x)
    })

    loop.start()
    for (let frame = 1; frame <= 300; frame++) frames.shift()?.(frame * 1000 / 144)
    loop.stop()

    const moves = drawn.slice(20).map((x, index) => x - drawn[19 + index])
    const still = moves.filter(move => move < 1e-9).length
    const largest = Math.max(...moves)
    assert.equal(still, 0, 'no frame draws the body standing still')
    assert.ok(largest < 1.5 / 144, `no frame jumps a whole step: largest move ${largest}`)
  } finally {
    restore()
  }
})

test('a stepped world is drawn as it is, and the fixed step is exactly 1/60', () => {
  const loop = makeLoop({ onFixed: () => {}, onFrame: () => {} })
  assert.equal(FIXED_STEP, 1 / 60)

  loop.step(60)
  assert.equal(loop.steps, 60)
  assert.ok(Math.abs(loop.time - 1) < 1e-9, `60 fixed steps must be one second, got ${loop.time}`)
  assert.equal(loop.blend, 1, 'a stepped world is read as it is, not between steps')
})
