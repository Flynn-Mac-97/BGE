/**
 * How much of the kitten one effect covers, measured rather than judged.
 *
 * The clock is held, so a burst is drawn and never ages: two captures of the
 * same moment — one with the burst, one without — differ only where the effect
 * put pixels down. Counting the changed pixels inside the kitten's own screen
 * hull answers "how much of the character does this effect erase" exactly.
 *
 * `see.occlusion` cannot answer it: particles are not entities, so the ID
 * buffer never names one as a blocker.
 *
 * The tab has to be the ACTIVE one in its window. Chrome freezes a background
 * tab, and a frozen tab keeps answering captures with the last frame it drew.
 *
 * Run it against a live play frame; it holds the clock itself:
 *   node agent-runs/2026-08-31-brawl-stars/feel2/flash-cover.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readImage } from '../../../plugins/builtin/art-direction/image.js'

const PORT = process.argv[2] || '5196'
const OUT = 'agent-runs/see/cover'

const engine = (id, payload) => {
  const args = ['bin/engine.mjs', '--port', PORT, 'run', id]
  if (payload !== undefined) args.push(JSON.stringify(payload))
  return JSON.parse(execFileSync('node', args, { encoding: 'utf8' }).trim() || 'null')
}

/**
 * One fixed step, which under a hold moves nothing and still runs the frame
 * phase.
 *
 * A hidden tab gets no animation frame, so nothing syncs the particle field
 * into the scene and `see.capture` answers with the last frame that did.
 */
const drawOneFrame = (seconds = '0.017') =>
  execFileSync('node', ['bin/engine.mjs', '--port', PORT, 'simulate', seconds], { encoding: 'utf8' })

const capture = name => {
  drawOneFrame()
  engine('see.capture', { marks: false, ui: false, brief: true, file: `${OUT}-${name}.png` })
  return readImage(`${OUT}-${name}.png`)
}

/** The kitten's drawn silhouette, as pixels, from a marked capture's sidecar. */
function kittenMask(width, height) {
  drawOneFrame()
  engine('see.capture', { brief: true, ui: false, file: `${OUT}-hull.png` })
  const sidecar = JSON.parse(readFileSync(`${OUT}-hull.json`, 'utf8'))
  const you = sidecar.visible.find(entry => entry.id === 'you')
  if (!you?.hull) throw new Error('the kitten is not marked in this frame')
  const hull = you.hull.map(([x, y]) => [x / 100 * width, y / 100 * height])
  const mask = new Uint8Array(width * height)
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(hull, x + 0.5, y + 0.5)) continue
      mask[y * width + x] = 1
      count++
    }
  }
  return { mask, count, hull }
}

function inside(polygon, x, y) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/**
 * Share of the kitten's pixels the effect repaints, and how much light it adds
 * across the whole silhouette.
 *
 * Both, because an additive effect over an already-pale model can wash the
 * shape out while moving few pixels past any single threshold.
 */
function changed(clean, lit, mask, count) {
  let touched = 0
  let lift = 0
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue
    const at = index * 4
    const difference = Math.max(
      Math.abs(lit.data[at] - clean.data[at]),
      Math.abs(lit.data[at + 1] - clean.data[at + 1]),
      Math.abs(lit.data[at + 2] - clean.data[at + 2])
    )
    if (difference > 12) touched++
    lift += difference
  }
  return { covered: touched / count, meanLift: Math.round(lift / count * 10) / 10 }
}

/** Eight compass aims, because a muzzle flash goes wherever the target is. */
const AIMS = Array.from({ length: 8 }, (_, index) => {
  const angle = index * Math.PI / 4
  return [Math.sin(angle), 0, Math.cos(angle)]
})

/**
 * Prove the tab is drawing before believing any measurement.
 *
 * A background tab gets no animation frame, so nothing re-syncs and
 * `see.capture` answers with the last frame it drew. Every difference then
 * measures zero, which reads as a perfect result.
 */
