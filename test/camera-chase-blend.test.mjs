/**
 * The chase camera places its eye for the frame being drawn.
 *
 * The body is drawn `blend` of the way between its last two fixed steps. The
 * eye must follow the same blended point, or it moves in steps under a body
 * that moves smoothly and the body shakes on screen.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHECKOUT, temporaryProject } from './fixture-project.mjs'
import { startWorldInNode } from '../engine/start-world-node.mjs'
import camera from '../plugins/builtin/camera.js'

const PROJECT = await temporaryProject({
  'game.json': { title: 'chase', startLevel: 'main' },
  'types/walker.js': 'export default { update(entity, seconds) { entity.x += seconds * 6 } }\n',
  'levels/main.json': {
    camera: { mode: 'third-person', follow: 'walker', pitch: -0.5, yaw: 0, distance: 5, lerp: 1 },
    entities: [{ id: 'walker', type: 'walker', at: [0, 1, 0] }]
  }
}, 'engine-chase-blend-')

const frameSystem = camera.systems.find(system => system.phase === 'frame')

test('halfway between two steps, the eye is halfway between where each step put it', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: PROJECT })
  context.bus.emit('play:started')
  engine.simulate(0.5)
  const eyeNow = context.view.x
  const stepMoved = context.camera.focus.x - context.camera.focusBefore.x
  assert.ok(stepMoved > 0.05, `the walker moved in the last step (${stepMoved})`)

  frameSystem.run(context.world, 1 / 120, { ...context, loop: { blend: 0.5 } })
  assert.ok(Math.abs(context.view.x - (eyeNow - stepMoved / 2)) < 1e-9, `the eye is half a step back: ${context.view.x}`)

  frameSystem.run(context.world, 1 / 120, { ...context, loop: { blend: 1 } })
  assert.ok(Math.abs(context.view.x - eyeNow) < 1e-9, 'at a blend of 1 it is where the last step put it')
})
