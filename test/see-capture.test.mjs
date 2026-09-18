import test from 'node:test'
import assert from 'node:assert/strict'
import see from '../plugins/builtin/see.js'
import { nullRenderer } from '../engine/start-world-node.mjs'
import { encodePng } from '../tools/lib/texture.mjs'
import { studioBounds, studioSilhouette, cropPixels, encodeColours, measureLight } from '../plugins/builtin/see/capture-pixels.js'

const capture = see.commands.find(command => command.id === 'see.capture').run

// Canvas pixels are supplied by the test, not a GPU. Drawing calls are recorded.
function canvasForTest(width, height, calls) {
  let pixels
  const canvas = { width, height }
  const data = () => pixels || new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255)
  const pen = {
    drawImage() { calls.push('image') },
    fillRect() { calls.push('rectangle') },
    fillText() { calls.push('text') },
    measureText: text => ({ width: text.length * 8 }),
    beginPath() {}, lineTo() {}, closePath() {},
    stroke() { calls.push('outline') },
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData(image) { pixels = image.data },
    getImageData: () => ({ data: data() })
  }
  canvas.getContext = () => pen
  canvas.toDataURL = () => 'data:image/png;base64,' + encodePng(canvas.width, canvas.height, Buffer.from(data())).toString('base64')
  return canvas
}

function captureContext() {
  const subject = { id: 'subject', type: 'box', x: 0, y: 0, z: 0, mesh: { box: [2, 2, 2] } }
  const other = { ...subject, id: 'other', x: 3 }
  const entities = [subject, other]
  const view = { mode: 'ortho', x: 0, y: 0, z: 10, yaw: 0, pitch: 0, zoom: 8, fov: 60 }
  const viewport = { width: 64, height: 64 }
  const renderer = nullRenderer(view, viewport, { ...viewport })
  const calls = []
  renderer.createCanvas = (width, height) => canvasForTest(width, height, calls)
  const context = {
    view, viewport, renderer,
    shell: { canvas: { get width() { return viewport.width }, get height() { return viewport.height } } },
    world: { entities, byId: id => entities.find(entity => entity.id === id), types: new Map([['box', { about: 'a box' }]]) },
    editor: { levelName: 'test', projectName: 'fixture' }
  }
  renderer.sync(context.world)
  renderer.scene.background = 'background'
  renderer.scene.fog = { density: 1 }
  renderer.scene.add({ isLight: true, visible: true })
  renderer.scene.add({ visible: true, userData: { overlay: true } })
  renderer.passes.set([{ name: 'grade' }])
  return { context, calls }
}

function sceneState(context) {
  return {
    view: { ...context.view }, viewport: { ...context.viewport },
    hidden: context.world.entities.map(entity => Boolean(entity.hidden)),
    background: context.renderer.scene.background, fog: context.renderer.scene.fog,
    children: context.renderer.scene.children.map(child => ({ child, visible: child.visible })),
    passes: context.renderer.passes.list
  }
}

test('capture keeps PNG, sidecar, mark bindings and requested dimensions in agreement', async () => {
  const { context, calls } = captureContext()
  const before = sceneState(context)
  const answer = await capture(context, { file: 'agent-runs/see/test.png', size: [32, 48], ui: false, marks: 'tags' })
  assert.equal(answer.__files.length, 2)
  const png = Buffer.from(answer.__files[0].base64, 'base64')
  assert.equal(png.readUInt32BE(16), 32)
  assert.equal(png.readUInt32BE(20), 48)
  const sidecar = JSON.parse(Buffer.from(answer.__files[1].base64, 'base64').toString())
  assert.deepEqual(answer.marks, sidecar.marks)
  assert.deepEqual(answer.profile, sidecar.profile)
  assert.equal(sidecar.light.mean, 100)
  assert.ok(calls.includes('text'))
  assert.deepEqual(sceneState(context), before)
})

test('studio capture uses measured alpha and omits drawn marks and authored descriptions', async () => {
  const { context, calls } = captureContext()
  const before = sceneState(context)
  let disposed = false
  context.renderer.drawInto = (target, raw) => {
    target.addEventListener('dispose', () => { disposed = true })
    for (let y = 28; y < 36; y++) for (let x = 28; x < 36; x++) {
      raw.set([64, 64, 64, 255], (y * target.width + x) * 4)
    }
  }
  const answer = await capture(context, { subject: 'subject', alone: true, name: 'studio-test', marks: 'tags' })
  const sidecar = JSON.parse(Buffer.from(answer.__files[1].base64, 'base64').toString())
  assert.equal(disposed, true)
  assert.equal(answer.profile.cropped, true)
  assert.deepEqual(answer.marks, {})
  assert.equal(sidecar.palette, undefined)
  assert.equal(sidecar.about, undefined)
  assert.equal(sidecar.visible[0].mark, undefined)
  assert.ok(sidecar.visible[0].silhouette.length >= 3)
  assert.equal(calls.includes('text') || calls.includes('outline'), false)
  assert.deepEqual(sceneState(context), before)
})

test('a failed studio readback disposes its target and restores every borrowed scene field', async () => {
  const { context } = captureContext()
  context.world.entities[1].hidden = true
  context.renderer.sync(context.world)
  const before = sceneState(context)
  let disposed = false
  context.renderer.drawInto = target => {
    target.addEventListener('dispose', () => { disposed = true })
    throw new Error('readback failed')
  }
  await assert.rejects(capture(context, { subject: 'subject', alone: true, size: [32, 48], ui: false }), /readback failed/)
  assert.equal(disposed, true)
  assert.deepEqual(sceneState(context), before)
})

test('pixel crop flips GPU rows and traces the outline in delivered-image coordinates', () => {
  const raw = new Uint8Array(4 * 4 * 4)
  raw.set([20, 30, 40, 255], (2 * 4 + 1) * 4)
  raw.set([50, 60, 70, 255], (1 * 4 + 2) * 4)
  const bounds = studioBounds(raw, { width: 4, height: 4 })
  assert.deepEqual([...bounds.spans], [[1, [1, 1]], [2, [2, 2]]])
  const crop = { x: 1, y: 1, w: 2, h: 2 }
  const image = { data: new Uint8ClampedArray(16) }
  cropPixels(raw, { width: 4, height: 4 }, crop, image)
  assert.deepEqual([...image.data.slice(0, 4)], [20, 30, 40, 255])
  assert.deepEqual([...image.data.slice(12)], [50, 60, 70, 255])
  assert.ok(studioSilhouette(bounds.spans, crop).every(point => point.every(value => value >= 0 && value <= 100)))
})

test('colour conversion keeps alpha and brightness excludes transparent samples', () => {
  const image = { data: new Uint8ClampedArray([0, 64, 255, 7]) }
  encodeColours(image)
  assert.deepEqual([...image.data], [0, 137, 255, 7])
  const pixels = new Uint8ClampedArray(4 * 4 * 4)
  pixels.set([255, 255, 255, 255])
  const light = measureLight(pixels, 4, 4)
  assert.equal(light.mean, 100)
  assert.equal(light.grid[0], 100)
  assert.ok(light.grid.slice(1).every(value => value === null))
  assert.equal(light.measuredFraction, 0.06)
})
