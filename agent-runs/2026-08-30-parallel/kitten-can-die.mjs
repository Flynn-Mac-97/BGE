/**
 * A survivor you cannot lose is a screensaver with a kill counter.
 *
 * Every part of contact damage existed and none of it was joined. The five
 * families each declare `contactDamage`; the Horde publishes
 * `context.horde.touching(entity)` and its own guide calls it "what is eating
 * the kitten"; Health owns `context.damage`. Nothing read the first and nothing
 * called the second, so the health bar read 100/100 through a run of five
 * thousand kills.
 *
 * A level-up holds the world until a card is picked, so this picks them — a
 * headless run with nobody at the keyboard otherwise freezes on the first one
 * and every later measurement reads the same frozen second back.
 *
 *   node agent-runs/2026-08-30-parallel/kitten-can-die.mjs
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const ROOT = 'Z:/Code/browser game engine'

let failures = 0
const check = (ok, label, detail) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (detail !== undefined) console.log('     ', JSON.stringify(detail)) }
}

const { context, engine, world, loop } = await startWorldInNode({ root: ROOT, project: `${ROOT}/kitten-survivors` })

// ---- the wiring exists at all ----
check(typeof context.run === 'function', 'the kernel command runner survived plugin boot', typeof context.run)
check(typeof context.horde?.touching === 'function', 'the horde publishes touching()')
check(typeof context.damage === 'function', 'health publishes damage()')

engine.play()

/**
 * A second of play, with the level-up cards answered.
 *
 * A level-up holds the world until a card is picked and nobody is at the
 * keyboard, so an unanswered card freezes the clock and every later reading
 * gives the same second back. Picked AFTER the step rather than inside the
 * `choice:offered` handler, and one-based, the way the number keys are.
 */
let picks = 0
const second = () => {
  loop.step(60)
  while (loop.holds.includes('choice-screen')) {
    if (!context.run('choice.pick', 1).ok) break
    picks++
  }
}

const kitten = world.byId('you')
const health = () => context.health.of(kitten)?.health ?? kitten.properties.health

// ---- the crowd reaches the kitten, and touching() sees it ----
let reached = 0
for (let n = 0; n < 60 && !reached; n++) { second(); reached = context.horde.touching(kitten, 0.05).length }
check(reached > 0, 'the horde reaches the kitten and touching() reports it', { reached })

// ---- standing in it costs health ----
const started = health()
for (let n = 0; n < 30; n++) second()
check(health() < started, 'standing in the crowd costs health', { started, now: Math.round(health()) })

// ---- and the run ends ----
let over = world.state.runOver === true
for (let n = 0; n < 400 && !over; n++) { second(); over = world.state.runOver === true }
check(over === true, 'the run ends', { clock: world.state.runClock, level: world.state.level, picks })
check(Math.round(health()) === 0, 'because the kitten ran out of health', Math.round(health()))
check(context.health.alive(kitten) === false, 'and is not alive at the end of it')

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
