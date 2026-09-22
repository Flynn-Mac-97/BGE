/**
 * A checkpoint of a whole run: taken, carried on from, and put back.
 *
 * `world.capture()` puts the entities back and nothing else. A moment is more than
 * the entities: it is the clock, the random stream, the keys that were down, and
 * whatever a plugin holds outside the world. Miss any one of them and the restore
 * looks right and runs wrong — so every test here steps PAST the moment and then
 * steps the same distance again, and asks whether it landed where the run landed.
 *
 * The project's type draws from the random stream, reads the clock and reads the
 * keyboard, so each of the three has to come back for the second run to be the
 * first run. A step that touched none of them would pass without the loop's share
 * being carried at all.
 *
 * The scoped plugin at the end is the case the whole feature exists for: it holds a
 * step count and the entities it owns, outside the world, and every test there asks
 * whether the moment carried that state and gave it back. The plugin is added to the
 * loader by the test itself, so no plugin file has to exist for it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from '../fixture-project.mjs'
import { stepCounterPlugin } from '../fake-plugin.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'
import { stateHash } from '../../engine/world.js'

/** A game whose every step depends on the clock, the stream and the keyboard. */
const PROJECT = {
  'game.json': { title: 'checkpoint', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'drifter', at: [0, 0, 0] }] },
  'types/drifter.js': `export default {
  properties: { ticks: 0, at: 0 },
  update(e, seconds, context) {
    e.properties.ticks = (e.properties.ticks || 0) + 1
    e.properties.at = context.time
    e.x += 0.1 + context.random() * 0.01
    if (context.loop.input.isDown('KeyD')) e.y += 0.01
  }
}
`
}

/** A project whose type is held by the scoped plugin added in the test. */
const PLUGIN_PROJECT = {
  'game.json': { title: 'checkpoint-plugin', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'drone', at: [0, 3, 0] }, { type: 'drone', at: [1, 3, 0] }] },
  'types/drone.js': 'export default { properties: { held: true } }\n'
}

/** The boot every test in this file uses, so one change reaches all of them. */
const boot = async project => (await startWorldInNode({ root: CHECKOUT, project })).context

