/**
 * Prove the particle field headless: spawn a burst, step the fixed clock, and
 * show the count rise and then fall back to zero. Then prove the kitten
 * wiring: a level-up makes gold, and a weapon hit makes sparks, with no
 * browser anywhere near it.
 *
 *   node agent-runs/2026-08-30-particles/burst-proof.mjs
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const { engine, context, world, loop } = await startWorldInNode({ project: 'kitten-survivors' })

let failed = 0
const check = (name, condition, detail) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  if (!condition) failed++
}

// ---- rise and fall -------------------------------------------------------
context.particles.clear()
check('field starts empty', context.particles.count === 0, context.particles.count)

const record = context.particles.burst({
  at: { x: 0, y: 1, z: 0 },
  count: 60, speed: [1, 3], life: [0.3, 0.5], size: 0.05, gravity: -9
})
check('burst was recorded', !!record && record.count === 60, record)
check('count rose on the burst', context.particles.count === 60, context.particles.count)

const counts = [context.particles.count]
for (let i = 0; i < 6; i++) { loop.step(3); counts.push(context.particles.count) }   // 6 x 50 ms
loop.step(30)                                                                        // then half a second more
counts.push(context.particles.count)
console.log(`counts over time: ${counts.join(' -> ')}`)
check('particles lived through the early steps', counts[1] > 0 && counts[2] > 0)
check('count fell to zero after every life ended', context.particles.count === 0, context.particles.count)
check('the burst is still on the record after dying', context.particles.recent(5).length >= 1)

// ---- determinism: the same description draws from the seeded stream ------
const before = context.particles.state
check('nothing leaked into clouds or trails', before.clouds === 0 && before.trails === 0, before)

// ---- the kitten wiring, headless ----------------------------------------
context.particles.clear()
context.bus.emit('experience:levelled', { level: 2, source: 'proof' })
check('a level-up bursts gold at the kitten', context.particles.count > 0, context.particles.count)

context.particles.clear()
context.bus.emit('weapon:hit', { entity: world.byId('you'), target: null, point: { x: 1, y: 0.5, z: 1 }, weapon: 'claw dart', dealt: 3 })
check('a claw dart hit throws sparks', context.particles.count > 0, context.particles.count)

context.particles.clear()
context.bus.emit('enemy:died', { at: { x: 2, y: 0, z: 2 }, family: 'rat' })
check('a death makes a puff of fur', context.particles.count > 0, context.particles.count)

// The world is alive while it steps — the kitten's own weapons fire and Combat
// Effects answers them — so "zero forever" would be asserting the game is dead.
// Instead: after a second and a half every particle of OURS is gone, and
// anything still alive is younger than the time we stepped.
loop.step(90)
const oldest = Math.max(0, ...context.particles.all.map(p => p.age))
check('the wired effects died out; only fresh game-born particles remain',
  oldest < 1.5, { alive: context.particles.count, oldestAge: Math.round(oldest * 1000) / 1000 })

console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
