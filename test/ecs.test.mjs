/**
 * ECS: the vendored world advances on the engine's own fixed clock.
 *
 * The plugin promises one thing a test can hold it to: an ECS system runs on the
 * engine's fixed step with the engine's `seconds`, so a component moves by the
 * same clock an engine entity does and a headless run repeats. A private clock,
 * a frame-phase system, or a missed step shows up as a different position.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { startWorldInNode } from '../engine/start-world-node.mjs'
import { CHECKOUT, FIXTURE } from './fixture-project.mjs'

/** Steps simulated. Two seconds at the engine's fixed 1/60 s step. */
const STEPS = 120

test('an ECS system advances on the engine fixed step with the engine delta', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })

  const ecs = context.ecs
  assert.ok(ecs, 'the plugin puts the ECS service on context')

  const Position = ecs.defineComponent('Position')
  const Velocity = ecs.defineComponent('Velocity')
  const entity = ecs.createEntity()
  ecs.addComponent(entity, Position, { x: 0, y: 0 })
  ecs.addComponent(entity, Velocity, { x: 2, y: -3 })

  ecs.systems.push(ecs.defineSystem('move', (world, { deltaSeconds }) => {
    for (const one of world.query([Position, Velocity])) {
      const at = world.getComponent(one, Position)
      const by = world.getComponent(one, Velocity)
      at.x += by.x * deltaSeconds
      at.y += by.y * deltaSeconds
    }
  }))

  engine.simulate(STEPS / 60)

  const at = ecs.getComponent(entity, Position)
  assert.ok(Math.abs(at.x - 2 * (STEPS / 60)) < 1e-9, `x should be 4, was ${at.x}`)
  assert.ok(Math.abs(at.y - -3 * (STEPS / 60)) < 1e-9, `y should be -6, was ${at.y}`)
})
