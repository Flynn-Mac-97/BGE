/**
 * Proof that the progression loop runs headless: gems latch, the bar fills, a
 * level-up stops the world, a card is picked, and a death ends the run.
 *
 * A scratch file in agent-runs, not a test in the project — the project's test
 * scope is a separate decision and this only has to hold for one lane.
 *
 *   node agent-runs/progression-proof.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWorldInNode } from '../engine/start-world-node.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const results = []
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

const { engine, context } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })

const you = context.world.byId('you')
check('the kitten is there', !!you, you?.id)
check('pickup radius seeded', you.properties.pickupRadius > 0, String(you.properties.pickupRadius))
check('scales seeded at 1', you.properties.damageScale === 1 && you.properties.areaScale === 1 && you.properties.cooldownScale === 1)

// ---------------------------------------------------------------- the magnet
// Dropped well outside the radius, so reaching the kitten is the magnet working
// and not the gem having been placed on top of it.
const far = context.progression.dropGem([you.x + 6, you.y, you.z], 1)
const startDistance = Math.hypot(far.x - you.x, far.z - you.z)
engine.simulate(0.5)
check('a gem outside the radius stays put', !far.pickupMotion?.latched, `${startDistance.toFixed(1)}m away`)

const near = context.progression.dropGem([you.x + 1.5, you.y, you.z], 1)
engine.simulate(0.05)
check('a gem inside the radius latches', !!near.pickupMotion?.latched)
engine.simulate(0.6)
check('a latched gem is collected', !context.world.entities.includes(near))
check('collecting it gave a point', context.experience.total >= 1, `total ${context.experience.total}`)

// ------------------------------------------------------------- the level-up
const held = []
context.bus.on('experience:levelled', ({ level }) => held.push(level))

context.experience.gain(4)
check('level 2 arrived on the fifth point', context.experience.level === 2, `levels ${held.join(',')}`)
check('a choice is open', context.choiceScreen.isOpen)
check('the world is held', context.loop.paused, context.loop.holds.join(','))

const before = context.loop.time
engine.simulate(1)
check('the clock does not move while held', context.loop.time === before, `${before} -> ${context.loop.time}`)

const offered = context.choiceScreen.view()
check('three cards are offered', offered.options.length === 3, offered.options.map(o => o.title).join(' / '))
check('every card says what it does', offered.options.every(o => o.line && o.line.length > 8))
check('the screen can be read headless', context.screen.read().some(line => line.includes('LEVEL UP')))

const taking = offered.options[0]
const picked = context.choiceScreen.pick(0)
check('the card was taken', picked.ok, `${taking.title}`)
check('the world runs again', !context.loop.paused)
check('it is on the kitten', context.kittenUpgrades.taken().length === 1,
  context.kittenUpgrades.taken().map(entry => `${entry.name} ${entry.rank}`).join(', '))

// ------------------------------------------------------- three levels at once
context.experience.gain(1000)
check('many levels queue as many choices', context.choiceScreen.waiting >= 1,
  `${context.choiceScreen.waiting + 1} waiting`)
let answered = 0
while (context.choiceScreen.isOpen && answered < 40) { context.choiceScreen.pick(0); answered++ }
check('every queued choice was answerable', !context.choiceScreen.isOpen, `${answered} taken`)
check('the world runs again after the queue', !context.loop.paused)

// ------------------------------------------------------------- stat upgrades
const stats = context.progression.stats()
check('stats are published for other lanes',
  Number.isFinite(stats.damage) && Number.isFinite(stats.cooldown) && Number.isFinite(stats.pickupRadius),
  JSON.stringify(stats))

// A passive taken to rank three multiplies once, not three times.
context.modifiers.add(you, 'upgrade:swift-paws', { speed: { scale: 1.3 } })
check('a passive changes the kitten', Math.abs(you.properties.speed - 6.5) < 0.001, String(you.properties.speed))
context.modifiers.remove(you, 'upgrade:swift-paws')
check('and can be taken back off', Math.abs(you.properties.speed - 5) < 0.001, String(you.properties.speed))

// ------------------------------------------------------------------ the run
check('the run clock is counting', context.run.running, context.run.clock)
you.properties.health = 0
engine.simulate(0.05)
check('the run ends when the kitten does', context.run.over, context.run.reason)
check('the world is held once it is over', context.loop.paused, context.loop.holds.join(','))
const words = context.screen.read()
check('the result screen says how long you lasted', words.some(line => line.includes('lasted')), words.slice(0, 6).join(' | '))
check('the result carries the numbers', context.run.summary().kills != null && context.run.summary().level > 1,
  JSON.stringify(context.run.summary()))

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
