/**
 * The Live Camera plugin: the level's highest-priority camera, running every
 * drawn frame, following a body where it is drawn.
 *
 * This is the plugin's own test. The draw-time blend it reads is the kernel's
 * and is covered in `test/core/loop/live-camera.test.mjs`; here the claim is the
 * plugin's — priority, activation, and the mouse turn reaching the view on the
 * frame it arrives.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHECKOUT, temporaryProject } from './fixture-project.mjs'
import { startWorldInNode } from '../engine/start-world-node.mjs'

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

const near = (got, want, message) => assert.ok(Math.abs(got - want) < 1e-6, `${message}: got ${got}, want ${want}`)

test('the highest priority camera is live and holds its distance behind the body', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: PROJECT })
  engine.simulate(0.5)
  const walker = context.world.byId('walker')
  assert.equal(context.cameras.state().live, 'near')
  near(context.view.z, 4, 'at yaw 0 the eye is behind the body along +Z')
  near(context.view.x, walker.x, 'and level with it')
  assert.equal(context.view.follows, 'walker')
})

test('activate makes a camera live regardless of priority', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: PROJECT })
  context.cameras.activate('far')
  engine.simulate(0.1)
  assert.equal(context.cameras.state().live, 'far')
  near(context.view.z, 10, 'the far camera placed the eye')
})

test('mouse turn reaches the view on the next frame, not a later step', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: PROJECT })
  engine.simulate(0.1)
  context.input.lookBy(0.25, 0)
  engine.simulate(1 / 60)
  near(context.view.yaw, 0.25, 'the whole turn is applied')
})
