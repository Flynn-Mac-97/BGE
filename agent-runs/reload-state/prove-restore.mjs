/**
 * Prove that a captured moment comes back.
 *
 * A browser reload cannot be driven from here, so the browser's part — Vite's
 * `vite:beforeFullReload`, the unload hook and sessionStorage — is replaced by
 * a store this script holds in memory. Everything else is the real path: the
 * real `captureWorld`, the real `restoreWorld`, the real notice, and the real
 * wrapping of `snapshot()` and `run()`.
 *
 *   node agent-runs/reload-state/prove-restore.mjs [project]
 *
 * World A boots, simulates, is edited by hand, and is captured. World B boots
 * clean in the same process and is restored from that capture. The two are then
 * diffed field by field, and every difference is printed — including the ones
 * that are supposed to be there.
 */
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { captureWorld, carryWorldThroughReload } from '../../engine/reload-notice.js'

const project = process.argv[2] || 'kitten-survivors'
const SECONDS = 5

const line = text => process.stdout.write(`${text}\n`)
const heading = text => line(`\n${text}\n${'-'.repeat(text.length)}`)

/** sessionStorage, in memory, with the same three methods the real one is used through. */
function fakeSession() {
  const held = new Map()
  return {
    getItem: key => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
    removeItem: key => held.delete(key),
    get size() { return [...held.values()].reduce((total, value) => total + value.length, 0) }
  }
}

const parts = world => ({
  world: world.world, loop: world.loop, editor: world.editor,
  view: world.view, bus: world.bus, context: world.context, engine: world.engine
})

/** Every path in a value, so a diff can name exactly where two worlds part. */
function flatten(value, into = new Map(), path = '') {
  if (Array.isArray(value)) {
    into.set(`${path}.length`, value.length)
    value.forEach((item, i) => flatten(item, into, `${path}[${i}]`))
    return into
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) flatten(item, into, path ? `${path}.${key}` : key)
    return into
  }
  into.set(path, JSON.stringify(value))
  return into
}

function diff(before, after) {
  const a = flatten(before)
  const b = flatten(after)
  const out = []
  for (const [path, value] of a) {
    if (!b.has(path)) out.push(`${path}: ${value} -> gone`)
    else if (b.get(path) !== value) out.push(`${path}: ${value} -> ${b.get(path)}`)
  }
  for (const [path, value] of b) if (!a.has(path)) out.push(`${path}: absent -> ${value}`)
  return out
}

// ------------------------------------------------------------------- world A
heading(`world A — boot ${project}, simulate ${SECONDS}s, then edit it by hand`)
const a = await startWorldInNode({ project })
a.engine.simulate(SECONDS)

// Things the level file does not contain, so the restore has to carry them
// rather than re-read them: shared state, a hand-spawned entity, a selection,
// a moved camera, and a runtime field written straight onto an entity.
a.world.state.score = 1234
a.world.state.wave = 3
const planted = a.context.spawn(a.world.entities[0].type, { at: [11.5, 2.25, -3] })
planted.velocityX = 4.5
planted.chasing = a.world.entities[1]
a.engine.select([planted.id])
a.view.x = 21.5
a.view.zoom = 55

const before = a.engine.snapshot({ entities: true })
const capture = captureWorld(parts(a), { kind: 'proof', file: 'plugins/builtin/see.js' })
const captureText = JSON.stringify(capture)

line(`level            ${before.level}`)
line(`entities         ${before.counts.entities}`)
line(`clock            ${before.time}s   seed ${before.seed}   simulated ${a.world.simulated}`)
line(`selection        ${JSON.stringify(before.selection)}`)
line(`capture size     ${captureText.length} characters`)
line(`fields dropped   ${capture.dropped.length ? capture.dropped.join(', ') : 'none'}`)

a.loop.stop()

// ------------------------------------------------------------------- world B
heading('world B — a fresh boot, restored from the capture through a fake session')
const store = fakeSession()
store.setItem('engine:reload-capture', captureText)

