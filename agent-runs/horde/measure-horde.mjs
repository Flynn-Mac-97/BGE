/**
 * The wave curve, measured rather than asserted.
 *
 * Runs the meadow headless for twenty minutes of engine time and prints, once a
 * minute: what is alive, what it is made of, how spread out it is, and what the
 * fixed step cost. Nothing here is part of the game — it is the proof.
 *
 *   node agent-runs/horde/measure-horde.mjs [minutes] [walk|still] [kills|nokills]
 *
 * `walk` steers the kitten in a slow circle, which is how the game is actually
 * played. `still` leaves it at the origin, which is the worst case for stacking
 * because every enemy in the world is seeking one point.
 *
 * `kills` stands in for the weapons lane: a ring of damage around the kitten,
 * growing with the minute, applied through the same `context.horde.hurt` a real
 * weapon would call. Without it nothing ever dies and the population cap is the
 * only thing shaping the crowd, which is not the game.
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// A headless world installs its own uncaughtException handler that only records
// the error, which stops node crashing — so without this a mistake in this file
// exits 0 and prints nothing at all. Registered first, so it still speaks.
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, error => {
    process.stderr.write(`\n${signal}: ${error?.stack || error}\n`)
    process.exit(1)
  })
}
const minutes = Number(process.argv[2] || 20)
const walking = (process.argv[3] || 'walk') === 'walk'
const killing = (process.argv[4] || 'kills') === 'kills'
/**
 * Metres across to widen the meadow to before starting, or 0 to leave it.
 *
 * The scaffolded meadow is 40 m of grass and the camera sees 23 m to a corner,
 * so a spawn ring that hides its own spawns does not fit on it. Widening it here
 * is how the horde is measured against the arena it needs rather than against
 * the one the scaffold happened to ship with — that arena belongs to another
 * lane, and this file does not write to the level.
 */
const arenaAcross = Number(process.argv[5] || 0)

const { engine, context, world } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })

const kitten = world.byId('you')

if (arenaAcross > 0) {
  const floor = world.byId('floor')
  floor.mesh = { ...floor.mesh, box: [arenaAcross, 1, arenaAcross] }
  floor.collider = { box: [arenaAcross, 1, arenaAcross] }
}
const STEP = 1 / 60
const WALK_SPEED = 4.2
const WALK_RADIUS = 14

// Start the run the way play does, then step by hand so the kitten can be
// steered between steps — engine.simulate() would run the whole minute at once.
world.simulated = true
for (const entity of [...world.entities]) world.hook(entity, 'start', context)

const rows = []
let slowest = 0
let sweptAt = 0
let experience = 0

// A stand-in for a weapon, on the same seam a real one would use. Fires twice a
// second at everything in a ring, for damage that climbs the way an upgraded
// weapon's would, so the crowd is being thinned while it grows.
const SWEEP_EVERY = 0.5
const SWEEP_RADIUS = 4.5
context.bus.on('enemy:died', event => { experience += event.bounty })

function fireTheStandInWeapon() {
  if (!killing || !kitten) return
  if (context.time - sweptAt < SWEEP_EVERY) return
  sweptAt = context.time
  const damage = 8 + context.time * 0.55
  for (const enemy of context.horde.near(kitten.x, kitten.z, SWEEP_RADIUS)) {
    context.horde.hurt(enemy, damage, 'stand-in weapon')
  }
}

for (let minute = 0; minute < minutes; minute++) {
  const started = process.hrtime.bigint()
  for (let step = 0; step < 60 * 60; step++) {
    if (walking && kitten) {
      // A slow circle, written straight onto the body: headless has no input,
      // and a player that never moves is not the case the crowd is tuned for.
      const angle = (context.time * WALK_SPEED) / WALK_RADIUS
      kitten.x = Math.sin(angle) * WALK_RADIUS
      kitten.z = Math.cos(angle) * WALK_RADIUS
      kitten.velocityX = Math.cos(angle) * WALK_SPEED
      kitten.velocityZ = -Math.sin(angle) * WALK_SPEED
    }
    context.loop.step(1)
    fireTheStandInWeapon()
  }
  const perStep = Number(process.hrtime.bigint() - started) / (60 * 60) / 1e6
  if (perStep > slowest) slowest = perStep

  const stats = engine.run('horde.stats')
  const spread = engine.run('horde.spread')
  const crowd = engine.run('crowd.stats').groups[0]
  rows.push({
    minute: minute + 1,
    alive: stats.alive,
    cap: stats.aliveCap,
    perSecond: stats.perSecond,
    health: stats.healthScale,
    families: stats.aliveByFamily,
    born: stats.born,
    forgotten: stats.forgotten,
    bearings: spread.bearingsUsed,
    overlaps: spread.overlappingPairs,
    deepest: spread.deepestOverlap,
    nearest: spread.distanceToPlayer.nearest,
    mean: spread.distanceToPlayer.mean,
    neighbourTests: crowd.neighbourTests,
    msPerStep: Number(perStep.toFixed(3))
  })
  console.log(
    `min ${String(minute + 1).padStart(2)}  alive ${String(stats.alive).padStart(3)}/${String(stats.aliveCap).padStart(3)}` +
    `  ${String(stats.perSecond).padStart(4)}/s  hp x${String(stats.health ?? stats.healthScale).padStart(4)}` +
    `  bearings ${String(spread.bearingsUsed).padStart(2)}/12  overlaps ${String(spread.overlappingPairs).padStart(4)}` +
    `  deepest ${String(spread.deepestOverlap).padStart(5)}m  nearest ${String(spread.distanceToPlayer.nearest).padStart(5)}m` +
    `  killed ${String(stats.killed).padStart(5)}` +
    `  ${perStep.toFixed(3)} ms/step (${(perStep / 16.67 * 100).toFixed(1)}%)` +
    `  ${Object.entries(stats.aliveByFamily).map(([f, n]) => `${f}:${n}`).join(' ')}`
  )
}

console.log('')
console.log(JSON.stringify({
  walking,
  killing,
  experienceDropped: experience,
  minutes,
  slowestStepMilliseconds: Number(slowest.toFixed(3)),
  budgetUsedAtWorst: `${(slowest / 16.67 * 100).toFixed(1)}%`,
  finalStats: engine.run('horde.stats'),
  finalSpread: engine.run('horde.spread'),
  crowd: engine.run('crowd.stats')
}, null, 2))
