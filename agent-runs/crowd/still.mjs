/**
 * The see-battery moment: a kitten that never moves, played to 0:30 with every
 * card taken, then asked what is in frame.
 *
 * Counted through the camera the level's RULE describes, not through the saved
 * `meadow-play` view. That view is a fixed camera and it frames a kitten at the
 * origin 12.75% from the top of the picture, so most of a ring drawn round the
 * kitten is above the frame: it reads 6 where the played camera reads 14.
 *
 * A passive kitten is the harshest fairness test the suite has — it never
 * dodges, so a ring that arrives too close kills it before the mark.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const root = process.cwd()
const { startWorldInNode } = await import(pathToFileURL(join(root, 'engine', 'start-world-node.mjs')))
const { editor } = await startWorldInNode({ root, project: 'kitten-survivors' })
const context = editor.context
await context.camera.ruleRead

const FAMILIES = ['rat', 'crow', 'hound', 'wasp', 'boar']

/** The chase camera the level asks for, behind wherever the kitten is now. */
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

async function read() {
  const described = await context.run('see.describe', { camera: chaseCamera() })
  const shown = new Set(described.visible.map(entry => entry.id))
  const live = context.horde.enemies.filter(enemy => !enemy._hordeOut)
  return {
    clock: context.runClock.clock,
    health: Math.round(context.world.byId('you')?.properties.health ?? 0),
    live: live.length,
    seen: live.filter(enemy => shown.has(enemy.id)).length,
    withBodies: described.visible.filter(entry => FAMILIES.includes(entry.type)).length,
    saved: (await context.run('see.describe', { view: 'meadow-play' }))
      .visible.filter(entry => FAMILIES.includes(entry.type)).length
  }
}

// A swarm lands exactly on 0:30, so some of it is still on the ring at that
// instant. Three seconds later is the crowd the ring actually holds in frame.
const out = []
for (const upTo of [30, 33]) {
  for (let slice = 0; slice < 400 && context.runClock.seconds < upTo; slice++) {
    while (context.choiceScreen?.isOpen) await context.run('choice.pick', 1)
    context.engine.simulate(0.5)
  }
  out.push(await read())
}
console.error('STILL ' + JSON.stringify(out))
process.exit(0)
