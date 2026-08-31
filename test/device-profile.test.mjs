/**
 * The declared device profile, checked against the frame it writes.
 *
 * A game says once which screen it is drawn for. The viewport must come from
 * that declaration, a game that declares nothing must still get a viewport,
 * and the PNG a frame verb writes must carry the pixels the declaration asks
 * for — measured out of the file, because a reply is not the artefact.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startWorldInNode } from '../engine/start-world-node.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** A PNG's own pixels, from its IHDR: width at byte 16, height at 20. */
function pngPixels(file) {
  const bytes = fs.readFileSync(file)
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${file} is not a PNG`)
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

/**
 * Draw a headless frame and hand back the file it wrote. Deleted when the test
 * ends: agent-runs/see is the shared frame directory, not this test's.
 */
async function sketchFrame(t, engine) {
  const drawn = await engine.run('see.sketch', {})
  assert.ok(drawn.files?.[0], `see.sketch wrote no frame: ${JSON.stringify(drawn)}`)
  t.after(() => {
    for (const name of drawn.files) fs.rmSync(path.join(ROOT, name), { force: true })
  })
  return { files: drawn.files, png: path.join(ROOT, drawn.files[0]) }
}

test('a declared device sets the viewport and reaches context', async () => {
  const { context } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
  assert.equal(context.device.width, 540)
  assert.equal(context.device.height, 960)
  // Not declared. The engine derives it from the shape, so declaring it would
  // be a field nothing reads.
  assert.equal(context.device.orientation, 'portrait')
  assert.equal(context.viewport.width, 540)
  assert.equal(context.viewport.height, 960)
})

test('the game declares no field the engine cannot honour', async () => {
  const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'kitten-survivors/game.json'), 'utf8'))
  // No renderer draws at a declared ratio: the PNG is the viewport times the
  // page's own device pixel ratio, which see.capture measures into the sidecar.
  assert.equal(game.device.pixelRatio, undefined,
    'nothing renders at a declared pixel ratio, so declaring one states a falsehood')
  assert.deepEqual(Object.keys(game.device).sort(), ['comment', 'height', 'width'])
})

test('a game that declares no device still gets a viewport', async () => {
  const { context } = await startWorldInNode({ root: ROOT, project: 'project' })
  assert.equal(context.device.width, 1280)
  assert.equal(context.device.height, 720)
  assert.equal(context.device.orientation, 'landscape')
  assert.equal(context.viewport.width, 1280)
  assert.equal(context.viewport.height, 720)
})

test('a measured screen beats the declaration', async () => {
  const { context } = await startWorldInNode({
    root: ROOT, project: 'kitten-survivors', viewport: { width: 800, height: 600 }
  })
  assert.equal(context.viewport.width, 800)
  assert.equal(context.device.width, 540)
})

test('the frame is written at the declared screen, not at the agent window', async t => {
  const { engine, context } = await startWorldInNode({
    root: ROOT, project: 'kitten-survivors', viewport: { width: 800, height: 600 }
  })
  const frame = await sketchFrame(t, engine)
  // 540x960 at the sketch's fixed quarter scale. The window would give 200x150,
  // and an ortho camera fitted to 800x600 shows world the phone never does.
  assert.deepEqual(pngPixels(frame.png), [135, 240],
    'the PNG must carry the declared screen, whatever window the agent has')
  assert.equal(context.viewport.width, 800, 'the frame gives the window back')
  assert.equal(context.viewport.height, 600)
})

test('a game with no declaration writes its frame at the default screen', async t => {
  const { engine } = await startWorldInNode({ root: ROOT, project: 'project' })
  // 1280x720 at the same quarter scale.
  assert.deepEqual(pngPixels((await sketchFrame(t, engine)).png), [320, 180])
})

test('two frames of one world are two files on disk, named without a client', async t => {
  const { engine, context } = await startWorldInNode({ root: ROOT, project: 'kitten-survivors' })
  const first = await sketchFrame(t, engine)
  const second = await sketchFrame(t, engine)
  const level = context.editor.levelName
  // Headless there is no page, so no client name goes in the stem and the
  // frame number alone keeps two frames apart.
  assert.match(first.files[0], new RegExp(`^agent-runs/see/${level}-sketch-\\d+\\.png$`))
  assert.notEqual(first.files[0], second.files[0])
  assert.ok(fs.existsSync(first.png) && fs.existsSync(second.png), 'neither frame overwrote the other')
})
