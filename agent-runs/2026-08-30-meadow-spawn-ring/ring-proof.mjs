/**
 * Proof for lane loop2-arena: with the camera rule read (as in any real
 * session), every spawn lands on the ring measured from the play camera —
 * just past the visible edge, never in view.
 *
 * Run from the worktree root:
 *   node agent-runs/2026-08-30-meadow-spawn-ring/ring-proof.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { startWorldInNode } = await import(pathToFileURL(join(root, 'engine', 'start-world-node.mjs')))
const { engine, editor } = await startWorldInNode({ root, project: 'kitten-survivors' })
const context = editor.context

// A browser session has long since read the level's camera rule off disk; a
// one-shot simulate has not. Wait for it, then measure like a played game.
await context.camera.ruleRead

const spawned = []
const admit = context.horde.admit
context.horde.admit = (family, x, z) => {
  const target = context.horde.target()
  spawned.push(Math.hypot(x - (target?.x ?? 0), z - (target?.z ?? 0)))
  return admit(family, x, z)
}

engine.simulate(30, { entities: false })

const stats = context.horde.stats
spawned.sort((a, b) => a - b)
const round = n => Math.round(n * 1000) / 1000
console.error(JSON.stringify({
  cameraSees: stats.cameraSees,
  ring: stats.ring,
  arena: stats.arena,
  spawns: spawned.length,
  nearestSpawn: round(spawned[0]),
  farthestSpawn: round(spawned[spawned.length - 1]),
  allOffScreen: spawned.every(d => d >= stats.cameraSees),
  allOnRing: spawned.every(d => d >= stats.ring[0] - 0.001 && d <= stats.ring[1] + 0.001)
}))
process.exit(0)
