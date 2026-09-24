/**
 * Device loss is a handled kernel case, not a blank canvas.
 *
 * A GPU reset or a lost WebGL context takes every texture the kernel held. This
 * drives the kernel's own seams — the `onDeviceLost` callback three's backends
 * call, the canvas events a browser fires, and the `deviceRestored` report — and
 * asserts: while the device is gone frames are skipped and nothing throws; a
 * restore rebuilds every pooled target, tells plugins through `device:restored`,
 * and draws again with the same result as before the loss.
 *
 * The stub device stands in for the card, so the loss runs through the exact
 * callback three calls rather than a copy of the logic. The pooled targets and
 * the frame are the real ones.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'
import { makeBus } from '../../../engine/bus.js'
import { makeLog } from '../../../engine/inspect.js'
import { clearReported } from '../../../engine/render/report.js'
import { captureConsoleError } from './report-capture.mjs'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }
const noop = () => {}

const world = () => ({
  entities: [
    { id: 'a', type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } },
    { id: 'b', type: 'wall', x: 2, y: 0, z: -5, mesh: { box: [1, 1, 1] } }
  ]
})

/**
 * A card that records what it was asked to draw and can be lost and found.
 *
 * It answers the same fields `headlessRenderer` in `render.js` answers, so the
 * frame draw runs unchanged; the difference is that it keeps the draw records
 * and exposes the two callbacks three wires.
 */
function stubDevice() {
  const device = {
    draws: [],
    onDeviceLost: null,
    onError: null,
    autoClear: false,
    shadowMap: { enabled: false, type: 0 },
    backend: null,
    hasFeature: () => false,
    // eslint-disable-next-line id-denylist -- three names this renderer field info.
    info: { autoReset: false, reset() {}, render: {}, memory: {}, programs: [] },
    setSize() {},
    setPixelRatio() {},
    getMaxAnisotropy: () => 1,
    render(scene, camera) {
      device.draws.push({
        children: scene.children.length,
        projection: [...camera.projectionMatrix.elements]
      })
    },
    clear() {},
    clearDepth() {},
    setRenderTarget() {},
    getRenderTarget: () => null,
    setClearColor() {},
    getClearColor: color => color,
    getClearAlpha: () => 0,
    dispose() {}
  }
  return device
}

/** A canvas that fires the two WebGL context events a browser fires. */
function stubCanvas() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    fire(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event)
    }
  }
}

/**
 * A renderer with two passes that own pooled targets, so a rebuild is visible.
 *
 * The default graph declares no targets, so a pool that stays empty would prove
 * nothing about a rebuild.
 */
async function drawableRenderer(device, canvas, bus) {
  const frame = await makeRenderer(canvas, VIEW, VIEWPORT, { device, bus })
  frame.graph.add({ name: 'plate', writes: ['plate'], target: { format: 'half-float' }, execute: noop })
  frame.graph.add({ name: 'depth', writes: ['depth'], target: { format: 'unsigned-byte' }, execute: noop })
  frame.graph.add({ name: 'sample', reads: ['plate', 'depth'], execute: noop })
  return frame
}

test('a lost WebGL context skips frames and a restore rebuilds every pooled target', async () => {
  const device = stubDevice()
  const canvas = stubCanvas()
  const bus = makeBus()
  const log = makeLog(bus)
  const frame = await drawableRenderer(device, canvas, bus)

  let rebuildNotices = 0
  bus.on('device:restored', () => {
    rebuildNotices++
  })

  const game = world()
  frame.draw(game)
  const drewBefore = device.draws.length
  const cameraBefore = device.draws.at(-1).projection
  const childrenBefore = device.draws.at(-1).children
  const entitiesBefore = frame.stats.entities
  const resources = ['plate', 'depth']
  const targetsBefore = resources.map(name => frame.graph.targets.get(name))
  assert.equal(frame.deviceState, 'ready')
  assert.equal(drewBefore, 1, 'the frame reached the card')
  assert.equal(frame.graph.pool.created, 2, 'both declared targets were pooled')

  // The browser fires this on the canvas; three's own listener runs the same
  // transition afterwards.
  canvas.fire('webglcontextlost', { preventDefault() {} })
  assert.equal(frame.deviceState, 'lost')

  // While lost the frame is skipped: no draw reaches the dead card, nothing
  // throws, and the frame record does not move.
  for (let index = 0; index < 5; index++) frame.draw(game)
  assert.equal(device.draws.length, drewBefore, 'no draw reached the lost device')
  assert.equal(frame.stats.entities, entitiesBefore)

  canvas.fire('webglcontextrestored')
  assert.equal(frame.deviceState, 'ready')
  assert.equal(rebuildNotices, 1, 'the plugin rebuild notice fired once')

  // The rebuild happens on the first frame after the restore, from the same
  // descriptors: every pooled target is a new one.
  frame.draw(game)
  for (const [index, name] of resources.entries()) {
    assert.notEqual(frame.graph.targets.get(name), targetsBefore[index], `the pooled target ${name} was rebuilt`)
  }
  assert.equal(frame.graph.pool.created, 2, 'both targets are pooled again')
  assert.equal(device.draws.length, drewBefore + 1, 'a frame drew again')
  assert.deepEqual(device.draws.at(-1).projection, cameraBefore, 'the same camera as before the loss')
  assert.equal(device.draws.at(-1).children, childrenBefore, 'the same scene as before the loss')
  assert.equal(frame.stats.entities, entitiesBefore, 'the same world as before the loss')

  assert.equal(log.lines.filter(line => line.message.includes('device was lost')).length, 1)
  assert.equal(log.lines.filter(line => line.message.includes('device came back')).length, 1)
})

