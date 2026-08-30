/**
 * Proof that each horde family moves its own way, headless and repeatable.
 *
 * Admits one enemy of every family at a known spot, simulates nine seconds in
 * single fixed steps, and reports what each gait did: the rat's zero-speed
 * fraction and burst count, the hound's and boar's state sequences, the
 * flyers' bob spread, and a rounded end-of-run fingerprint. Run it twice —
 * the fingerprint must match exactly or a gait is nondeterministic.
 *
 *   node agent-runs/loop2-motion-gait-proof.mjs
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Engine chatter goes to stderr so stdout stays one JSON value, same as the CLI.
const original = console.log
const toStderr = (...a) => process.stderr.write(a.map(String).join(' ') + '\n')
console.log = toStderr
console.warn = toStderr
console.info = toStderr

const { startWorldInNode } = await import(pathToFileURL(path.join(checkout, 'engine/start-world-node.mjs')))
const { engine, editor } = await startWorldInNode({ root: checkout, project: 'kitten-survivors' })

engine.seed(7)
// One step so start hooks run and the horde exists before anything is admitted.
engine.simulate(1 / 60, { entities: false })

const context = editor.context
const horde = context.horde
if (!horde) throw new Error('Horde did not load')

// The kitten and the tracked five are made unkillable, so every gait is
// witnessed rather than cut short by a claw dart. Same edit both runs.
const kitten = horde.target()
if (kitten) {
  kitten.properties.health = 99999
  kitten.properties.maxHealth = 99999
  // Health keeps the live numbers in the entity's damageable bag, armed from
  // properties before this script edited them — buff the bag too or the kitten
  // still dies, target() answers null, and every gait freezes mid-proof.
  if (kitten.damageable) {
    kitten.damageable.health = 99999
    kitten.damageable.maxHealth = 99999
    kitten.damageable.alive = true
  }
}

const placed = {
  rat: horde.admit('rat', 10, 2),
  hound: horde.admit('hound', 2, 8),
  boar: horde.admit('boar', -12, 12),
  crow: horde.admit('crow', -9, -3),
  wasp: horde.admit('wasp', 4, -9)
}
for (const entity of Object.values(placed)) {
  entity.properties.health = 99999
  entity.properties.maxHealth = 99999
  if (entity.damageable) {
    entity.damageable.health = 99999
    entity.damageable.maxHealth = 99999
    entity.damageable.alive = true
  }
}

const startDistance = {}
for (const [family, entity] of Object.entries(placed)) {
  startDistance[family] = Math.hypot(entity.x - kitten.x, entity.z - kitten.z)
}

const round = n => Math.round(n * 1000) / 1000
const rat = { zeroSamples: 0, samples: 0, bursts: 0, wasRunning: null }
const hound = { states: [], lungePeak: 0, lockedInLunge: true }
const boar = { states: [] }
const bob = { crow: { low: Infinity, high: -Infinity }, wasp: { low: Infinity, high: -Infinity } }

const noteState = (log, state) => { if (log[log.length - 1] !== state) log.push(state) }

const takenOut = {}
const STEPS = 9 * 60
for (let step = 0; step < STEPS; step++) {
  engine.simulate(1 / 60, { entities: false })

  for (const [family, entity] of Object.entries(placed)) {
    if (takenOut[family] === undefined && entity._hordeOut) {
      takenOut[family] = { time: round(context.time), health: entity.properties.health }
    }
  }

  const speed = placed.rat.properties.speed
  rat.samples++
  if (speed === 0) rat.zeroSamples++
  const running = speed > 0
  if (rat.wasRunning === false && running) rat.bursts++
  rat.wasRunning = running

  const houndState = placed.hound._houndState
  if (houndState) noteState(hound.states, houndState)
  if (houndState === 'lunge') {
    if (placed.hound.properties.speed > hound.lungePeak) hound.lungePeak = placed.hound.properties.speed
    if (!placed.hound.headingX && !placed.hound.headingZ) hound.lockedInLunge = false
  }

  if (placed.boar._boarState) noteState(boar.states, placed.boar._boarState)

  for (const family of ['crow', 'wasp']) {
    const y = placed[family].y
    if (y < bob[family].low) bob[family].low = y
    if (y > bob[family].high) bob[family].high = y
  }
}

const endDistance = {}
for (const [family, entity] of Object.entries(placed)) {
  endDistance[family] = round(Math.hypot(entity.x - kitten.x, entity.z - kitten.z))
}

console.log = original
console.log(JSON.stringify({
  seed: 7,
  seconds: STEPS / 60,
  rat: {
    zeroSpeedFraction: round(rat.zeroSamples / rat.samples),
    bursts: rat.bursts,
    closed: round(startDistance.rat - endDistance.rat)
  },
  hound: {
    states: hound.states,
    lungeToLopeRatio: round(hound.lungePeak / placed.hound._houndLopeSpeed),
    headingLockedThroughLunge: hound.lockedInLunge
  },
  boar: { states: boar.states },
  bob: {
    crow: round(bob.crow.high - bob.crow.low),
    wasp: round(bob.wasp.high - bob.wasp.low)
  },
  takenOut,
  endDistance,
  fingerprint: Object.entries(placed).map(([family, entity]) =>
    [family, round(entity.x), round(entity.y), round(entity.z)]),
  enemiesAlive: horde.count
}, null, 2))
process.exit(0)
