/**
 * What a level says about light, fog and sky: the four setters on the renderer.
 *
 * A value that cannot be read leaves what is already there alone, so a level
 * that only wanted to change the sun's colour does not black out its own sun or
 * move its shadow. A level that says nothing about light is still lit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../../engine/render.js'
import { clearReported } from '../../../engine/render/report.js'
import { captureConsoleError } from './report-capture.mjs'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

const lights = frame => ({
  ambient: frame.scene.children.find(object => object.isAmbientLight),
  sun: frame.scene.children.find(object => object.isDirectionalLight)
})

const close = (first, second) => Math.abs(first - second) < 1e-9

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
  const cases = [
    [-0.4, -1, -0.3],
    [0, -1, 0],
    [1, -2, 3]
  ]
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

  const unreadable = [
    [0, 0, 0],
    [1, 2],
    ['x', 'y', 'z'],
    [NaN, 1, 2]
  ]
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

test('a sun direction that was left out is not reported', async () => {
  clearReported()
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const said = captureConsoleError(() => frame.setSun(undefined, 1, '#ffffff'))
  assert.deepEqual(said, [], 'omitting the direction is a normal call, not a mistake')
})

/** A frame with one casting directional light, drawn once so its shadow is remembered. */
async function castingLightFrame() {
  const frame = await makeRenderer(null, VIEW, VIEWPORT)
  const light = new THREE.DirectionalLight()
  light.castShadow = true
  frame.scene.add(light)
  const world = { entities: [] }
  frame.draw(world)
  light.shadow.needsUpdate = false
  frame.draw(world)
  return { frame, light, world }
}

test('the shadow map is redrawn when the sun moves on any axis', async () => {
  for (const axis of ['x', 'y', 'z']) {
    const { frame, light, world } = await castingLightFrame()
    assert.equal(light.shadow.needsUpdate, false, 'an unchanged frame keeps the map it already has')

    light.position[axis] += 2
    frame.draw(world)
    assert.equal(light.shadow.needsUpdate, true, `a move on ${axis} redraws the map`)
  }
})

test('the shadow map is redrawn when the thing the sun points at moves', async () => {
  for (const axis of ['x', 'y', 'z']) {
    const { frame, light, world } = await castingLightFrame()

    light.target.position[axis] += 3
    frame.draw(world)
    assert.equal(light.shadow.needsUpdate, true, `a target move on ${axis} redraws the map`)
  }
})

test('the shadow map is redrawn when the shadow camera box changes', async () => {
  for (const field of ['left', 'right', 'top', 'bottom', 'near', 'far']) {
    const { frame, light, world } = await castingLightFrame()

    light.shadow.camera[field] += 1
    frame.draw(world)
    assert.equal(light.shadow.needsUpdate, true, `a change to ${field} redraws the map`)
  }
})

test('the shadow map is redrawn when it is resized', async () => {
  const { frame, light, world } = await castingLightFrame()

  light.shadow.mapSize.width = 2048
  frame.draw(world)
  assert.equal(light.shadow.needsUpdate, true, 'a wider map is a different map')
})

test('a casting light has three its own shadow update switched off', async () => {
  const { light } = await castingLightFrame()
  assert.equal(light.shadow.autoUpdate, false, 'the kernel decides which frame redraws the map')
})

test('a light with no target is never treated as a moving target', async () => {
  const { frame, light, world } = await castingLightFrame()
  light.target = null
  frame.draw(world)
  light.shadow.needsUpdate = false

  frame.draw(world)
  assert.equal(light.shadow.needsUpdate, false, 'a light with nowhere to point has nothing that moves')
})

test('a shadow with no camera is never treated as a moving view', async () => {
  const { frame, light, world } = await castingLightFrame()
  light.shadow.camera = null
  frame.draw(world)
  light.shadow.needsUpdate = false

  frame.draw(world)
  assert.equal(light.shadow.needsUpdate, false, 'a shadow with no camera has no box to move')
})
