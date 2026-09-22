/**
 * A world is not handed over until the start-up work its plugins declared has
 * finished.
 *
 * Rapier compiles megabytes of WebAssembly. Before this gate the first step ran
 * while it was still loading, so the same level at the same step count produced
 * two different worlds — one with physics, one without — and a simulation
 * answered as though nothing were missing.
 *
 * The check is that a run which waits and a run which does not are the same
 * world. The body having fallen is what makes that meaningful: without it two
 * physics-less runs would agree just as well.
 *
 * The project disables both built-in solvers, because Rapier stands down while
 * one of them is enabled and would then never load.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { CHECKOUT, temporaryProject } from '../fixture-project.mjs'
import { startWorldInNode } from '../../engine/start-world-node.mjs'

const FALL_FROM = 40
const SECONDS = 0.5

const PROJECT = {
  'game.json': {
    title: 'startup-gate',
    startLevel: 'main',
    plugins: { disabled: ['Physics 3D', 'Physics 2D'] }
  },
  'levels/main.json': {
    camera: { at: [0, 10] },
    entities: [{ type: 'faller', at: [0, FALL_FROM, 0] }]
  },
  'types/faller.js': `export default {
  mesh: { box: [1, 1, 1] },
  collider: { box: [1, 1, 1] },
  properties: { body: 'dynamic' }
}
`
}

/** Boot the project, simulate, and report where the body ended up. */
async function run(project, settleFor = 0) {
  const { context, engine } = await startWorldInNode({ root: CHECKOUT, project })
  if (settleFor) await new Promise(resolve => setTimeout(resolve, settleFor))
  engine.simulate(SECONDS)
  return {
    y: context.world.byId('faller-0').y,
    held: engine.snapshot().paused || []
  }
}

test('a run that steps at once and one that waits first are the same world', async () => {
  const project = await temporaryProject(PROJECT)
  try {
    const immediately = await run(project)
    const afterWaiting = await run(project, 1500)

    assert.ok(immediately.y < FALL_FROM,
      `the body should have fallen, so the solver was there (y=${immediately.y})`)
    assert.equal(immediately.y, afterWaiting.y,
      'waiting for a solver that had not finished must not change the answer')
    assert.deepEqual(immediately.held, [],
      'the hold should be released once the solver is ready')
  } finally {
    await fs.rm(project, { recursive: true, force: true })
  }
})
