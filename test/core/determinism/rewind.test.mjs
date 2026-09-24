/**
 * The way back through a run: marks, and the walk from one to a step count.
 *
 * What makes this worth a test rather than a probe is the failure it prevents. A
 * rewind that puts the entities back and leaves the clock, the stream or the plugin
 * where they were reads as a rewind and runs as a different game, and the only
 * symptom is a number that stopped matching.
 *
 * The project is built so each share is load-bearing: it reads the clock, draws from
 * the random stream, and moves on a key. The key is the sharpest of the three,
 * because a mark taken at step zero cannot hold a key released at step seventy — the
 * mark was taken before that happened, so the run has to be replayed with the
 * timeline it really had rather than the mark's copy of it.
 *
 * A landing is checked against a SECOND world stepped straight to that count. A hash
 * taken before the rewind only says the world went somewhere it had been; a world
 * that never left says it went where the run would have gone.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from '../../fixture-project.mjs'
import { stepCounterPlugin } from '../../fake-plugin.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'
import { makeRewind } from '../../../engine/rewind.js'
import { stateHash } from '../../../engine/world.js'

const PROJECT = {
  'game.json': { title: 'rewind', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'drifter', at: [0, 0, 0] }] },
  'types/drifter.js': `export default {
  properties: { ticks: 0 },
  update(e, seconds, context) {
    e.properties.ticks = (e.properties.ticks || 0) + 1
    e.x += 0.1 + context.random() * 0.01
    if (context.input.held('right')) e.y += 0.01
  }
}
`
}

/** A project whose entity is held by the scoped plugin the test adds. */
const PLUGIN_PROJECT = {
  'game.json': { title: 'rewind-plugin', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'drone', at: [0, 4, 0] }] },
  'types/drone.js': 'export default { properties: { held: true } }\n'
}

const boot = async project => (await startWorldInNode({ root: CHECKOUT, project })).context

/**
 * A project made for one test, with as many worlds opened on it as the test needs.
 *
 * A second world is how "where the run would have been" is answered, and it is
 * opened on the same project rather than on a copy of it.
 */