test('a lost WebGPU device reports once, and an uncaptured error is not a loss', async () => {
  const device = stubDevice()
  const bus = makeBus()
  const frame = await drawableRenderer(device, null, bus)

  let lossNotices = 0
  bus.on('device:lost', () => {
    lossNotices++
  })

  const game = world()
  frame.draw(game)
  const drewBefore = device.draws.length

  // three's WebGPU backend calls exactly this when the device's `lost` promise
  // settles. A second report while already lost does nothing.
  device.onDeviceLost({ api: 'WebGPU', message: 'device removed', reason: 'unknown' })
  device.onDeviceLost({ api: 'WebGPU', message: 'device removed again' })
  assert.equal(frame.deviceState, 'lost')
  assert.equal(lossNotices, 1, 'the loss is reported once')

  frame.draw(game)
  frame.draw(game)
  assert.equal(device.draws.length, drewBefore, 'no draw reached the lost device')

  // three's WebGPU backend calls this for `device.onuncapturederror`. It is
  // reported, and the device is still lost rather than newly ready.
  device.onError({ api: 'WebGPU', type: 'ValidationError', message: 'bad bind group' })
  assert.equal(frame.deviceState, 'lost')

  frame.deviceRestored()
  assert.equal(frame.deviceState, 'ready')
  frame.draw(game)
  assert.equal(device.draws.length, drewBefore + 1, 'a frame drew again')
})

test('an injected device is drawn on, so the shadow map is enabled and three stays out of clearing', async () => {
  const device = stubDevice()
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })
  assert.equal(frame.threeRenderer.shadowMap.enabled, true, 'a real device has shadows switched on')
  assert.equal(frame.threeRenderer.autoClear, false, 'the kernel clears the frame, not three')
  assert.equal(frame.threeRenderer.info.autoReset, false, 'the counters survive every pass')
})

test('the device lost flag three reads follows the loss and the restore', async () => {
  const device = stubDevice()
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })

  frame.deviceLost({})
  assert.equal(frame.threeRenderer._isDeviceLost, true, 'three is told the device is lost')

  frame.deviceRestored()
  assert.equal(frame.threeRenderer._isDeviceLost, false, 'and told again when it comes back')
})

test('a restore resizes the drawing buffer without touching the page', async () => {
  const device = stubDevice()
  const sizes = []
  device.setSize = (...args) => sizes.push(args)
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })

  frame.deviceLost({})
  frame.deviceRestored()

  assert.deepEqual(sizes.at(-1), [320, 180, false], 'the restore does not ask three to write the canvas style')
})

test('a WebGL context loss carries the browser status message', async () => {
  const device = stubDevice()
  const canvas = stubCanvas()
  const bus = makeBus()
  const losses = []
  bus.on('device:lost', loss => losses.push(loss))
  await makeRenderer(canvas, VIEW, VIEWPORT, { device, bus })

  canvas.fire('webglcontextlost', { preventDefault() {}, statusMessage: 'gpu hung' })

  assert.equal(losses.length, 1, 'the loss reached the bus')
  assert.equal(losses[0].message, 'gpu hung', 'the browser message is passed on, not replaced')
})

test('an uncaptured GPU error with no detail is reported with the default words', async () => {
  clearReported()
  const device = stubDevice()
  await makeRenderer(null, VIEW, VIEWPORT, { device })

  const said = captureConsoleError(() => device.onError({}))

  assert.ok(
    said.some(line => line.includes('uncaptured GPU error — no message')),
    `the report fills in every missing field, got ${JSON.stringify(said)}`
  )
})

test('the backend reports its own name and whether it is WebGPU', async () => {
  const webgpu = stubDevice()
  webgpu.backend = { constructor: { name: 'TestBackend' } }
  const webgpuFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: webgpu })
  assert.equal(webgpuFrame.backend.name, 'TestBackend', 'the backend names itself')
  assert.equal(webgpuFrame.backend.webgpu, true, 'a backend with no WebGL marker is WebGPU')

  const webgl = stubDevice()
  webgl.backend = { isWebGLBackend: true, constructor: { name: 'WebGLBackend' } }
  const webglFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: webgl })
  assert.equal(webglFrame.backend.webgpu, false, 'the WebGL fallback is not WebGPU')
})

test('a feature check that throws answers no', async () => {
  const device = stubDevice()
  device.hasFeature = () => {
    throw new Error('the device cannot answer')
  }
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })

  assert.equal(frame.backend.has('compute'), false, 'a feature the device cannot confirm is absent')
})
