/**
 * The determinism guarantees: the fixed step, one reset for clock and streams,
 * two streams that cannot move each other, and the restore order.
 *
 * These are the product. A run must repeat from a seed, a level load must begin
 * alike every time, and an effect that draws a random number must not move where
 * an enemy spawns. `stateHash` equality over two runs is covered by
 * `state-hash.test.mjs` and the rewind stride by `rewind.test.mjs`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLoop, FIXED_STEP } from '../../engine/loop.js'
import { CHECKOUT, FIXTURE } from '../fixture-project.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

test('the fixed step is exactly 1/60, so a step count is a time', () => {
  assert.equal(FIXED_STEP, 1 / 60)
  const loop = makeLoop({ onFixed() {}, onFrame() {} })
  loop.step(60)
  assert.equal(loop.steps, 60)
  assert.ok(Math.abs(loop.time - 1) < 1e-9, `sixty fixed steps must be one second, got ${loop.time}`)
})

test('reset puts the clock, the stream, the input, the timers and the holds back together', () => {
  const loop = makeLoop({ onFixed() {}, onFrame() {} })
  loop.step(30)
  loop.random()
  loop.after(1, () => {})
  loop.input.press('KeyD')
  loop.hold('paused')

  assert.ok(loop.steps > 0)
  assert.equal(loop.input.isDown('KeyD'), true)
  assert.equal(loop.timers.length, 1)
  assert.equal(loop.paused, true)

  loop.reset(7)

  assert.equal(loop.steps, 0, 'the clock')
  assert.equal(loop.time, 0)
  assert.equal(loop.random.seed, 7, 'the stream')
  assert.equal(loop.random.draws, 0)
  assert.equal(loop.input.isDown('KeyD'), false, 'the input')
  assert.equal(loop.timers.length, 0, 'the timers')
  assert.equal(loop.paused, false, 'the holds')
})

test('a level load begins alike, with the clock and the stream at zero', async () => {
  const { context } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  context.loop.step(120)
  assert.ok(context.loop.steps > 0)

  await context.editor.loadLevel('main')

  assert.equal(context.loop.steps, 0)
  assert.equal(context.loop.time, 0)
  assert.equal(context.loop.random.draws, 0)
})

test('the drawing stream is separate, so an effect cannot move a spawn', () => {
  const plain = makeLoop({ onFixed() {}, onFrame() {} })
  plain.reset(1234)
  const spawns = [plain.random(), plain.random(), plain.random()]

  const withEffects = makeLoop({ onFixed() {}, onFrame() {} })
  withEffects.reset(1234)
  for (let index = 0; index < 50; index++) withEffects.drawing()

  assert.deepEqual([withEffects.random(), withEffects.random(), withEffects.random()], spawns,
    'drawing a picture must not advance the simulation stream')
})

test('a restore puts plugins back before the world, and the loop last', async () => {
  const { context } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  let seen = null
  context.checkpoints.add('Order', {
    capture: () => ({ at: 0 }),
    restore: () => { seen = context.loop.steps; return true }
  })

  context.loop.step(30)
  const moment = context.capture()
  context.loop.step(30)

  context.restore(moment)

  assert.equal(seen, 60, 'the plugin restored before the clock was put back')
  assert.equal(context.loop.steps, 30, 'and the clock came back after it')
})
