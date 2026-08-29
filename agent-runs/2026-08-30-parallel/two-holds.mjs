/**
 * A pause and a hit stop are two things, and one word held both.
 *
 * Two lanes added a `hold` to the kernel loop in the same round. Git merged
 * them into one object literal without a conflict, and JavaScript kept the
 * later definition — so `loop.hold('choice-screen')` reached the hit-stop
 * verb, `Math.round(NaN)` gave nothing, and the world never paused. Nothing
 * threw. The upgrade screen simply opened over a running game.
 *
 * They differ in what keeps running, which is why they cannot share a name:
 *
 *   hold(reason)     the clock stops. Systems run with a step of zero seconds,
 *                    so the screen draws and reads keys while nothing moves.
 *   holdFor(seconds) the clock and the schedule keep running. Whole fixed steps
 *                    are skipped, so a cooldown started before a punch still
 *                    comes due on time.
 *
 *   node agent-runs/2026-08-30-parallel/two-holds.mjs
 */
import { makeLoop } from '../../engine/loop.js'

let failures = 0
const check = (ok, label, detail) => {
  console.log(ok ? 'ok  ' : 'FAIL', label)
  if (!ok) { failures++; if (detail !== undefined) console.log('     ', JSON.stringify(detail)) }
}

const make = () => {
  const seen = []
  const loop = makeLoop({ onFixed: seconds => seen.push(seconds), onFrame: () => {} })
  return { loop, seen }
}

// ---- they are two different verbs, and both are reachable ----
{
  const { loop } = make()
  check(typeof loop.hold === 'function' && typeof loop.holdFor === 'function',
    'both verbs exist')
  check(loop.hold.length !== loop.holdFor.length || loop.hold('probe') === 'probe',
    'hold takes a reason and returns it', loop.hold('probe'))
  loop.release('probe')
}

// ---- a pause stops the clock, and the step still runs ----
{
  const { loop, seen } = make()
  loop.hold('choice-screen')
  check(loop.paused === true, 'paused reports the pause')
  check(loop.holds.includes('choice-screen'), 'and names who is holding', loop.holds)

  loop.step(5)
  check(seen.length === 5, 'a held world still runs its steps', seen.length)
  check(seen.every(seconds => seconds === 0), 'each with a step of zero seconds', seen)
  check(loop.time === 0, 'and the clock has not moved', loop.time)

  loop.release('choice-screen')
  loop.step(3)
  check(loop.paused === false, 'released')
  check(loop.time > 0, 'and time runs again', loop.time)
}

// ---- two holders overlap; the first to release does not start the world ----
{
  const { loop } = make()
  loop.hold('choice-screen')
  loop.hold('run-over')
  loop.release('choice-screen')
  check(loop.paused === true, 'one release of two does not restart the world', loop.holds)
  loop.release('run-over')
  check(loop.paused === false, 'the last release does')
}

// ---- hit stop skips steps but leaves the clock and the schedule alone ----
{
  const { loop, seen } = make()
  let fired = 0
  loop.after(0.05, () => { fired++ })     // three fixed steps in
  loop.holdFor(4 / 60)                    // four steps of hit stop

  loop.step(6)
  check(loop.time > 0, 'the clock runs through hit stop', loop.time)
  check(fired === 1, 'and a timer set before the punch still comes due', fired)
  check(seen.length === 2, 'while four of the six steps did not simulate', seen.length)
  check(loop.paused === false, 'hit stop is not a pause', loop.paused)
}

// ---- the longest hit stop wins, so two hits do not shorten each other ----
{
  const { loop } = make()
  loop.holdFor(6 / 60)
  loop.holdFor(2 / 60)
  check(Math.round(loop.holding * 60) === 6, 'the longer hit stop survives the shorter', loop.holding)
}

console.log(failures ? `\n${failures} FAILED` : '\nall clear')
process.exit(failures ? 1 : 0)
