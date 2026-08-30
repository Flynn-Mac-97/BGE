/**
 * Mark priority measurement: run a fresh headless simulation at a given seed,
 * ask describe for a brief reply from the meadow's play camera, and count what
 * the first twelve marks were spent on. Scenery is everything that is not a
 * creature — the ground and the props.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')

const CREATURES = new Set(['rat', 'boar', 'crow', 'hound', 'wasp', 'kitten'])
/** Scenery is the level's static dressing — the hills, banks and patches the matrix names. */
const SCENERY = new Set(['meadow-prop', 'ground'])
const PLAY_CAMERA = { x: 0, y: 12.1, z: 13.4, pitch: -1.05, yaw: 0, fov: 50, mode: 'perspective' }

const seeds = process.argv.slice(2).map(Number)
const label = process.env.LABEL || 'run'

await mkdir(here, { recursive: true })
const rows = []
for (const seed of seeds.length ? seeds : [7, 21]) {
  // `entities: false` keeps simulate's snapshot compact: the default dumps all
  // 842 entities and this script only wants the describe reply at the end.
  //
  // Two views, because a mark rule must hold from more than one camera. `aim`
  // moves the LIVE camera, so it runs last and the fixed-camera reads happen
  // before it; it reproduces the view the contract's repro was shot from.
  const script = JSON.stringify([
    ['seed', seed],
    ['simulate', 8, { entities: false }],
    ['run', 'choice.pick', 1],
    ['simulate', 22, { entities: false }],
    ['run', 'see.describe', { brief: true, camera: PLAY_CAMERA }],
    ['run', 'see.describe', { camera: PLAY_CAMERA }],
    ['run', 'see.view', { aim: 'you', back: 3 }],
    ['run', 'see.describe', { brief: true }]
  ])
  const { stdout } = await run(process.execPath,
    [join(root, 'bin/engine.mjs'), '--headless', '--project', 'kitten-survivors', 'script', script],
    { cwd: root, maxBuffer: 1 << 28 })
  const replies = JSON.parse(stdout)
  const [briefPlay, full, , briefAimed] = replies.slice(4)
  rows.push({ seed, view: 'play camera', ...read(briefPlay, full) })
  rows.push({ seed, view: 'see.view aim you back 3', ...read(briefAimed) })
  await writeFile(join(here, `${label}-seed${seed}.json`), JSON.stringify(briefPlay, null, 1))
  await writeFile(join(here, `${label}-aimed-seed${seed}.json`), JSON.stringify(briefAimed, null, 1))
}
console.log(JSON.stringify(rows, null, 1))

function read(brief, full) {
  const marked = (brief.visible || []).filter(entry => entry.mark).sort((a, b) => a.mark - b.mark)
  const firstTwelve = marked.slice(0, 12)
  return {
    visible: brief.counts?.visible,
    creaturesVisible: countCreatures(brief),
    ...(full ? { byTypeVisible: countByType(full) } : {}),
    marks: marked.length,
    marksByType: countByType({ visible: marked }),
    firstTwelve: firstTwelve.map(entry => `${entry.mark}:${entry.type}`),
    sceneryInFirstTwelve: firstTwelve.filter(entry => SCENERY.has(entry.type)).length,
    nonCreatureInFirstTwelve: firstTwelve.filter(entry => !CREATURES.has(entry.type)).length,
    briefBytes: Buffer.byteLength(JSON.stringify(brief))
  }
}

function countCreatures(described) {
  // regions counts EVERY visible entity by type, marked or not, so a brief
  // reply still says how many creatures the camera can see.
  let total = 0
  for (const cell of Object.values(described.regions || {})) {
    for (const [type, count] of Object.entries(cell)) if (CREATURES.has(type)) total += count
  }
  return total
}

function countByType(described) {
  const counts = {}
  for (const entry of described.visible || []) counts[entry.type] = (counts[entry.type] || 0) + 1
  return counts
}
