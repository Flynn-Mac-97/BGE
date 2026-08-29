/**
 * What does the engine cost per entity, before the horde adds anything?
 *
 * Answers one question: how much of a fixed step goes on simply having N
 * entities in the world, with and without a three-number collider on them.
 * The collider is what puts an entity into Physics 3D's contact reporting, and
 * that is the only part of the engine whose cost grows with the square of the
 * crowd.
 *
 * Scratch, and disposable — agent-runs/ is where leftovers go.
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const counts = [50, 100, 200, 300, 500, 800]

for (const withCollider of [true, false]) {
  for (const count of counts) {
    const { engine, world, context } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
    world.registerType('dummy', {
      mesh: { box: [0.5, 0.5, 0.5], tint: '#888888' },
      ...(withCollider ? { collider: { box: [0.5, 0.5, 0.5] } } : {}),
      properties: { speed: 2, radius: 0.35 }
    })
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const spread = 3 + (i % 40) * 0.4
      context.spawn('dummy', { at: [Math.sin(angle) * spread, 0.75, Math.cos(angle) * spread] })
    }
    // Warm the code paths so the first measured step is not the compiler's.
    engine.simulate(0.25)
    const started = process.hrtime.bigint()
    engine.simulate(1)
    const nanoseconds = Number(process.hrtime.bigint() - started)
    const perStep = nanoseconds / 60 / 1e6
    console.log(
      `${withCollider ? 'collider  ' : 'no collider'} ${String(count).padStart(4)} entities  ` +
      `${perStep.toFixed(3)} ms/step  ${(perStep / 16.67 * 100).toFixed(1)}% of a 60 Hz frame`
    )
  }
}