/**
 * Prove nothing but the effect moves between two captures.
 *
 * The frame phase runs on every forced frame, and the camera eases toward the
 * kitten there, so a camera still catching up moves the whole picture between
 * captures and every difference reads as coverage.
 */
async function refuseAMovingPicture(clean, mask, count) {
  const again = await capture('clean-again')
  const drift = changed(clean, again, mask, count).covered
  if (drift > 0.02) {
    throw new Error(`the picture is not still — ${Math.round(drift * 100)}% of the kitten changed `
      + 'between two captures of the same moment. Let the camera settle and run this again.')
  }
}

async function refuseAFrozenTab(clean, mask, count, at) {
  engine('particles.clear')
  engine('particles.effect', ['smoke', { at }])
  const smoked = await capture('alive')
  engine('particles.clear')
  if (changed(clean, smoked, mask, count).covered < 0.5) {
    throw new Error('the tab is not drawing — 900 smoke particles on the kitten changed nothing. '
      + 'Make it the active tab in its window and run this again.')
  }
}

/**
 * True while the world still moves between two reads.
 *
 * The snapshot clock, not `run.state` — that one is rounded to whole seconds
 * and reads the same twice in a row on a running world.
 */
const snapshotTime = () =>
  JSON.parse(execFileSync('node', ['bin/engine.mjs', '--port', PORT, 'snapshot'], { encoding: 'utf8' })).time
const clockMoving = () => snapshotTime() !== snapshotTime()

// A moving world would put the difference between two captures down to the
// fight rather than to the effect. `kitten.pause` toggles and takes no
// argument, so press it only while the clock is still moving.
for (let tries = 0; tries < 4 && clockMoving(); tries++) engine('kitten.pause')
if (clockMoving()) throw new Error('the clock will not hold')

const you = engine('see.isolate', { subject: 'you' })
const origin = [you.world.x, you.world.y + 0.1, you.world.z]

engine('particles.clear')
// The camera closes a sixth of the gap to the kitten on every frame, so it has
// to arrive before anything is compared. One frame per call: `simulate` runs
// however many fixed steps it was asked for and then exactly one frame.
for (let settle = 0; settle < 25; settle++) drawOneFrame()

const clean = await capture('clean')
const { mask, count } = kittenMask(clean.width, clean.height)
await refuseAMovingPicture(clean, mask, count)
await refuseAFrozenTab(clean, mask, count, [origin[0], origin[1] + 0.3, origin[2]])

/**
 * Both recipes in one held moment, so the two numbers are comparable.
 *
 * `engine` restates the builtin's own table as overrides; `game` passes none,
 * so it fires whatever Kitten Effects defined.
 */
const RECIPES = {
  engine: { count: 1, speed: 0, life: 0.05, size: 0.4, blend: 'add', colour: '#ffd9a0', spread: 0, drag: 0, gravity: 0 },
  game: {}
}

const scored = {}
for (const [name, overrides] of Object.entries(RECIPES)) {
  const results = []
  for (const [index, aim] of AIMS.entries()) {
    engine('particles.clear')
    // Where Combat Effects puts it: 0.3 m along the fire direction from the
    // shooter's own position.
    const at = [origin[0] + aim[0] * 0.3, origin[1], origin[2] + aim[2] * 0.3]
    engine('particles.effect', ['muzzle-flash', { at, direction: aim, ...overrides }])
    results.push(changed(clean, await capture(`${name}-${index}`), mask, count))
  }
  const covers = results.map(result => result.covered)
  const lifts = results.map(result => result.meanLift)
  scored[name] = {
    worstCoverPercent: Math.round(Math.max(...covers) * 1000) / 10,
    meanCoverPercent: Math.round(covers.reduce((sum, n) => sum + n, 0) / covers.length * 1000) / 10,
    worstLift: Math.max(...lifts),
    perAimCover: covers.map(cover => Math.round(cover * 1000) / 10)
  }
}
engine('particles.clear')

console.log(JSON.stringify({ silhouettePixels: count, frame: [clean.width, clean.height], ...scored }, null, 2))