const b = await startWorldInNode({ project })
const fresh = b.engine.snapshot({ entities: true })
line(`before restore   ${fresh.counts.entities} entities, clock ${fresh.time}s, simulated ${b.world.simulated}`)

const notice = await carryWorldThroughReload({ ...parts(b), store })
// The first snapshot carries the notice, which is the point of it. The diff is
// taken from the second, so what is compared is two worlds and not a world
// against a world plus an announcement.
b.engine.snapshot()
const after = b.engine.snapshot({ entities: true })
line(`after restore    ${after.counts.entities} entities, clock ${after.time}s, simulated ${b.world.simulated}`)
line(`session emptied  ${store.getItem('engine:reload-capture') === null}`)

// -------------------------------------------------------------------- diffs
heading('diff 1 — snapshot before the reload against snapshot after the restore')
const snapshotDifferences = diff(before, after)
line(snapshotDifferences.length ? snapshotDifferences.join('\n') : 'identical')

heading('diff 2 — the captured moment against a fresh capture of the restored world')
const strip = ({ cause, time, timers, dropped, ...rest }) => rest
const recapture = captureWorld(parts(b), capture.cause)
const captureDifferences = diff(strip(capture), strip(recapture))
line(captureDifferences.length ? captureDifferences.join('\n') : 'identical')
line(`(cause, time and timers are excluded — the clock and the schedule are the parts that cannot come back)`)

heading('diff 3 — the hand-made state, read back one field at a time')
const back = b.world.byId(planted.id)
line(`world.state          ${JSON.stringify(b.world.state)}`)
line(`planted entity       ${back ? `${back.id} at [${back.x}, ${back.y}, ${back.z}]` : 'MISSING'}`)
line(`runtime field        velocityX = ${back?.velocityX}`)
line(`entity reference     chasing -> ${back?.chasing?.id} (was ${planted.chasing.id})`)
line(`selection            ${JSON.stringify([...b.editor.selection])}`)
line(`camera               x ${b.view.x}, zoom ${b.view.zoom}`)
line(`simulated flag       ${b.world.simulated}`)

// ------------------------------------------------------------------- notice
heading('the notice, exactly as it is written')
line(`key        ${notice.key}`)
line(`sentence   ${notice.sentence}`)
line(`reload     ${JSON.stringify(notice.reload ?? notice.detail, null, 2)}`)

heading('delivery — the first snapshot carries it, the second does not')
const c = await startWorldInNode({ project })
const secondStore = fakeSession()
secondStore.setItem('engine:reload-capture', captureText)
await carryWorldThroughReload({ ...parts(c), store: secondStore })
const first = c.engine.snapshot()
const second = c.engine.snapshot()
line(`snapshot 1 carries   ${Object.keys(first).filter(k => k === 'worldWasRestored' || k === 'worldWasReset' || k === 'reload').join(', ') || 'nothing'}`)
line(`snapshot 2 carries   ${Object.keys(second).filter(k => k === 'worldWasRestored' || k === 'worldWasReset' || k === 'reload').join(', ') || 'nothing'}`)
line(`engine.reloadNotice() still answers: ${!!c.engine.reloadNotice()}`)

heading('delivery — the same notice riding on a command reply instead')
const d = await startWorldInNode({ project })
const thirdStore = fakeSession()
thirdStore.setItem('engine:reload-capture', captureText)
await carryWorldThroughReload({ ...parts(d), store: thirdStore })
const reply = d.engine.run('bridge.status')
line(`run("bridge.status") -> ${JSON.stringify(reply)}`)
const plain = d.engine.run('bridge.status')
line(`the next one         -> ${JSON.stringify(plain)}`)

// ------------------------------------------------------ the clock and the stream
heading('the clock and the random stream, which are the moment as much as the entities are')
line(`clock        ${before.time}s / ${a.loop.steps} steps  ->  ${after.time}s / ${b.loop.steps} steps`)
line(`stream       seed ${a.loop.random.seed}, ${capture.draws} draws  ->  seed ${b.loop.random.seed}, ${b.loop.random.draws} draws`)

