/**
 * The two places a profiler number can be wrong and still look right.
 *
 * Both fail silently and both get read into a table and acted on:
 *
 * - A backend that says it can time itself and returns a constant. WebGL 2 with
 *   `EXT_disjoint_timer_query_webgl2` reports about a thousand milliseconds a
 *   frame whatever is drawn.
 * - A fill sized to less than the frame. Then the number measures the frustum
 *   rather than the shader, and it is small and plausible either way.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { believable } from '../plugins/builtin/profiler.js'
import { sizeToFill, facing } from '../plugins/builtin/profiler/fill.js'

test('a GPU sample the sampling loop is shorter than is dropped, and named', () => {
  const answer = believable([1004.759, 1004.759], 40, 'WebGLBackend')
  assert.equal(answer.gpu, null)
  assert.match(answer.why, /WebGLBackend/)
  assert.match(answer.why, /1004\.759/)
  assert.match(answer.why, /40/)
})

test('plausible GPU samples are reported', () => {
  const answer = believable([0.3, 0.4, 0.5], 40, 'WebGPUBackend')
  assert.equal(answer.why, undefined)
  assert.equal(answer.gpu.median, 0.4)
})

test('the plausible samples survive an implausible one', () => {
  const answer = believable([0.3, 0.4, 9999], 40, 'WebGPUBackend')
  assert.equal(answer.gpu.median, 0.4)
})

test('no samples at all says the backend cannot time itself', () => {
  const answer = believable([], 40, 'WebGLBackend')
  assert.equal(answer.gpu, null)
  assert.match(answer.why, /cannot time itself/)
})

test('a perspective camera is filled by the frame its own field of view cuts', () => {
  // 90 degrees vertical means the visible height equals twice the distance.
  const size = sizeToFill({ isPerspectiveCamera: true, fov: 90, aspect: 2 }, 5)
  assert.ok(size.tall > 10, `${size.tall} must exceed the 10 metres the frame cuts at 5 metres`)
  assert.ok(size.wide > size.tall, 'a wide frame needs a wider quad than it is tall')
  assert.equal(size.from, 'perspective camera')
})

test('an orthographic camera is filled by its own box, divided by its zoom', () => {
  const size = sizeToFill({ isOrthographicCamera: true, left: -10, right: 10, top: 5, bottom: -5, zoom: 2 }, 5)
  // 20 wide and 10 tall at zoom 1, so half that at zoom 2, plus the margin.
  assert.ok(size.wide > 10 && size.wide < 11, `${size.wide} must be just over 10`)
  assert.ok(size.tall > 5 && size.tall < 5.5, `${size.tall} must be just over 5`)
})

test('a camera that is neither kind fills nothing, rather than guessing', () => {
  assert.equal(sizeToFill({}, 5), null)
  assert.equal(sizeToFill(null, 5), null)
})

test('the stack is put in front of the camera and turned to face it', () => {
  // Looking along -Z from the origin: the third column of the world matrix is
  // the camera's own +Z, so -Z of it is where it looks.
  const camera = {
    position: { x: 0, y: 2, z: 10 },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 10, 1] },
    updateWorldMatrix() {}
  }
  const place = facing(camera, 6)
  assert.deepEqual(place.at, [0, 2, 4], 'six metres along the way it looks')
  // A quad's own normal is +Z and the camera is at +Z, so it needs no turn.
  // Rounded through zero, because -0 is what Math.round gives a small negative.
  assert.deepEqual(place.rotation.map(value => Math.round(value) || 0), [0, 0, 0])
})

test('a camera looking along +X turns the stack a quarter turn the other way', () => {
  const camera = {
    position: { x: 0, y: 0, z: 0 },
    // Camera +Z is world -X, so it looks along +X.
    matrixWorld: { elements: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1] },
    updateWorldMatrix() {}
  }
  const place = facing(camera, 4)
  assert.deepEqual(place.at.map(value => Math.round(value) || 0), [4, 0, 0])
  // Minus, not plus: the quad's normal must point back down -X at the camera,
  // and a +Z normal reaches -X by turning a quarter turn anticlockwise.
  assert.equal(Math.round(place.rotation[1]), -90)
})
