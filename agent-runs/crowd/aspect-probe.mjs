/** The standing case at two viewport shapes: does the ring hold the same share of the crowd in frame? */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const root = process.cwd()
const { startWorldInNode } = await import(pathToFileURL(join(root, 'engine', 'start-world-node.mjs')))
const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']

async function run(width, height) {
  const { editor } = await startWorldInNode({ root, project: 'kitten-survivors' })
  const context = editor.context
  await context.camera.ruleRead
  if (context.viewport) { context.viewport.width = width; context.viewport.height = height }
  const chase = () => {
    const rule = context.camera.rule
    const you = context.world.byId('you')
    const yaw = rule.yaw ?? 0
    return { mode: 'perspective', fov: rule.fov, yaw, pitch: rule.pitch,
      x: you.x + Math.sin(yaw) * Math.cos(rule.pitch) * rule.distance,
      y: you.y + (rule.offsetY ?? 0) - Math.sin(rule.pitch) * rule.distance,
      z: you.z + Math.cos(yaw) * Math.cos(rule.pitch) * rule.distance }
  }
  const read = async () => {
    const described = await context.run('see.describe', { camera: chase() })
    const shown = new Set(described.visible.map(e => e.id))
    const live = context.horde.enemies.filter(e => !e._hordeOut)
    return { live: live.length, seen: live.filter(e => shown.has(e.id)).length,
      withBodies: described.visible.filter(e => FAMILIES.includes(e.type)).length,
      health: Math.round(context.world.byId('you')?.properties.health ?? 0) }
  }
  const playTo = async upTo => {
    for (let slice = 0; slice < 400 && context.runClock.seconds < upTo; slice++) {
      while (context.choiceScreen?.isOpen) await context.run('choice.pick', 1)
      context.engine.simulate(0.5)
    }
  }
  await playTo(30)
  const at30 = await read()
  await playTo(33)
  const at33 = await read()
  return { viewport: [width, height], frame: context.horde.stats.frame, ring: context.horde.stats.ring, at30, at33 }
}

const wide = process.argv[2] === 'wide'
console.error('ASPECT ' + JSON.stringify(wide ? await run(1920, 855) : await run(1280, 720)))
process.exit(0)
