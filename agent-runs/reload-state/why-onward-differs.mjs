import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { captureWorld, restoreWorld } from '../../engine/reload-notice.js'

const project = 'kitten-survivors'
const parts = w => ({ world: w.world, loop: w.loop, editor: w.editor, view: w.view, bus: w.bus, context: w.context, engine: w.engine })

const a = await startWorldInNode({ project })
a.engine.simulate(5)
const capture = captureWorld(parts(a), { kind: 'proof' })
console.log('A timers at capture:', JSON.stringify(a.loop.timers))
console.log('A steps/draws:', a.loop.steps, a.loop.random.draws)

const b = await startWorldInNode({ project })
console.log('B timers at boot  :', JSON.stringify(b.loop.timers))
await restoreWorld(capture, parts(b))
console.log('B timers restored :', JSON.stringify(b.loop.timers))
console.log('B steps/draws:', b.loop.steps, b.loop.random.draws)

// One single step each, then compare — the smallest possible divergence.
const pick = w => w.world.entities.filter(e => e.type === 'rat').slice(0, 3)
  .map(e => `${e.id}@${e.x.toFixed(4)},${e.z.toFixed(4)}`).join(' ')
console.log('\nbefore step  A', pick(a))
console.log('before step  B', pick(b))
a.loop.step(1); b.loop.step(1)
console.log('after 1 step A', pick(a), 'draws', a.loop.random.draws)
console.log('after 1 step B', pick(b), 'draws', b.loop.random.draws)
a.loop.step(30); b.loop.step(30)
console.log('after 31     A', pick(a), 'draws', a.loop.random.draws, 'entities', a.world.entities.length)
console.log('after 31     B', pick(b), 'draws', b.loop.random.draws, 'entities', b.world.entities.length)
