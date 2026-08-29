/**
 * How many enemies does the simulation actually hold?
 *
 * The Horde's own cap is set for the renderer, not for the simulation, so this
 * asks the other question: with the real families, the real crowd steering and
 * the real contact pass, what does a fixed step cost at each population?
 *
 *   node agent-runs/horde/measure-ceiling.mjs
 *
 * The crowd is packed around a standing kitten, which is the worst case — every
 * member has the most neighbours it will ever have, so the separation walk does
 * the most work it will ever do.
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const counts = [100, 200, 400, 600, 800, 1200, 1600, 2400, 3200]

console.log('population   ms/step   share of a 60 Hz frame   neighbour tests/step')
for (const count of counts) {
  const { context, world } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
  const floor = world.byId('floor')
  floor.mesh = { ...floor.mesh, box: [200, 1, 200] }
  floor.collider = { box: [200, 1, 200] }

  world.simulated = true
  for (const entity of [...world.entities]) world.hook(entity, 'start', context)

  // Real enemy types, real steering, real contact pass — but placed here rather
  // than through the director, because the director's whole job is to refuse to
  // exceed its cap and the cap is the thing being questioned.
  const families = context.horde.families
  const crowd = context.crowd.get('horde')
  for (let i = 0; i < count; i++) {
    const angle = (i * 2.399963) % (Math.PI * 2)
    const distance = 1 + Math.sqrt(i) * 0.36
    context.horde.admit(families[i % families.length], Math.sin(angle) * distance, Math.cos(angle) * distance)
  }

  context.loop.step(30)
  const started = process.hrtime.bigint()
  context.loop.step(120)
  const perStep = Number(process.hrtime.bigint() - started) / 120 / 1e6
  const stats = crowd.stats

  console.log(
    `${String(context.horde.count).padStart(10)}   ${perStep.toFixed(3)}   ` +
    `${(perStep / 16.67 * 100).toFixed(1).padStart(5)}%   ${String(stats.neighbourTests).padStart(10)}`
  )
}
