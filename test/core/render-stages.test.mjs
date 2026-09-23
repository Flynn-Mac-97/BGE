/**
 * The renderer's frame stages: a draw at a named point, and replace or skip of
 * a core draw.
 *
 * The stage walk runs with no GL context, so the picture a plugin makes is not
 * tested here; what is tested is the contract — where a draw runs, what frame
 * it is handed, and that replacing the world keeps the core out of the way.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

/** Count the core world draw's card call, so a replacement shows as a count of zero. */
function watchCoreWorldDraw(frame) {
  const seen = { draws: 0 }
  frame.threeRenderer.render = () => { seen.draws++ }
  return seen
}

test('the frame runs three named stages, in order', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  assert.deepEqual(frame.stages.names, ['world', 'post', 'viewmodel'])
})

test('a draw registered before or after a stage runs at that point', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const log = []
  frame.stages.add('late', () => log.push('late'), { after: 'world' })
  frame.stages.add('early', () => log.push('early'), { before: 'world' })
  frame.stages.add('last', () => log.push('last'), { after: 'viewmodel' })
  frame.stages.add('middle', () => log.push('middle'), { before: 'viewmodel' })
  frame.draw()
  assert.deepEqual(log, ['early', 'late', 'middle', 'last'])
})

test('draws at one place run in the order they were added', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const log = []
  frame.stages.add('first', () => log.push('first'), { after: 'world' })
  frame.stages.add('second', () => log.push('second'), { after: 'world' })
  frame.draw()
  assert.deepEqual(log, ['first', 'second'])
})

test('remove takes only the draw added under that name', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const log = []
  frame.stages.add('kept', () => log.push('kept'), { after: 'world' })
  frame.stages.add('dropped', () => log.push('dropped'), { after: 'world' })
  frame.stages.remove('dropped')
  frame.draw()
  assert.deepEqual(log, ['kept'])
})

test('a plugin can replace the world draw and gets a coherent frame', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const core = watchCoreWorldDraw(frame)
  const handed = []
  frame.stages.replace('world', frameRecord => handed.push(frameRecord))
  frame.draw()

  assert.equal(core.draws, 0, 'the core world draw never ran')
  assert.equal(handed.length, 1)
  assert.equal(handed[0].camera, frame.camera, 'the camera the picture comes from')
  assert.equal(handed[0].width, VIEWPORT.width)
  assert.equal(handed[0].height, VIEWPORT.height)
  assert.ok('target' in handed[0], 'the target the frame draws into is on the frame')
})

test('a plugin can skip the world draw and the stage walk still runs', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const core = watchCoreWorldDraw(frame)
  const log = []
  frame.stages.add('around', () => log.push('around'), { after: 'world' })
  frame.stages.skip('world')
  frame.draw()

  assert.equal(core.draws, 0, 'a skipped stage draws nothing')
  assert.deepEqual(log, ['around'], 'an anchor around a skipped stage still runs')
})

test('restore puts the core draw back', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const core = watchCoreWorldDraw(frame)
  frame.stages.replace('world', () => {})
  frame.draw()
  assert.equal(core.draws, 0)

  frame.stages.restore('world')
  frame.draw()
  assert.equal(core.draws, 1)
})

test('every draw is handed the same frame record, so nothing is allocated per frame', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const seen = []
  frame.stages.add('probe', frameRecord => seen.push(frameRecord), { after: 'world' })
  frame.draw()
  frame.draw()
  assert.equal(seen.length, 2)
  assert.equal(seen[0], seen[1])
})
