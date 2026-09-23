#!/usr/bin/env node
/**
 * The restore probe for See's drawing commands.
 *
 * `see.capture` and `see.moment` are the only state-changing code in the
 * plugin: they borrow the camera, hide every entity but the subject, null the
 * scene background and fog, dim the lights, empty the post chain, add a light
 * rig, and put all of it back in a `finally`. A world started with
 * `renderer: 'null'` answers the renderer surface and draws nothing, so that
 * path runs here with no GL and no browser, and every frame comes back blank.
 *
 * Run directly:
 *   node --test test/see-headless.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { startWorldInNode } from '../engine/start-world-node.mjs'
import { FIXTURE, FIXTURE_LEVEL } from './fixture-project.mjs'

/** The demo level: nine entities, a fixed camera, no plugin's own scenery. */
const LEVEL = FIXTURE_LEVEL

const started = await startWorldInNode({ project: FIXTURE, renderer: 'null' })
const { context, engine } = started
await context.editor.loadLevel(LEVEL)

const bare = await startWorldInNode({ project: FIXTURE })

/** A sentinel of every piece a studio capture borrows, put into the live scene. */
async function loadTheScene() {
  const scene = context.renderer.scene
  context.renderer.sync(context.world)
  // The post chain is the Post Processing plugin's pass, so the sentinel is a
  // real chain: See must put it back after the capture.
  await context.post.set([{ grade: {} }])
  scene.background = 'sentinel-background'
  scene.fog = { colour: 'sentinel-fog' }
  const light = { isLight: true, visible: true, name: 'sentinel-light' }
  const overlay = { visible: true, userData: { overlay: true }, name: 'sentinel-overlay' }
  scene.add(light)
  scene.add(overlay)
  Object.assign(context.view, { x: 11, y: 5, z: 2, yaw: 0.4, pitch: -0.2, fov: 70, mode: 'perspective', zoom: 32 })
  for (const entity of context.world.entities) entity.hidden = false
  return { scene, light, overlay, children: scene.children.length, view: { ...context.view } }
}

const firstEntity = () => context.world.entities[0].id

test('a world with no renderer refuses a capture and names the verb that answers', async () => {
  const answer = await bare.engine.run('see.capture', {})
  assert.ok(answer.missing?.includes('no context.renderer'), JSON.stringify(answer))
  assert.match(answer.instead, /see\.sketch/)
})

test('the null renderer answers the surface, so the capture runs instead of refusing', async () => {
  const answer = await engine.run('see.capture', { ui: false })
  assert.equal(answer.missing, undefined, 'nothing is missing from the surface')
  assert.equal(answer.blank, true)
})

test('a blank frame is reported as blank and no image is written', async () => {
  const answer = await engine.run('see.capture', { ui: false })
  assert.equal(answer.blank, true)
  assert.match(answer.error, /read back empty/)
  assert.match(answer.error, /every frame is blank/)
  assert.equal(answer.__files, undefined, 'nothing drew, so nothing is written')
  assert.equal(answer.hidden, false, 'there is no tab, so no tab is hidden')
})

test('a studio capture puts the whole scene back', async () => {
  const before = await loadTheScene()
  const subject = firstEntity()

  const answer = await engine.run('see.capture', { subject, alone: true })
  assert.match(answer.error, /the studio drew nothing/)
  assert.match(answer.why, /every frame is blank/)

  assert.equal(before.scene.background, 'sentinel-background', 'the background is put back')
  assert.deepEqual(before.scene.fog, { colour: 'sentinel-fog' }, 'the fog is put back')
  assert.equal(before.light.visible, true, 'the dimmed light is lit again')
  assert.equal(before.overlay.visible, true, 'the scene child is shown again')
  assert.equal(context.post.built, 1, 'the post chain is put back')
  assert.ok(context.renderer.graph.passes.some(pass => pass.name === 'post'), 'the post pass draws again')
  assert.deepEqual({ ...context.view }, before.view, 'the camera is handed back')
  assert.equal(before.scene.children.length, before.children, 'the light rig is taken out again')
  for (const entity of context.world.entities) {
    assert.equal(entity.hidden, false, `${entity.id} is visible again`)
  }
})

