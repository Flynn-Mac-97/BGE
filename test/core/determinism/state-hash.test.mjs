/**
 * The state hash: what it must notice, and what must not fool it.
 *
 * A hash that does not move when the world does is useless, and one that moves
 * when the world did not is worse, because it makes every later comparison a
 * false alarm. Both are pinned here.
 *
 * Every field is set by its real name and read back, because a probe that writes
 * the wrong key reports the hash as blind when the probe was wrong — which is how
 * an earlier version of this test claimed the hash ignored `scale`.
 *
 * Two worlds are made in one process throughout. That is not incidental: it is
 * the shape a headless fan-out has, and it is where the cross-talk Run Clock had
 * — one world driving another's clock — was found.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, FIXTURE, FIXTURE_LEVEL, temporaryProject } from '../../fixture-project.mjs'
import { stepCounterPlugin } from '../../fake-plugin.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'
import { stateHash } from '../../../engine/world.js'

const boot = async (project = FIXTURE) => (await startWorldInNode({ root: CHECKOUT, project })).context

test('the same level and steps twice give the same number', async () => {
  const one = await boot()
  const two = await boot()
  one.loop.step(180)
  two.loop.step(180)

  const hash = stateHash(one.world)
  assert.equal(hash, stateHash(two.world), 'two runs of one level and one step count must agree')
  assert.equal(Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff, true, 'a 32-bit number')
})

test('worlds stepped turn and turn about agree with worlds stepped alone', async () => {
  const alone = await boot()
  alone.loop.step(120)

  // Interleaving is the sharp test: a plugin that publishes its per-world state
  // through a module-level binding hands one world's step to another, and a
  // sequential run cannot see it.
  const [first, second] = [await boot(), await boot()]
  for (let done = 0; done < 120; done += 10) {
    first.loop.step(10)
    second.loop.step(10)
  }

  assert.equal(stateHash(first.world), stateHash(alone.world), 'the first of the pair')
  assert.equal(stateHash(second.world), stateHash(alone.world), 'the second of the pair')
})

test('a step count split differently is the same step count', async () => {
  const whole = await boot()
  whole.loop.step(90)
  const split = await boot()
  for (let done = 0; done < 90; done += 15) split.loop.step(15)

  assert.equal(stateHash(split.world), stateHash(whole.world), 'the clock is a step count, not a sum of calls')
})

test('everything an entity carries is in the number', async () => {
  const context = await boot()
  const body = context.world.entities[0]
  const start = stateHash(context.world)

  /** Change a field by its real name, prove it moved the number, then put it back. */
  const probe = (label, set, put) => {
    set()
    assert.notEqual(stateHash(context.world), start, `${label} belongs in the number`)
    put()
    assert.equal(stateHash(context.world), start, `${label} put back must give the number back`)
  }

  probe('a moved position', () => { body.x += 1 }, () => { body.x -= 1 })
  probe('a rotation written as a vector',
    () => { body.rotation = [1, 2, 3] }, () => { body.rotation = 0 })
  probe('a scale written as a vector',
    () => { body.scale = [16, 1, 2] }, () => { body.scale = [16, 1, 1] })
  probe('a velocity physics writes', () => { body.velocityX = 3 }, () => { delete body.velocityX })
  probe('a frame an animation writes', () => { body.frame = 7 }, () => { delete body.frame })
  probe('a game value the entity carries',
    () => { body.properties.probe = 42 }, () => { delete body.properties.probe })
  probe('the shared game state',
    () => { context.world.state.probe = 1 }, () => { delete context.world.state.probe })
})

test('two different vectors do not read alike', async () => {
  const context = await boot()
  const body = context.world.entities[0]
  body.rotation = [1, 2, 3]
  const first = stateHash(context.world)
  body.rotation = [1, 2, 4]

  // A list folded as a number is NaN, and every NaN is the same NaN — so this is
  // the assertion that says a vector is walked rather than converted.
  assert.notEqual(stateHash(context.world), first, 'a different rotation must give a different number')
})

test('a behaviour keeps its running state in its bag, and the bag is in the number', async () => {
  const project = await temporaryProject({
    'game.json': { title: 'bag', startLevel: 'main' },
    'levels/main.json': { entities: [{ type: 'thing', at: [0, 0, 0], behaviours: ['count'] }] },
    'types/thing.js': 'export default { properties: {} }\n',
    'behaviours/count.js': `export default {
  properties: { ticks: 0 },
  update(e, seconds, context, bag) { bag.ticks = (bag.ticks || 0) + 1 }
}
`
  })
  try {
    const context = await boot(project)
    context.loop.step(30)
    const before = stateHash(context.world)
    context.world.entities[0].count.ticks += 1
    assert.notEqual(stateHash(context.world), before, 'the bag is where a behaviour keeps its running state')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('the number comes from the world, not from how it got there', async () => {
  const played = await boot()
  played.loop.step(90)
  await played.editor.loadLevel(FIXTURE_LEVEL)
  const fresh = await boot()

  assert.equal(stateHash(played.world), stateHash(fresh.world),
    'a level loaded again must read the same as a level never played')
})

/**
 * The same claim with a scoped plugin in it, which the fixture cannot make.
 *
 * A plugin holding state outside the world — here a step count and the entities
 * it owns — makes a level reload depend on that state being dropped with the
 * level. The plugin resets on `level:loaded`, so a level played, reloaded and
 * played again is the level played once.
 */
test('a level with a scoped plugin in it is the level never played, reloaded or not', async () => {
  const files = {
    'game.json': { title: 'reload', startLevel: 'main' },
    'levels/main.json': {
      camera: { at: [0, 4] },
      entities: Array.from({ length: 24 }, (unused, at) => ({
        type: 'mover',
        at: [(at % 6) * 0.7 - 2, 1 + Math.floor(at / 6) * 0.9, 0]
      }))
    },
    'types/mover.js': 'export default { properties: { held: true } }\n'
  }
  const project = await temporaryProject(files, 'reload-plugin-')
  try {
    const fresh = await boot(project)
    fresh.loader.add(stepCounterPlugin)
    fresh.loop.step(200)
    const expected = stateHash(fresh.world)
    // Guarded before it is compared: a plugin that never moved anything would
    // agree with another run that never moved anything.
    assert.ok(fresh.stepCounter, 'the plugin did not load, so this would prove nothing')
    const mover = fresh.world.entities[0]
    assert.ok(mover.y < 1, `the plugin moved it, so the plugin was stepping (y=${mover.y})`)

    const played = await boot(project)
    played.loader.add(stepCounterPlugin)
    played.loop.step(200)
    await played.editor.loadLevel('main')
    played.loop.step(200)

    assert.equal(stateHash(played.world), expected,
      'a level played, reloaded and played again is the level played once')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})
