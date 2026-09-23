/**
 * `renderer.stages` — a draw at a named point in the frame, and taking a core
 * stage over.
 *
 * The core stage draws are kept, so `replace` and `skip` are reversible and
 * `restore` puts the default back. A plugin that renders the world its own way
 * replaces `world`, and the core does not draw underneath it.
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

test('the anchor decides the point, not the order the draws were added in', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const log = []
  // Registered first, but the walk runs `world`'s after list before `post`'s
  // before list.
  frame.stages.add('before-post', () => log.push('before-post'), { before: 'post' })
  frame.stages.add('after-world', () => log.push('after-world'), { after: 'world' })
  frame.draw()
  assert.deepEqual(log, ['after-world', 'before-post'])
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

test('skip draws nothing at a core stage, and the draws around it still run', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const core = watchCoreWorldDraw(frame)
  const log = []
  frame.stages.add('around', () => log.push('around'), { after: 'world' })
  frame.stages.skip('world')
  frame.draw()

  assert.equal(core.draws, 0, 'a skipped stage draws nothing')
  assert.deepEqual(log, ['around'], 'an anchor around a skipped stage still runs')
})

test('restore puts the core draw back after a replace and after a skip', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const core = watchCoreWorldDraw(frame)

  frame.stages.replace('world', () => {})
  frame.draw()
  assert.equal(core.draws, 0)

  frame.stages.restore('world')
  frame.draw()
  assert.equal(core.draws, 1)

  frame.stages.skip('world')
  frame.draw()
  assert.equal(core.draws, 1)

  frame.stages.restore('world')
  frame.draw()
  assert.equal(core.draws, 2)
})

test('every draw in one frame is handed the same frame record', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const seen = []
  frame.stages.add('probe', frameRecord => seen.push(frameRecord), { after: 'world' })
  frame.draw()
  frame.draw()
  assert.equal(seen.length, 2)
  assert.equal(seen[0], seen[1], 'nothing is allocated for a frame that registers no stage')
})

test('a draw aimed at a stage that does not exist is refused, and the frame still runs', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const core = watchCoreWorldDraw(frame)
  const log = []
  frame.stages.add('bad-add', () => log.push('add'), { before: 'no-such-stage' })
  frame.stages.replace('no-such-stage', () => log.push('replace'))
  frame.stages.skip('no-such-stage')
  frame.stages.restore('no-such-stage')
  frame.draw()

  assert.deepEqual(log, [], 'no draw was added or run')
  assert.equal(core.draws, 1, 'the core frame is unaffected')
})