async function withProject(files, body) {
  const project = await temporaryProject(files, 'rewind-')
  try {
    const worlds = []
    const open = async () => {
      const context = await boot(project)
      worlds.push(context)
      return context
    }
    return await body(await open(), open)
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
}

test('a step back lands where the run would have been', async () => {
  await withProject(PROJECT, async (context, open) => {
    const { engine, loop } = context

    // Stepped straight to 240 and stopped. It shares nothing with the world that
    // will be rewound to the same count.
    const straight = await open()
    straight.loop.step(240)
    const expected = stateHash(straight.world)

    loop.step(300)
    assert.notEqual(
      stateHash(context.world),
      expected,
      'the two counts are different worlds, so the comparison means something'
    )

    const back = engine.stepBack(60)

    assert.equal(back.reached, true, `the walk landed: ${JSON.stringify(back)}`)
    assert.equal(back.at, 240)
    assert.equal(back.mark, 240, 'a mark was there to be used, so nothing was replayed')
    assert.equal(back.replayed, 0)
    assert.equal(stateHash(context.world), expected, 'the world at 240 is the world that never left 240')
    assert.equal(loop.steps, 240, 'and the clock came back with it')
  })
})

test('a rewind replays the keys the run was played with', async () => {
  await withProject(PROJECT, async context => {
    const { engine, loop, world } = context
    loop.input.press('KeyD')
    loop.step(70)
    loop.input.release('KeyD')

    // The release is the part a mark at step zero cannot hold: it had not happened
    // when the mark was taken.
    loop.step(230)
    const ranOn = stateHash(world)

    const back = engine.seek(30)
    assert.equal(back.reached, true)
    assert.equal(back.mark, 0, 'the only mark at or before step 30 is the one the level opened with')
    assert.equal(back.replayed, 30)

    // The same 270 steps again, with nobody at the keyboard this time.
    loop.step(270)

    assert.equal(loop.steps, 300)
    assert.equal(
      stateHash(world),
      ranOn,
      'a replay with the recorded timeline is the run that happened, not a run nobody touched'
    )
  })
})

test('a rewind that has to replay is exact, and going on from it is the same run', async () => {
  await withProject(PROJECT, async context => {
    const { engine, loop, world } = context
    loop.step(150)
    const atOneFifty = stateHash(world)
    loop.step(100)

    // Ninety-nine is deliberately between two marks: the walk puts the mark at 60
    // back and steps the rest of the way.
    const back = engine.seek(99)

    assert.equal(back.reached, true)
    assert.equal(back.mark, 60)
    assert.equal(back.replayed, 39)

    loop.step(51)

    assert.equal(loop.steps, 150)
    assert.equal(stateHash(world), atOneFifty, 'stepping on from a rewind is the run that was there')
  })
})

test('the ring marks as the run goes, on its stride', async () => {
  await withProject(PROJECT, ({ engine, loop }) => {
    loop.step(300)

    const held = engine.marks()

    // A mark describes the world at the count the clock reads, so the count the run
    // is on is the first one with no mark on it yet.
    assert.deepEqual(
      held.marks.map(one => one.steps),
      [0, 60, 120, 180, 240]
    )
    assert.equal(held.stride, 60)
    assert.equal(held.oldest, 0)
    assert.equal(held.steps, 300)
  })
})

test('a ring holds only as deep as it is told to, and says how far back it reaches', async () => {
  await withProject(PROJECT, ({ loop, world, checkpoints }) => {
    const ring = makeRewind({ world, loop, checkpoints, depth: 3, stride: 10 })
    assert.equal(ring.oldest, null, 'a fresh ring holds nothing')
    for (let count = 0; count < 4; count++) {
      ring.observe()
      loop.step(10)
    }

    assert.deepEqual(
      ring.marks.map(one => one.steps),
      [10, 20, 30],
      'the oldest went when the ring got deeper than three'
    )

    const short = ring.to(0)
    assert.equal(short.reached, false)
    assert.match(short.why, /reaches back to step 10/, 'the refusal names the count rather than guessing')
  })
})

test('a step forward is refused, with the verb that does it', async () => {
  await withProject(PROJECT, ({ engine, loop }) => {
    loop.step(60)

    const ahead = engine.seek(600)

    assert.equal(ahead.reached, false)
    assert.match(ahead.why, /has not happened/)
    assert.match(ahead.why, /simulate/)
    assert.equal(loop.steps, 60, 'and nothing moved')
  })
})

test('a level load drops the marks of the world before it', async () => {
  await withProject(PROJECT, async context => {
    const { engine, editor, loop, world } = context
    loop.step(200)
    assert.ok(engine.marks().marks.length > 1, 'there was something to drop')

    await editor.loadLevel('main')
    const authored = stateHash(world)

    // A mark from the level before would put back entities this world does not have.
    assert.deepEqual(engine.marks().marks, [], 'the marks of the world that ended went with it')

    loop.step(100)
    assert.deepEqual(
      engine.marks().marks.map(one => one.steps),
      [0, 60],
      'and the run that follows is marked from the count the new level starts on'
    )

    const back = engine.seek(0)

    assert.equal(back.reached, true)
    assert.equal(back.mark, 0)
    assert.equal(stateHash(world), authored, 'the mark at zero is the level as authored')
  })
})

test('a mark is a moment of the whole world, an edit included', async () => {
  await withProject(PROJECT, ({ engine, loop, world, spawn }) => {
    loop.step(60)
    // Taken by hand because this is the moment worth returning to exactly: the next
    // automatic mark is a stride away, and the edit happens inside that stride.
    engine.mark()
    const spawned = spawn('drifter', { at: [9, 9, 0] })
    loop.step(60)
    assert.equal(world.byId(spawned.id) != null, true, 'the edit happened')

    engine.seek(60)

    assert.equal(
      world.byId(spawned.id),
      undefined,
      'going back past an edit undoes the edit — a mark is the world, not a list of entities'
    )
  })
})

test('a step back is exact in a world with a scoped plugin in it', async () => {
  await withProject(PLUGIN_PROJECT, async context => {
    context.loader.add(stepCounterPlugin)
    const { engine, loop, world } = context
    assert.ok(context.stepCounter, 'the plugin did not load, so this would prove nothing')

    loop.step(150)
    const atOneFifty = stateHash(world)
    const countAtMark = context.stepCounter.steps
    loop.step(150)
    assert.notEqual(stateHash(world), atOneFifty, 'the plugin moved the world, or the comparison is vacuous')

    const back = engine.stepBack(150)

    assert.equal(back.reached, true, `the walk landed: ${JSON.stringify(back)}`)
    assert.equal(back.refused, undefined, 'the plugin went back with everything else')
    assert.equal(stateHash(world), atOneFifty, 'the world is where it was, not just the entities')
    assert.equal(context.stepCounter.steps, countAtMark, 'and the plugin count came back with it')
  })
})