/** A project made and removed by the test that uses it. */
async function withFiles(files, body) {
  const project = await temporaryProject(files)
  try {
    return await body(await boot(project))
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
}

/** The one-entity project above, which most tests in this file use. */
const withProject = body => withFiles(PROJECT, body)

test('the clock, the stream and the keys come back with the entities', async () => {
  await withProject(context => {
    const { loop, world } = context
    context.loop.input.press('KeyD')

    loop.step(45)
    const mark = context.capture()
    const atMark = {
      hash: stateHash(world),
      steps: loop.steps,
      draws: loop.random.draws,
      seed: loop.random.seed
    }
    assert.deepEqual(mark.lost, [], 'nothing about this run is beyond a checkpoint')

    loop.step(30)
    const carriedOn = { hash: stateHash(world), steps: loop.steps, draws: loop.random.draws }
    assert.notEqual(carriedOn.hash, atMark.hash, 'the thirty steps really did move the world')

    context.restore(mark)

    assert.equal(loop.steps, atMark.steps, 'the clock went back with the entities')
    assert.equal(loop.random.draws, atMark.draws, 'and so did the stream')
    assert.equal(loop.random.seed, atMark.seed)
    assert.equal(context.loop.input.isDown('KeyD'), true, 'and the key that was down is down again')

    loop.step(30)

    assert.equal(stateHash(world), carriedOn.hash, 'the second thirty steps are the first thirty steps')
    assert.equal(loop.steps, carriedOn.steps)
    assert.equal(loop.random.draws, carriedOn.draws)
  })
})

test('a world that was held is held again', async () => {
  await withProject(context => {
    context.loop.step(10)
    context.loop.hold('choosing an upgrade')
    context.loop.holdFor(0.5)

    const mark = context.capture()
    assert.deepEqual(mark.loop.holds, ['choosing an upgrade'])
    assert.equal(mark.loop.hitStop, 30, 'half a second, in the fixed steps it is counted in')

    context.loop.release('choosing an upgrade')
    context.loop.step(60)

    const back = context.restore(mark)

    // A hold that was not put back is a world that runs on where the captured one
    // was frozen, and the two disagree from the next step.
    assert.deepEqual(context.loop.holds, ['choosing an upgrade'])
    assert.equal(context.loop.holding, 0.5, 'and the hit stop with it')
    assert.deepEqual(back.holds, ['choosing an upgrade'], 'said in the answer, so a caller can let it go')
  })
})

test('a scoped plugin hands over what it holds, and is asked for it on the way back', async () => {
  await withFiles(PLUGIN_PROJECT, context => {
    context.loader.add(stepCounterPlugin)
    context.loop.step(10)

    const mark = context.capture()
    const held = mark.plugins['Step Counter']
    assert.equal(held.steps, 10, 'a plugin is asked by name')
    assert.deepEqual(held.held, context.stepCounter.held, 'and its own membership is in the moment')
    assert.equal(held.held.length, 2)

    context.loop.step(10)
    assert.equal(context.stepCounter.steps, 20, 'the plugin went on with the run')

    const back = context.restore(mark)

    // Contained, not equal: every registered plugin is asked on the way back,
    // including the engine plugins this world still has. The name can only be in
    // the list if its state was in the moment and was taken back.
    assert.equal(back.plugins.includes('Step Counter'), true)
    assert.equal(context.stepCounter.steps, 10, 'the plugin is standing where it stood')
    assert.deepEqual(context.stepCounter.held, held.held)
    assert.equal(context.stepCounter.restores, 1, 'asked once, not once per step after it')
  })
})

test('a plugin that will not go back is named, not left standing quietly', async () => {
  await withProject(context => {
    context.checkpoints.add('Stubborn', { capture: () => ({ at: 1 }), restore: () => false })

    const back = context.restore(context.capture())

    assert.deepEqual(back.refused, ['Stubborn'], 'a half-restore nobody is told about is the worst answer here')
  })
})

test('state in a moment for a plugin this world does not have is named too', async () => {
  await withProject(context => {
    const back = context.restore({ ...context.capture(), plugins: { Absent: { x: 1 } } })

    assert.deepEqual(back.refused, ['Absent'])
  })
})

test('a scheduled callback is named among what a moment could not carry', async () => {
  await withProject(context => {
    context.after(1, () => {})

    const mark = context.capture()

    assert.equal(mark.loop.scheduled, 1)
    assert.match(mark.lost[0], /1 scheduled callback, which is a closure/)
  })
})

test('a moment from another version of the engine is refused, not misread', async () => {
  await withProject(context => {
    assert.throws(() => context.restore({ version: 99 }), /version/)
  })
})

test('restoring a checkpoint discards timers created after capture', async () => {
  await withProject(context => {
    const mark = context.capture()
    let calls = 0
    context.after(0.1, () => calls++)
    context.every(0.1, () => calls++)
    context.restore(mark)
    context.loop.step(60)
    assert.equal(calls, 0)
    assert.equal(context.capture().loop.scheduled, 0)
    assert.deepEqual(mark.lost, [])
  })
})

test('restoring a checkpoint reports captured timers as lost and removes them', async () => {
  await withProject(context => {
    let calls = 0
    context.after(0.1, () => calls++)
    const mark = context.capture()
    const result = context.restore(mark)
    context.loop.step(60)
    assert.equal(calls, 0)
    assert.match(result.lost.join(' '), /scheduled callback/)
  })
})

test('a scoped plugin gets its membership back after entities left and returned', async () => {
  await withFiles(PLUGIN_PROJECT, context => {
    context.loader.add(stepCounterPlugin)
    context.loop.step(20)

    const mark = context.capture()
    const held = mark.plugins['Step Counter'].held
    assert.equal(held.length, 2, 'the plugin held the two entities the level placed')

    // Remove one entity and place another, so the membership the moment holds is a
    // world that no longer exists when the moment is put back.
    const victim = context.world.entities[0]
    const type = victim.type
    context.destroy(victim)
    context.loop.step(1)
    context.spawn(type, { at: [4, 6, 0] })
    context.loop.step(10)

    const back = context.restore(mark)

    assert.deepEqual(back.refused, [], 'the plugin took its moment back')
    assert.deepEqual(context.stepCounter.held, held, 'the membership the moment holds came back')
  })
})

test('a checkpoint of a simulated world carries a scoped plugin too', async () => {
  await withFiles(PLUGIN_PROJECT, context => {
    context.loader.add(stepCounterPlugin)
    const { loop, world } = context
    const steps = 50

    loop.step(steps)
    const mark = context.capture()
    const atMark = stateHash(world)
    const countAtMark = context.stepCounter.steps

    loop.step(steps)
    const carriedOn = stateHash(world)

    // Checked before it is claimed: a plugin that stood down leaves two identical
    // entity dumps to compare, and the comparison below would pass on nothing.
    assert.notEqual(carriedOn, atMark, 'the fifty steps moved the world')

    const back = context.restore(mark)

    // Contained, not equal: the engine plugins this world still has are asked too.
    assert.equal(back.plugins.includes('Step Counter'), true, 'the plugin put its state in the moment, and took it back')

    const afterRewind = stateHash(world)
    const countAfterRewind = context.stepCounter.steps

    assert.equal(afterRewind, atMark, 'the world at the rewind is the world at the mark, plugin included')
    assert.equal(countAfterRewind, countAtMark, 'and the plugin count came back with it')

    loop.step(steps)
    assert.equal(stateHash(world), carriedOn, 'and the fifty steps after it are the fifty steps that happened')
  })
})