test('an entity the world had already hidden stays hidden', async () => {
  await loadTheScene()
  const [subject, ...rest] = context.world.entities
  rest[0].hidden = true

  await engine.run('see.capture', { subject: subject.id, alone: true })

  assert.equal(rest[0].hidden, true, 'a capture restores what it hid, not what the world hid')
  assert.equal(rest[1].hidden, false)
  rest[0].hidden = false
})

test('overlay children are concealed for the draw and revealed after it', async () => {
  const before = await loadTheScene()
  await engine.run('see.capture', { ui: false })
  assert.equal(before.overlay.visible, true, 'the overlay is shown again')
  assert.deepEqual({ ...context.view }, before.view, 'an unmoved camera is left where it was')
})

test('a stated frame size is put back on the way out', async () => {
  await loadTheScene()
  const shape = { width: context.viewport.width, height: context.viewport.height }

  const answer = await engine.run('see.capture', { ui: false, size: [320, 240] })
  assert.equal(answer.blank, true)

  assert.deepEqual({ width: context.viewport.width, height: context.viewport.height }, shape,
    'the viewport every camera clamps against is the one the world started with')
})

test('a moment sheet steps the world, hands the camera back, and says it drew no sheet', async () => {
  const before = await loadTheScene()
  const subject = firstEntity()
  const clock = context.loop.time

  const answer = await engine.run('see.moment', { steps: [0, 6], subject })

  assert.match(answer.error, /no sheet/)
  assert.equal(answer.moments.length, 2, 'both instants were reached')
  assert.deepEqual(answer.moments.map(moment => moment.afterSteps), [0, 6])
  assert.ok(context.loop.time > clock, 'a moment advances the world, as it says it does')
  assert.deepEqual({ ...context.view }, before.view, 'the borrowed camera is handed back')
  assert.equal(before.overlay.visible, true)
  assert.equal(before.scene.children.length, before.children, 'nothing was left in the scene')
})

test('a capture pointed away from the level warns that the frame is not one anybody plays', async () => {
  await context.editor.loadLevel(LEVEL)
  for (let index = 0; index < 25; index++) context.spawn('prop', { at: [7 + index / 10, 3, 0] })
  const populated = context.world.entities.length
  assert.ok(populated >= 20, `the fixture holds ${populated} entities`)

  const inTheLevel = await engine.run('see.capture', { ui: false })
  assert.equal(inTheLevel.framing, undefined, 'the level camera frames the level')

  // The editor's own flat camera, parked kilometres off the map — the shape the
  // fault takes: a real camera framing ground the game never shows.
  const away = await engine.run('see.capture', { ui: false, camera: { mode: 'ortho', x: 90000, y: 90000 } })
  assert.match(away.framing, /0 of the level's \d+ entities/)
  assert.match(away.framing, /see\.view/)

  await context.editor.loadLevel(LEVEL)
})

test('a subject shot frames one thing on purpose and is never called unrepresentative', async () => {
  await context.editor.loadLevel(LEVEL)
  for (let index = 0; index < 25; index++) context.spawn('prop', { at: [7 + index / 10, 3, 0] })
  const subject = firstEntity()

  const answer = await engine.run('see.capture', { subject, alone: true })
  assert.equal(answer.framing, undefined)

  await context.editor.loadLevel(LEVEL)
})

test('the null renderer never reports a frame it did not draw', () => {
  const renderer = context.renderer
  assert.equal(renderer.blank, true, 'the flag every caller reads to say the frame is blank')
  const buffer = new Uint8Array(4 * 4 * 4).fill(255)
  renderer.drawInto({ width: 4, height: 4 }, buffer)
  assert.ok(buffer.every(byte => byte === 0), 'a readback of nothing is empty, never stale')
  assert.throws(() => renderer.createCanvas(2, 2).toDataURL(), /no image to encode/)
})
