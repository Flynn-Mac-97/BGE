/**
 * The engine surface: the names a caller drives a world through.
 *
 * `engine.*` is read by the CLI, the editor bridge and agents, so the list is a
 * contract. `simulate` runs the fixed step — never wall time — and reports when
 * a hold stopped it short, so a caller that reads only the reply can tell a
 * simulated second from a held one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHECKOUT, FIXTURE } from '../../fixture-project.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'

/** The names the kernel documents on `engine`. */
const ENGINE_NAMES = [
  'snapshot',
  'entity',
  'commands',
  'run',
  'select',
  'play',
  'stop',
  'simulate',
  'seed',
  'log',
  'errors',
  'clearLog',
  'marks',
  'mark',
  'stepBack',
  'seek',
  'renderStats',
  'spawn',
  'destroy'
]

test('every documented engine name is a function on the surface', async () => {
  const { engine } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  for (const name of ENGINE_NAMES) assert.equal(typeof engine[name], 'function', `engine.${name}`)
})

test('simulate advances by the fixed step, so one second is sixty steps', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  const steps = context.loop.steps

  engine.simulate(1)

  assert.equal(context.loop.steps - steps, 60)
  assert.ok(Math.abs(context.loop.time - 1) < 1e-9, `one second of fixed steps, got ${context.loop.time}`)
})

test('a hold stops simulate short, and the reply says what held it', async () => {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  context.loop.hold('choosing an upgrade')

  const snapshot = engine.simulate(1)

  assert.equal(snapshot.asked, 1, 'the reply names what was asked for')
  assert.ok(snapshot.advanced < 1 / 120, `a held step advanced ${snapshot.advanced}`)
  assert.deepEqual(snapshot.heldBy, ['choosing an upgrade'])
})

test('entity answers with the entity or null, and spawn and destroy move the count', async () => {
  const { engine, context } = await startWorldInNode({ root: CHECKOUT, project: FIXTURE })
  const type = context.world.entities[0].type
  const before = context.world.entities.length

  const spawned = engine.spawn(type, { at: [4, 5, 0] })
  assert.equal(context.world.entities.length, before + 1)
  assert.equal(engine.entity(spawned.id).id, spawned.id)

  engine.destroy(spawned.id)
  assert.equal(context.world.entities.length, before)
  assert.equal(engine.entity('no-such-entity'), null)
})
