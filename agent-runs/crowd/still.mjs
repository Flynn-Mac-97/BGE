/**
 * The see-battery moment: a kitten that never moves, played to 0:30 with every
 * card taken, then asked what is in frame through the saved play camera.
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
for (let slice = 0; slice < 400 && context.runClock.seconds < 30; slice++) {
  while (context.choiceScreen?.isOpen) await context.run('choice.pick', 1)
  context.engine.simulate(0.5)
}
const described = await context.run('see.describe', { view: 'meadow-play' })
const shown = new Set(described.visible.map(entry => entry.id))
console.error('STILL ' + JSON.stringify({
  clock: context.runClock.clock,
  health: Math.round(context.world.byId('you')?.properties.health ?? 0),
  crowdWithBodies: described.visible.filter(entry => FAMILIES.includes(entry.type)).length,
  live: context.horde.enemies.filter(enemy => !enemy._hordeOut && shown.has(enemy.id)).length,
  alive: context.horde.count,
  kills: context.horde.stats.killed
}))
process.exit(0)
