/**
 * Two worlds in one process are two worlds.
 *
 * The compiled WebAssembly is shared, and that is right: it is megabytes, seconds
 * to compile, and it holds no simulation. The bridge is not shareable. It maps
 * entities to bodies and reconciles against one entity list, dropping every body
 * that is not in the list — so one bridge over two worlds had each world's step
 * tear down the other's bodies and build them again from the entities, losing
 * velocity, contacts and solver state.
 *
 * The evidence is a world run ALONE. A pair agreeing with each other proves
 * nothing: the pair has to agree with the same level run on its own, which is what
 * a headless fan-out promises. Both bodies having fallen is what makes that
 * meaningful — two worlds with no solver agree just as well.
 *
 * The three worlds share one process on purpose. That is the shape a fan-out has,
 * and it is where the Run Clock bug and this one were both found.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from './fixture-project.mjs'
import { startWorldInNode } from '../engine/start-world-node.mjs'
import { stateHash } from '../engine/world.js'

/** Only 3D. The two builds do not share a bridge, but they share the bug's shape. */
const PROJECT = {
  'game.json': { title: 'two-worlds', startLevel: 'main', plugins: { disabled: ['Physics 3D', 'Physics 2D'] } },
  'levels/main.json': {
    camera: { at: [0, 6] },
    entities: [
      { type: 'floor', at: [0, -1, 0] },
      { type: 'box', at: [0, 6, 0] }
    ]
  },
  'types/floor.js': "export default { collider: { box: [12, 0.4, 12] }, properties: { body: 'solid' } }\n",
  // Two numbers in the box would be Rapier 2D's claim, and three is 3D's.
  'types/box.js': "export default { collider: { box: [0.6, 0.6, 0.6] }, properties: { body: 'dynamic' } }\n"
}

const ROUNDS = 4
const STEPS = 30

const boxOf = world => world.entities.find(entity => entity.type === 'box')
const place = entity => [entity.x, entity.y, entity.z].map(value => Math.round(value * 1e6) / 1e6)

test('a world stepped alongside another is the world it would have been alone', async () => {
  const project = await temporaryProject(PROJECT, 'two-rapier-worlds-')
  try {
    const open = async label => {
      const surface = await startWorldInNode({ root: CHECKOUT, project })
      // Asserted, not assumed: a world whose solver stood down would agree with
      // every other solverless world and prove nothing at all.
      assert.ok(surface.context.rapier3d?.snapshot(), `${label} has no solver`)
      return surface
    }

    const alone = await open('the world run alone')
    const first = await open('the first of the pair')
    const second = await open('the second of the pair')

    for (let round = 0; round < ROUNDS; round++) {
      alone.loop.step(STEPS)
      first.loop.step(STEPS)
      second.loop.step(STEPS)
    }

    assert.ok(boxOf(alone.world).y < 6 - 1,
      `the box should have fallen, so the solver was stepping (y=${boxOf(alone.world).y})`)
    assert.deepEqual(place(boxOf(first.world)), place(boxOf(alone.world)), 'the first world moved as it would alone')
    assert.deepEqual(place(boxOf(second.world)), place(boxOf(alone.world)), 'and so did the second')
    assert.equal(stateHash(first.world), stateHash(alone.world), 'one value, the same conclusion')
    assert.equal(stateHash(second.world), stateHash(alone.world), 'both worlds, each as it would be alone')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})
