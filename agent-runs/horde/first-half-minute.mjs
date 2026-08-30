// Is the meadow already a crowd at 0:30? One number, measured.
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { engine, context, world } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
world.simulated = true
for (const entity of [...world.entities]) world.hook(entity, 'start', context)
for (let step = 0; step < 30 * 60; step++) {
  context.loop.step(1)
  while (context.choiceScreen?.isOpen) context.choiceScreen.pick(0)
}
const stats = engine.run('horde.stats')
console.log(JSON.stringify({ time: stats.time, alive: stats.alive, cap: stats.aliveCap, born: stats.born, killed: stats.killed }))