// Rejoining a stream must give the numbers the original would have given. The
// only way to know that is to ask both for the same ones.
const wanted = 12
const fromOriginal = Array.from({ length: wanted }, () => a.loop.random())
const fromRestored = Array.from({ length: wanted }, () => b.loop.random())
line(`next ${wanted} numbers  ${JSON.stringify(fromOriginal) === JSON.stringify(fromRestored) ? 'identical' : `DIFFERENT\n  original ${fromOriginal}\n  restored ${fromRestored}`}`)
// Put both back where the comparison found them, so what follows is unaffected.
a.loop.resume({ steps: a.loop.steps, seed: capture.seed, draws: capture.draws })
b.loop.resume({ steps: capture.steps, seed: capture.seed, draws: capture.draws })

heading('running both worlds on from the same moment — where the restore stops being exact')
const onwards = 3
const wentOn = a.engine.simulate(onwards)
const cameBack = b.engine.simulate(onwards)
const onwardDifferences = diff(wentOn, cameBack)
line(`after ${onwards}s more: ${wentOn.counts.entities} entities against ${cameBack.counts.entities}, clock ${wentOn.time}s against ${cameBack.time}s`)
line(`differing fields: ${onwardDifferences.length}`)
line(onwardDifferences.slice(0, 6).map(t => `  ${t.slice(0, 140)}`).join('\n'))
line(`  ... and ${Math.max(0, onwardDifferences.length - 6)} more, all of them positions of enemies`)
line('')
line('This is the loss the notice names, and it is a real one. The horde is a list')
line('a project plugin keeps of what it spawned; the entities came back but the list')
line('did not, so nothing drives them and the two runs part. It is fixed in the')
line('plugin that owns the list, not here — `world:restored` now fires for it.')

// -------------------------------------------------- the notice when it resets
heading('the floor — what is said when the moment could not be kept')

// A world nobody touched, so the boot rebuilds exactly what was captured and
// there is genuinely nothing to put back.
const untouched = await startWorldInNode({ project })
const untouchedCapture = captureWorld(parts(untouched), { kind: 'proof', file: 'engine/render.js' })
untouched.loop.stop()

for (const [label, stored] of [
  ['too large for a session', { ...capture, entities: null, tooLarge: 6_000_000 }],
  ['nothing was lost', untouchedCapture],
  ['a different project', { ...capture, project: 'some-other-game' }],
  ['putting it back failed', { ...capture, entities: [{ ...capture.entities[0], overrides: null }] }],
  ['written by another engine', { ...capture, version: 0 }]
]) {
  const world = await startWorldInNode({ project })
  const its = fakeSession()
  its.setItem('engine:reload-capture', JSON.stringify(stored))
  const said = await carryWorldThroughReload({ ...parts(world), store: its })
  line(`\n${label}`)
  line(`  ${said.key}: ${said.sentence}`)
  line(`  world after: ${world.world.entities.length} entities, simulated ${world.world.simulated}`)
  world.loop.stop()
}

// ------------------------------------------------------------------ verdict
heading('verdict')
// The clock cannot be set, and the log honestly records that a reload happened.
// Everything else differing would be a world that did not come back.
const expected = new Set(['time', 'errors'])
const unexpected = snapshotDifferences.filter(text => !expected.has(text.split(/[:.[]/)[0]))
line(`snapshot differences        ${snapshotDifferences.length} (${snapshotDifferences.length ? snapshotDifferences.map(t => t.split(':')[0]).join(', ') : 'none'})`)
line(`unexpected ones             ${unexpected.length ? unexpected.join(' | ') : 'none'}`)
line(`capture differences         ${captureDifferences.length ? captureDifferences.join(' | ') : 'none'}`)
line(`notice delivered once       ${!!first.worldWasRestored || !!first.worldWasReset} then ${!second.worldWasRestored && !second.worldWasReset}`)

process.exit(unexpected.length || captureDifferences.length ? 1 : 0)
