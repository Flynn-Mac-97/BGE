/**
 * Input recorded as part of the run.
 *
 * A key arrives between two steps. If the step it arrived at is not written down,
 * the same run cannot be played again — two `simulate` calls would differ by their
 * inputs and the difference would be blamed on whatever was under test.
 *
 * The sharpest check here is the count. A key pressed before ten steps is one
 * press, and the old implementation answered ten, because `pressed` was cleared on
 * the frame phase and a headless `step(10)` runs one frame for ten steps.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from '../../fixture-project.mjs'
import { startWorldInNode } from '../../../engine/start-world-node.mjs'
import { stateHash } from '../../../engine/world.js'

/** A game whose only source of motion is the keyboard. */
const PROJECT = {
  'game.json': { title: 'input-record', startLevel: 'main' },
  'levels/main.json': { entities: [{ type: 'mover', at: [0, 0, 0] }] },
  'types/mover.js': `export default {
  properties: { jumps: 0, steps: 0 },
  update(e, seconds, context) {
    e.properties.steps = (e.properties.steps || 0) + 1
    if (context.input.held('right')) e.x += 0.1
    if (context.input.pressed('jump')) e.properties.jumps = (e.properties.jumps || 0) + 1
  }
}
`
}

const boot = async project => (await startWorldInNode({ root: CHECKOUT, project })).context
const bodyOf = context => context.world.entities[0]

test('a press before ten steps is one press, not ten', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const context = await boot(project)
    context.input.press('Space')
    context.loop.step(10)

    assert.equal(bodyOf(context).properties.steps, 10, 'the world ran all ten steps')
    assert.equal(
      bodyOf(context).properties.jumps,
      1,
      'pressed means one step, whether the steps came as ten calls or one'
    )
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('a held key stays held until it is let go, and the record says when', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const context = await boot(project)
    context.input.press('KeyD')
    assert.equal(context.input.held('right'), true)
    assert.equal(context.input.axis('x'), 1, 'the action the key means')

    context.loop.step(5)
    assert.equal(context.input.axis('x'), 1, 'still held five steps later')

    context.input.release('KeyD')
    assert.equal(context.input.axis('x'), 0, 'and let go of when it is let go of')

    assert.deepEqual(
      context.loop.input.events.map(event => [event.at, event.code, event.down]),
      [
        [0, 'KeyD', true],
        [5, 'KeyD', false]
      ],
      'each event carries the step count it arrived at'
    )
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('a run is played again from its own record', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const first = await boot(project)
    first.loop.input.press('KeyD')
    for (let at = 0; at < 60; at++) {
      if (at === 30) first.loop.input.release('KeyD')
      first.loop.step(1)
    }
    const record = first.loop.input.events
    assert.equal(record.length, 2, 'a press and a release')

    // The second world is only ever told what the first one recorded.
    const second = await boot(project)
    const pending = [...record]
    for (let at = 0; at < 60; at++) {
      while (pending.length && pending[0].at <= second.loop.steps) {
        const event = pending.shift()
        if (event.down) second.loop.input.press(event.code)
        else second.loop.input.release(event.code)
      }
      second.loop.step(1)
    }

    assert.equal(
      stateHash(second.world),
      stateHash(first.world),
      'the record has to be enough to play the run again, on its own'
    )
    assert.equal(bodyOf(second).properties.jumps, bodyOf(first).properties.jumps)
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('a world picked up mid-run is still holding what was held', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const first = await boot(project)
    first.loop.input.press('KeyD')
    first.loop.step(30)
    const carried = {
      steps: first.loop.steps,
      seed: first.loop.random.seed,
      draws: first.loop.random.draws,
      input: first.loop.input.events
    }

    const second = await boot(project)
    second.loop.resume(carried)

    assert.equal(second.loop.steps, 30)
    assert.equal(
      second.loop.input.isDown('KeyD'),
      true,
      'a key held when the world was captured is held when it is put back'
    )
    second.loop.step(1)
    assert.equal(second.loop.input.isDown('KeyD'), true, 'and it stays held')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})

test('a level load forgets input with the clock', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const context = await boot(project)
    context.input.press('KeyD')
    assert.equal(context.loop.input.isDown('KeyD'), true)

    await context.editor.loadLevel('main')

    assert.equal(
      context.loop.input.isDown('KeyD'),
      false,
      'a level that opened with a key already down would not begin the same way twice'
    )
    assert.deepEqual(context.loop.input.events, [], 'and the record starts again with it')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})
