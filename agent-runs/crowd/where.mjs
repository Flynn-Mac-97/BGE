/**
 * Where the enemies that are NOT in frame are, in camera space.
 *
 * `see.describe` decides what is visible — it owns the projection — and the
 * misses are then bucketed by which edge they are past. `ahead` is metres
 * toward the top of the screen, `across` metres to the right.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { startWorldInNode } = await import(pathToFileURL(join(root, 'engine', 'start-world-node.mjs')))
const { editor } = await startWorldInNode({ root, project: 'kitten-survivors' })
const context = editor.context
await context.camera.ruleRead

const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']
const MARKS = [30, 60]

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

const rows = []
let played = 0
for (const second of MARKS) {
  await context.run('kitten.arc', { seconds: second - played, every: 999 })
  played = second
  const described = await context.run('see.describe', { camera: playCamera() })
  const onScreen = new Set(described.visible.map(entry => entry.id))
  const you = context.world.byId('you')
  const frame = context.horde.stats.frame
  const missed = { offTop: 0, offBottom: 0, offSide: 0 }
  let seen = 0
  const away = []
  for (const enemy of context.horde.enemies) {
    if (enemy._hordeOut) continue
    if (onScreen.has(enemy.id)) { seen++; continue }
    const ahead = -(enemy.z - you.z)
    const across = enemy.x - you.x
    away.push(Math.round(Math.hypot(ahead, across) * 10) / 10)
    if (ahead > frame.ahead) missed.offTop++
    else if (ahead < -frame.behind) missed.offBottom++
    else missed.offSide++
  }
  away.sort((a, b) => a - b)
  rows.push({
    at: second, alive: context.horde.count, onScreen: seen, ...missed,
    missedDistance: [away[0], away[Math.floor(away.length / 2)], away[away.length - 1]],
    sentBack: context.horde.stats.sentBack
  })
}
console.error(JSON.stringify(rows))
process.exit(0)
