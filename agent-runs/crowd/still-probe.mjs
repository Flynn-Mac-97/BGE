import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const root = process.cwd()
const { startWorldInNode } = await import(pathToFileURL(join(root, 'engine', 'start-world-node.mjs')))
const { editor } = await startWorldInNode({ root, project: 'kitten-survivors' })
const context = editor.context
await context.camera.ruleRead
const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']

function chaseCamera() {
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

const seenBy = async options => {
  const described = await context.run('see.describe', options)
  const shown = new Set(described.visible.map(e => e.id))
  const live = context.horde.enemies.filter(e => !e._hordeOut)
  return {
    seen: live.filter(e => shown.has(e.id)).length,
    withBodies: described.visible.filter(e => FAMILIES.includes(e.type)).length,
    youAt: described.visible.find(e => e.id === 'you')?.at
  }
}

const out = []
for (const upTo of [24, 27, 30, 33, 36]) {
  for (let slice = 0; slice < 400 && context.runClock.seconds < upTo; slice++) {
    while (context.choiceScreen?.isOpen) await context.run('choice.pick', 1)
    context.engine.simulate(0.25)
  }
  const you = context.world.byId('you')
  if (!you) { out.push({ at: upTo, dead: true }); break }
  const live = context.horde.enemies.filter(e => !e._hordeOut).length
  out.push({
    at: upTo, health: Math.round(you.properties.health), live,
    saved: await seenBy({ view: 'meadow-play' }),
    chase: await seenBy({ camera: chaseCamera() })
  })
}
console.error('BOTH ' + JSON.stringify(out))
process.exit(0)
