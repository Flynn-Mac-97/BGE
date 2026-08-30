/**
 * Population against the clock, in the real game.
 *
 * `measure-horde.mjs` predates the progression lane and freezes the moment the
 * kitten levels up: Choice Screen holds the clock, nothing picks a card, and
 * every minute after 0:23 re-reads the same frozen world. This harness plays
 * the run the way a player does — the four real weapons fire, experience is
 * walked over, and every level-up takes the first card — so what it prints is
 * what the shipped game produces.
 *
 *   node agent-runs/horde/measure-density.mjs [minutes] [walk|still]
 *
 * The kitten is healed every step. This measures density, not survival —
 * a run that ends at 4:12 answers nothing about minute ten.
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// The headless world's own handler records errors without exiting, so a
// mistake here would exit 0 and print nothing. Registered first.
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, error => {
    process.stderr.write(`\n${signal}: ${error?.stack || error}\n`)
    process.exit(1)
  })
}

const minutes = Number(process.argv[2] || 10)
const walking = (process.argv[3] || 'walk') === 'walk'

const { engine, context, world } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })

const kitten = world.byId('you')
const STEP_BATCH = 1
const WALK_SPEED = 4.2
const WALK_RADIUS = 14

// Start the run the way play does, then step by hand so the kitten can be
// steered and the choice screen answered between steps.
world.simulated = true
for (const entity of [...world.entities]) world.hook(entity, 'start', context)

let picks = 0
let slowest = 0
const rows = []

for (let minute = 0; minute < minutes; minute++) {
  const started = process.hrtime.bigint()
  let stepped = 0
  // Count steps by the engine clock, not the loop iterations: a held step
  // advances nothing, and sixty seconds must mean sixty seconds of game.
  const until = (minute + 1) * 60
  while (context.time < until - 1e-9) {
    if (walking && kitten) {
      const angle = (context.time * WALK_SPEED) / WALK_RADIUS
      kitten.x = Math.sin(angle) * WALK_RADIUS
      kitten.z = Math.cos(angle) * WALK_RADIUS
      kitten.velocityX = Math.cos(angle) * WALK_SPEED
      kitten.velocityZ = -Math.sin(angle) * WALK_SPEED
    }
    // Density is the question, so the kitten must not die mid-answer.
    if (kitten?.damageable) {
      kitten.damageable.maxHealth = 10000
      kitten.damageable.health = 10000
      kitten.damageable.alive = true
    }
    context.loop.step(STEP_BATCH)
    stepped++
    while (context.choiceScreen?.isOpen) { context.choiceScreen.pick(0); picks++ }
  }
  const perStep = Number(process.hrtime.bigint() - started) / Math.max(1, stepped) / 1e6
  if (perStep > slowest) slowest = perStep

  const stats = engine.run('horde.stats')
  const spread = engine.run('horde.spread')
  rows.push({ minute: minute + 1, alive: stats.alive, cap: stats.aliveCap, msPerStep: Number(perStep.toFixed(3)) })
  console.log(
    `min ${String(minute + 1).padStart(2)}  alive ${String(stats.alive).padStart(3)}/${String(stats.aliveCap).padStart(3)}` +
    `  (${(stats.alive / stats.aliveCap * 100).toFixed(0)}% of cap)` +
    `  ${String(stats.perSecond).padStart(4)}/s  born ${String(stats.born).padStart(5)}  killed ${String(stats.killed).padStart(5)}` +
    `  forgotten ${String(stats.forgotten).padStart(4)}  nearest ${String(spread.distanceToPlayer.nearest).padStart(5)}m` +
    `  ${perStep.toFixed(3)} ms/step (${(perStep / 16.67 * 100).toFixed(1)}%)` +
    `  ${Object.entries(stats.aliveByFamily).map(([f, n]) => `${f}:${n}`).join(' ')}`
  )
}

const capShare = rows.reduce((sum, row) => sum + row.alive / row.cap, 0) / rows.length
console.log('')
console.log(JSON.stringify({
  walking,
  minutes,
  choiceCardsPicked: picks,
  meanShareOfCap: `${(capShare * 100).toFixed(1)}%`,
  slowestStepMilliseconds: Number(slowest.toFixed(3)),
  budgetUsedAtWorst: `${(slowest / 16.67 * 100).toFixed(1)}%`,
  atTheMarks: rows.filter(row => [1, 5, 10, 15, 20].includes(row.minute))
}, null, 2))
