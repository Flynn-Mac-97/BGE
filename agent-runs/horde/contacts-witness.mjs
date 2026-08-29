/**
 * Did rewriting Physics 3D's contact pass change what it reports?
 *
 * Runs a real level for several seconds and prints every contact pair and every
 * body's resting place. Run it once on each side of the change and diff the two
 * files: identical output is the only proof that a faster pass is the same pass.
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const project = process.argv[2] || 'project'
const seconds = Number(process.argv[3] || 5)

const { engine, context, world } = await startWorldInNode({ root: ROOT, project })

// A mover that ends up inside another mover, and one resting on a solid, so both
// halves of the pass are exercised rather than only the one this level happens
// to use.
const seenCollisions = []
world.registerType('witness', {
  mesh: { box: [0.6, 0.6, 0.6], tint: '#ff00ff' },
  collider: { box: [0.6, 0.6, 0.6] },
  properties: { body: 'dynamic' },
  onCollide(entity, other) { seenCollisions.push(`${entity.id} touched ${other.id}`) }
})
for (let i = 0; i < 6; i++) context.spawn('witness', { at: [0.2 * i, 4 + i, -0.2 * i] })

engine.simulate(seconds)

const bodies = engine.run('physics3d.bodies')
console.log(JSON.stringify({
  project,
  seconds,
  contacts: [...bodies.contacts].sort(),
  collisions: [...new Set(seenCollisions)].sort(),
  bodies: bodies.bodies.map(b => `${b.id} ${b.at.join(',')} grounded=${b.grounded}`).sort()
}, null, 2))
