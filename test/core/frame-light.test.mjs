/**
 * What a level says about light, fog and sky: the four setters on the renderer.
 *
 * A value that cannot be read leaves what is already there alone, so a level
 * that only wanted to change the sun's colour does not black out its own sun or
 * move its shadow. A level that says nothing about light is still lit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const lights = frame => ({
  ambient: frame.scene.children.find(object => object.isAmbientLight),
  sun: frame.scene.children.find(object => object.isDirectionalLight)
})

const close = (a, b) => Math.abs(a - b) < 1e-9

test('a world is lit before any level says a word about light', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const { ambient, sun } = lights(frame)
  assert.ok(ambient, 'an ambient light exists')
  assert.ok(sun, 'a sun exists')
  assert.ok(sun.position.length() > 0, 'the sun has a direction to shine from')
})

test('setSky stores a flat background, and null clears it', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.setSky('#101820')
  assert.equal(frame.scene.background.getHexString(), '101820')
  frame.setSky(null)
  assert.equal(frame.scene.background, null, 'null leaves the page showing through')
})

test('setFog stores exponential-squared fog, and a density of zero turns it off', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.setFog(0.01, '#808890')
  assert.equal(frame.scene.fog.isFogExp2, true)
  assert.ok(close(frame.scene.fog.density, 0.01))
  assert.equal(frame.scene.fog.color.getHexString(), '808890')

  frame.setFog(0)
  assert.equal(frame.scene.fog, null, 'no density is no fog')
})

test('setAmbient stores an intensity and a colour, and an unreadable value leaves its half alone', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.setAmbient(0.6, '#88aacc')
  const { ambient } = lights(frame)
  assert.ok(close(ambient.intensity, 0.6))
  assert.equal(ambient.color.getHexString(), '88aacc')

  frame.setAmbient('not-a-number')
  assert.ok(close(ambient.intensity, 0.6), 'a bad intensity leaves the last one in place')

  frame.setAmbient(undefined, 'not-a-colour')
  assert.equal(ambient.color.getHexString(), '88aacc', 'a bad colour leaves the last one in place')
})

test('setSun points the lamp against the travel direction, and stores intensity and colour', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const { sun } = lights(frame)
  const cases = [[-0.4, -1, -0.3], [0, -1, 0], [1, -2, 3]]
  for (const direction of cases) {
    frame.setSun(direction, 1.1, '#ffe0c0')
    const length = Math.hypot(...direction)
    const expected = direction.map(value => -value / length)
    const actual = [sun.position.x, sun.position.y, sun.position.z].map(value => value / sun.position.length())
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(close(actual[axis], expected[axis]), `axis ${axis} of ${direction}`)
    }
    assert.ok(close(sun.intensity, 1.1))
    assert.equal(sun.color.getHexString(), 'ffe0c0')
  }
})

test('an unreadable sun direction leaves the sun exactly where it was', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.setSun([-0.4, -1, -0.3], 1, '#ffffff')
  const { sun } = lights(frame)
  const before = sun.position.toArray()

  const unreadable = [[0, 0, 0], [1, 2], ['x', 'y', 'z'], [NaN, 1, 2]]
  for (const direction of unreadable) {
    frame.setSun(direction, 1, '#ffffff')
    assert.deepEqual(sun.position.toArray(), before, JSON.stringify(direction))
  }
})

test('changing only the sun colour does not reset its direction', async () => {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  frame.setSun([0, -1, 0], 1, '#ffffff')
  const { sun } = lights(frame)
  const before = sun.position.toArray()

  frame.setSun(undefined, 0.5, '#ff0000')
  assert.deepEqual(sun.position.toArray(), before, 'the direction is untouched')
  assert.ok(close(sun.intensity, 0.5))
  assert.equal(sun.color.getHexString(), 'ff0000')
})
