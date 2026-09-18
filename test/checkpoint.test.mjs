/**
 * A checkpoint of a whole run: taken, carried on from, and put back.
 *
 * `world.capture()` puts the entities back and nothing else. A moment is more than
 * the entities: it is the clock, the random stream, the keys that were down, and
 * whatever a solver holds outside the world. Miss any one of them and the restore
 * looks right and runs wrong — so every test here steps PAST the moment and then
 * steps the same distance again, and asks whether it landed where the run landed.
 *
 * The project's type draws from the random stream, reads the clock and reads the
 * keyboard, so each of the three has to come back for the second run to be the
 * first run. A step that touched none of them would pass without the loop's share
 * being carried at all.
 *
 * The Rapier pair at the end is the case the whole feature exists for, and it
 * checks that the solver put bytes in the moment before it claims anything: a
 * solver that stood down leaves two identical entity dumps to compare.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from './fixture-project.mjs'
import { startWorldInNode } from '../engine/start-world-node.mjs'
import { stateHash } from '../engine/world.js'

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
    if (context.input.held('right')) e.y += 0.01
  }
}
`
}

/** Rapier is offered the entities; the built-in solvers would own them instead. */
const CHOOSE_RAPIER = { disabled: ['Physics 3D', 'Physics 2D'] }

const SOLVERS = [
  {
    plugin: 'Rapier 3D',
    name: '3D',
    files: {
      'game.json': { title: 'checkpoint-3d', startLevel: 'main', plugins: CHOOSE_RAPIER },
      'levels/main.json': {
        camera: { at: [0, 6] },
        entities: [
          { type: 'floor', at: [0, -1, 0] },
          { type: 'box', at: [0, 6, 0] },
          { type: 'box', at: [0.4, 9, 0.2] }
        ]
      },
      'types/floor.js': "export default { collider: { box: [12, 0.4, 12] }, properties: { body: 'solid' } }\n",
      'types/box.js': "export default { collider: { box: [0.6, 0.6, 0.6] }, properties: { body: 'dynamic' } }\n"
    }
  },
  {
    plugin: 'Rapier 2D',
    name: '2D',
    files: {
      'game.json': { title: 'checkpoint-2d', startLevel: 'main', plugins: CHOOSE_RAPIER },
      'levels/main.json': {
        camera: { at: [0, 4] },
        entities: [
          { type: 'floor', at: [0, -1, 0] },
          { type: 'ball', at: [0, 5, 0] }
        ]
      },
      // Two numbers in a box, or a circle, is Rapier 2D's claim. Three is 3D's.
      'types/floor.js': "export default { collider: { box: [12, 0.4] }, properties: { body: 'solid' } }\n",
      'types/ball.js': "export default { collider: { circle: 0.4 }, properties: { body: 'dynamic' } }\n"
    }
  }
]

/** The boot every test in this file uses, so one change reaches all of them. */
const boot = async project => (await startWorldInNode({ root: CHECKOUT, project })).context

/**
 * Open the project, take a moment fifty steps in, run on, and put it back.
 *
 * Shared by the two solvers so the two differ only in what they declare.
 */
async function rewindThrough(files) {
  const project = await temporaryProject(files, 'checkpoint-')
  try {
    const context = await boot(project)
    const { loop, world } = context
    const steps = 50

    loop.step(steps)
    const mark = context.capture()
    const atMark = stateHash(world)
    loop.step(steps)
    const carriedOn = stateHash(world)

    const back = context.restore(mark)
    const afterRewind = stateHash(world)
    loop.step(steps)

    return { atMark, carriedOn, back, afterRewind, replayed: stateHash(world) }
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
}

/** A project of one drifting entity, made and removed by the test that uses it. */
async function withProject(body) {
  const project = await temporaryProject(PROJECT)
  try {
    return await body(await boot(project))
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
}

test('the clock, the stream and the keys come back with the entities', async () => {
  await withProject(context => {
    const { loop, world } = context
    context.input.press('KeyD')

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
    assert.equal(context.input.held('right'), true, 'and the key that was down is down again')

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

test('a plugin hands over what it holds, and is asked for it on the way back', async () => {
  await withProject(context => {
    const mine = { frames: 0 }
    let puts = 0
    context.checkpoints.add('Counter', {
      capture: () => ({ frames: mine.frames }),
      restore: state => { mine.frames = state.frames; puts++; return true }
    })

    context.loop.step(10)
    mine.frames = 12
    const mark = context.capture()
    assert.deepEqual(mark.plugins, { Counter: { frames: 12 } }, 'a plugin is asked by name')

    mine.frames = 99
    context.loop.step(10)
    const back = context.restore(mark)

    // Contained, not equal: every registered plugin is asked on the way back — one
    // the moment holds nothing for is asked to hold nothing again — and this project
    // leaves both Rapier solvers registered and standing down.
    assert.equal(back.plugins.includes('Counter'), true)
    assert.equal(mine.frames, 12, 'the plugin is standing where it stood')
    assert.equal(puts, 1, 'asked once, not once per step after it')
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

for (const { plugin, name, files } of SOLVERS) {
  test(`${name} restores body membership after removal and spawning`, async () => {
    const project = await temporaryProject(files, 'checkpoint-membership-')
    try {
      const context = await boot(project)
      context.loop.step(30)
      const mark = context.capture()
      context.loop.step(50)
      const expected = stateHash(context.world)
      context.restore(mark)
      const victim = context.world.entities.find(entity => entity.properties.body === 'dynamic')
      const type = victim.type
      context.world.destroy(victim)
      context.loop.step(1)
      context.spawn(type, { at: [4, 10, 0] })
      context.loop.step(10)
      assert.deepEqual(context.restore(mark).refused, [])
      context.loop.step(50)
      assert.equal(stateHash(context.world), expected)
      const service = name === '3D' ? context.rapier3d : context.rapier2d
      const RAPIER = await import(name === '3D' ? '@dimforge/rapier3d-deterministic-compat' : '@dimforge/rapier2d-deterministic-compat')
      const solver = RAPIER.World.restoreSnapshot(service.snapshot())
      let count = 0
      solver.forEachRigidBody(() => count++)
      solver.free()
      assert.equal(count, mark.plugins[plugin].bodies.length)
      // A second restore checks that replay did not mutate the captured mapping.
      context.restore(mark)
      context.loop.step(50)
      assert.equal(stateHash(context.world), expected)
    } finally { await fs.rm(project, { recursive: true, force: true }) }
  })
  test(`a checkpoint of a simulated world carries ${name} too`, async () => {
    const { atMark, carriedOn, back, afterRewind, replayed } = await rewindThrough(files)

    // Checked before it is claimed: a solver that stood down leaves two identical
    // entity dumps to compare, and the comparison below would pass on nothing.
    assert.notEqual(carriedOn, atMark, 'the fifty steps moved the world')
    // Contained, not equal: the other dimension's solver is loaded too, claims no
    // entity here, and hands over the bytes of the world it built and left empty.
    // The name can only be in the list if its state was in the moment and was taken
    // back, which is what makes this the check and not a formality.
    assert.equal(back.plugins.includes(plugin), true, `${plugin} put its state in the moment, and took it back`)
    assert.equal(afterRewind, atMark, 'the world at the rewind is the world at the mark, solver included')
    assert.equal(replayed, carriedOn, 'and the fifty steps after it are the fifty steps that happened')
  })
}
