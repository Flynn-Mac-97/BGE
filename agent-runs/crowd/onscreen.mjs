/**
 * How much of the horde the player can see, at 0:30, 1:00 and 1:30.
 *
 * The saved `meadow-play` view is a FIXED camera at the origin, so a kitten that
 * kites away leaves it looking at empty grass. The camera is built here from the
 * level's own rule, placed behind the kitten exactly as the chase camera places
 * it, so the count is of the played frame.
 *
 * Each mark is the mean of fifteen samples two seconds apart, so the window is
 * one whole swarm cycle centred on the mark. One instant lands anywhere between
 * a swarm and the moment after it was killed, and the swing between two instants
 * is larger than the effect being measured.
 *
 *   node agent-runs/crowd/onscreen.mjs [label]
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { startWorldInNode } = await import(pathToFileURL(join(root, 'engine', 'start-world-node.mjs')))
const { editor } = await startWorldInNode({ root, project: 'kitten-survivors' })
const context = editor.context
await context.camera.ruleRead

const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']
const MARKS = [30, 60, 90]
const SAMPLES = 15
const APART = 2

/** The chase camera the level asks for, behind wherever the kitten is now. */
function playCamera() {
  const rule = context.camera.rule
  const you = context.world.byId('you')
  const yaw = rule.yaw ?? 0
  return {
    mode: 'perspective', fov: rule.fov, yaw, pitch: rule.pitch,
    x: you.x + Math.sin(yaw) * Math.cos(rule.pitch) * rule.distance,
    y: you.y + (rule.offsetY ?? 0) - Math.sin(rule.pitch) * rule.distance,
    z: you.z + Math.cos(yaw) * Math.cos(rule.pitch) * rule.distance
  }
}

/**
 * One reading. `brief` is never passed: it lists only the MARKED entities, and
 * marks are a fixed budget dealt out by type, so a brief count of a crowd tops
 * out at the budget rather than at what is in frame.
 */
async function sample() {
  const described = await context.run('see.describe', { camera: playCamera() })
  const shown = new Set(described.visible.map(entry => entry.id))
  // A body lingers after it dies and is still an entity of its family's type,
  // so the live crowd is counted apart from the frame's family entries.
  const live = context.horde.enemies.filter(enemy => !enemy._hordeOut && shown.has(enemy.id))
  return {
    onScreen: live.length,
    withBodies: described.visible.filter(entry => FAMILIES.includes(entry.type)).length,
    alive: context.horde.count
  }
}

const mean = numbers => Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 10) / 10
const rows = []
let played = 0
let over = null
/** The run ending is the arc's answer, not the kitten's body: the body lingers. */
const play = async seconds => {
  if (over) return
  const reply = await context.run('kitten.arc', { seconds, every: 999 })
  if (reply.ended || reply.heldBy) over = reply.ended || { reason: `held by ${reply.heldBy}` }
}
for (const second of MARKS) {
  await play(second - played - (SAMPLES - 1) * APART / 2)
  if (over) { rows.push({ at: second, over }); break }
  const taken = []
  for (let index = 0; index < SAMPLES; index++) {
    if (over) break
    taken.push(await sample())
    if (index < SAMPLES - 1) await play(APART)
  }
  played = second + (SAMPLES - 1) * APART / 2
  if (!taken.length) { rows.push({ at: second, over }); break }
  const stats = context.horde.stats
  rows.push({
    at: second,
    onScreen: mean(taken.map(one => one.onScreen)),
    lowest: Math.min(...taken.map(one => one.onScreen)),
    highest: Math.max(...taken.map(one => one.onScreen)),
    withBodies: mean(taken.map(one => one.withBodies)),
    alive: mean(taken.map(one => one.alive)),
    cap: stats.aliveCap,
    kills: stats.killed,
    sentBack: stats.sentBack ?? 0,
    ring: stats.ring
  })
}

console.error('MEASURED ' + JSON.stringify({ label: process.argv[2] || 'run', rows }))
process.exit(0)
