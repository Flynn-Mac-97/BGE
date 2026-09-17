#!/usr/bin/env node
/**
 * Live Camera and draw-time blending: the camera follows where a body is drawn,
 * the mouse turns it on the frame it arrives, and priority picks the live one.
 *
 *   node --test test/live-camera.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startWorldInNode } from '../engine/start-world-node.mjs'
import { makeWorld } from '../engine/world.js'
import { makeBus } from '../engine/bus.js'
import { makeLoop } from '../engine/loop.js'
import { temporaryProject } from './fixture-project.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PROJECT = await temporaryProject({
  'game.json': { title: 'cameras', startLevel: 'main' },
  'types/walker.js': 'export default { update(entity, seconds) { entity.x += seconds } }\n',
  'levels/main.json': {
    cameras: [
      { id: 'far', kind: 'third-person', follow: 'walker', priority: 1, distance: 10, pitch: 0, offsetY: 0 },
      { id: 'near', kind: 'third-person', follow: 'walker', priority: 5, distance: 4, pitch: 0, offsetY: 0 }
    ],
    entities: [{ id: 'walker', type: 'walker', at: [0, 1, 0] }]
  }
}, 'engine-live-camera-')

/** Animation frames the test calls by hand, at times it chooses. Returns a function that undoes it. */
function fakeScreen(frames) {
  const saved = { requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, document: globalThis.document, now: performance.now }
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

const near = (got, want, message) => assert.ok(Math.abs(got - want) < 1e-6, `${message}: got ${got}, want ${want}`)

test('the highest priority camera is live and holds its distance behind the body', async () => {
  const { context, engine } = await startWorldInNode({ root: ROOT, project: PROJECT })
  engine.simulate(0.5)
  const walker = context.world.byId('walker')
  assert.equal(context.cameras.state().live, 'near')
  near(context.view.z, 4, 'at yaw 0 the eye is behind the body along +Z')
  near(context.view.x, walker.x, 'and level with it')
  assert.equal(context.view.follows, 'walker')
})

test('activate makes a camera live regardless of priority', async () => {
  const { context, engine } = await startWorldInNode({ root: ROOT, project: PROJECT })
  context.cameras.activate('far')
  engine.simulate(0.1)
  assert.equal(context.cameras.state().live, 'far')
  near(context.view.z, 10, 'the far camera placed the eye')
})

test('mouse turn reaches the view on the next frame, not a later step', async () => {
  const { context, engine } = await startWorldInNode({ root: ROOT, project: PROJECT })
  engine.simulate(0.1)
  context.input.lookBy(0.25, 0)
  engine.simulate(1 / 60)
  near(context.view.yaw, 0.25, 'the whole turn is applied')
})

test('on a 144 Hz screen a steadily moving body is drawn moving evenly every frame', () => {
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

test('a body is drawn between its last two steps by the blend fraction', () => {
  const world = makeWorld(makeBus())
  const body = { id: 'body', x: 0, y: 0, z: 0, yaw: 0 }
  world.entities.push(body)
  world.rememberPlaces()
  body.x = 2
  body.yaw = 1
  const halfway = world.drawnPlace(body, 0.5)
  near(halfway.x, 1, 'x is halfway')
  near(halfway.yaw, 0.5, 'yaw is halfway')
  near(world.drawnPlace(body, 1).x, 2, 'a blend of 1 is the current place')
  near(world.drawnPlace({ x: 7, y: 0 }, 0.5).x, 7, 'a body with no earlier place is drawn where it is')
})
