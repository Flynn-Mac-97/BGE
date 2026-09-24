/**
 * The read-only frame a plugin relies on: `stats`, `size`, and the pixel-to-world
 * mapping.
 *
 * These are answers about the last frame, so they are snapshots and do not move
 * under the reader. `toScreen` and `toWorld` are inverses in the flat view and
 * `pick` agrees with the box the flat view draws.
 *
 * Each frame gets its own viewport object: `frameSize` writes the session's
 * viewport in place, by design, so a shared literal would leak a size change
 * into the next test.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const ORTHO = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const PERSPECTIVE = { mode: 'perspective', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 90 }
const viewport = () => ({ width: 320, height: 180 })

const box = (id, x = 0, y = 0) => ({ id, type: 'wall', x, y, z: 0, mesh: { box: [1, 1, 1] } })

test('stats is a snapshot copy, so a reader cannot write the frame back', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  frame.sync({ entities: [box('a')] })
  const stats = frame.stats
  stats.entities = 999
  assert.equal(frame.stats.entities, 1, 'a fresh read is the frame, not the copy')
})

test('stats reports what the last sync held', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  frame.sync({ entities: [box('a'), box('b'), box('c')] })
  assert.equal(frame.stats.entities, 3)
})

test('size reports the viewport, and frameSize changes it', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  assert.deepEqual(frame.size, { w: 320, h: 180 })
  frame.frameSize(640, 360)
  assert.deepEqual(frame.size, { w: 640, h: 360 })
})

test('toScreen and toWorld are inverses in the flat view', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  const cases = [
    [0, 0],
    [3, -2],
    [-4, 5],
    [12.5, 7.25]
  ]
  for (const [x, y] of cases) {
    const pixel = frame.toScreen(x, y, 0)
    const back = frame.toWorld(pixel.x, pixel.y)
    assert.ok(Math.abs(back.x - x) < 1e-9, `x ${x} round trips, got ${back.x}`)
    assert.ok(Math.abs(back.y - y) < 1e-9, `y ${y} round trips, got ${back.y}`)
  }
})

test('toScreen says whether a point is behind a perspective camera', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  assert.equal(frame.toScreen(0, 0, -5).behind, false, 'in front')
  assert.equal(frame.toScreen(0, 0, 5).behind, true, 'behind the eye')
})

test('pick answers the entities under a pixel, front to back', async () => {
  const frame = await makeRenderer(null, ORTHO, viewport())
  const world = { entities: [box('under'), box('over'), box('far', 10, 0)] }
  frame.sync(world)

  const cases = [
    ['both at the origin, the later one first', 160, 90, ['over', 'under']],
    ['nothing under an empty pixel', 5, 5, []]
  ]
  for (const [label, pixelX, pixelY, expected] of cases) {
    assert.deepEqual(
      frame.pick(world, pixelX, pixelY).map(entity => entity.id),
      expected,
      label
    )
  }
})

test('ray starts at the eye and points through the pixel, into the scene', async () => {
  const frame = await makeRenderer(null, PERSPECTIVE, viewport())
  // `ray` hands back the shared raycaster's ray, so each answer is read before
  // the next call rewrites it.
  const centre = frame.ray(160, 90)
  const centreOrigin = centre.origin.toArray()
  const centreDirection = centre.direction.toArray()
  const cornerDirection = frame.ray(0, 0).direction.toArray()

  assert.deepEqual(centreOrigin, frame.camera.position.toArray(), 'the ray starts at the eye')
  assert.ok(centreDirection[2] < 0, 'the ray points into the scene')
  assert.ok(Math.abs(Math.hypot(...centreDirection) - 1) < 1e-9, 'the direction is a unit vector')
  assert.notDeepEqual(cornerDirection, centreDirection, 'a different pixel gives a different ray')
})
