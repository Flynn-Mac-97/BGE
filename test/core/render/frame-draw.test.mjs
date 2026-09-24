/**
 * `frame-draw`: the frame's counters, the card-time it reports, the barrier that
 * makes a wall-clock measurement include the card, and the readback a query uses.
 *
 * The device is injected, so the drawing half of the frame runs with no GPU: the
 * numbers the card reports, the wait a caller can ask for, and the pixels read
 * out of a target are all exercised through the renderer's own surface.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRenderer } from '../../../engine/render.js'

const VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const VIEWPORT = { width: 320, height: 180 }

/** A device with the fields the frame reads, recording what it was asked to do. */
function countingDevice() {
  const device = {
    reads: [],
    onDeviceLost: null,
    onError: null,
    autoClear: false,
    shadowMap: { enabled: false, type: 0 },
    backend: null,
    hasFeature: () => false,
    // eslint-disable-next-line id-denylist -- three names this renderer field info.
    info: {
      autoReset: false,
      reset() {},
      render: { drawCalls: 0, triangles: 0, timestamp: null },
      memory: { textures: 0, geometries: 0 },
      programs: []
    },
    setSize() {},
    setPixelRatio() {},
    getMaxAnisotropy: () => 1,
    render() {},
    renderAsync: async () => {},
    readRenderTargetPixelsAsync(target, x, y, width, height) {
      device.reads.push({ x, y, width, height })
      return new Uint8Array(width * height * 4)
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

test('the post stat says a pass named post draws the frame', async () => {
  const device = countingDevice()
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })
  frame.draw({ entities: [] })
  assert.equal(frame.stats.post, 'none', 'the kernel frame has no post pass')

  frame.graph.add({ name: 'post', after: ['scene'], before: ['ui'], execute: () => {} })
  frame.draw({ entities: [] })
  assert.equal(frame.stats.post, 'drawing', 'a post pass draws the frame')
})

test('the counters the card reports reach the frame stats', async () => {
  const device = countingDevice()
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })
  device.info.render.drawCalls = 12
  device.info.render.triangles = 340
  device.info.memory.textures = 5
  device.info.memory.geometries = 7
  device.info.programs = [{}, {}, {}]

  const startedAt = performance.now()
  frame.draw({ entities: [] })
  const elapsed = performance.now() - startedAt

  assert.equal(frame.stats.drawCalls, 12)
  assert.equal(frame.stats.triangles, 340)
  assert.equal(frame.stats.textures, 5)
  assert.equal(frame.stats.geometries, 7)
  assert.equal(frame.stats.programs, 3, 'a program list of three is three, not zero')
  assert.ok(frame.stats.cpuMs >= 0 && frame.stats.cpuMs <= elapsed, 'cpu time is the time the frame took')
})

test('the card time is read only from a backend that can timestamp it', async () => {
  const timed = countingDevice()
  timed.backend = { trackTimestamp: true }
  timed.resolveTimestampsAsync = async () => {}
  timed.info.render.timestamp = 7
  const timingFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: timed })
  assert.equal(await timingFrame.gpuTime(), 7, 'a timestamped backend answers its last frame time')
  timingFrame.draw({ entities: [] })
  assert.equal(timingFrame.stats.gpuMs, 7, 'the counters carry the same card time')

  const untimed = countingDevice()
  untimed.backend = {}
  untimed.resolveTimestampsAsync = async () => {}
  untimed.info.render.timestamp = 9
  const untimedFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: untimed })
  assert.equal(await untimedFrame.gpuTime(), null, 'a backend that cannot time itself answers nothing')
})

test('waitForGPU answers whether the card was drained, by feature and not by name', async () => {
  const queueDrained = countingDevice()
  queueDrained.backend = { device: { queue: { onSubmittedWorkDone: async () => {} } } }
  const queueFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: queueDrained })
  assert.equal(await queueFrame.waitForGPU(), true, 'a device queue that drains is a barrier')

  const glDevice = countingDevice()
  glDevice.backend = {
    gl: { finish() {}, readPixels() {}, RGBA: 1, UNSIGNED_BYTE: 2 }
  }
  const glFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: glDevice })
  assert.equal(await glFrame.waitForGPU(), true, 'a blocking pixel read is a barrier')

  const broken = countingDevice()
  broken.backend = {
    device: {
      queue: {
        onSubmittedWorkDone: async () => {
          throw new Error('the queue is gone')
        }
      }
    }
  }
  const brokenFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: broken })
  assert.equal(await brokenFrame.waitForGPU(), false, 'a barrier that throws is no barrier')

  const plain = countingDevice()
  plain.backend = {}
  const plainFrame = await makeRenderer(null, VIEW, VIEWPORT, { device: plain })
  assert.equal(await plainFrame.waitForGPU(), false, 'a device with no barrier cannot be waited on')
})

test('drawInto reads back the whole target when the caller names no region', async () => {
  const device = countingDevice()
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })
  const target = { width: 4, height: 2 }
  const buffer = new Uint8Array(4 * 2 * 4)

  await frame.drawInto(target, buffer)

  assert.deepEqual(device.reads, [{ x: 0, y: 0, width: 4, height: 2 }], 'with no region the whole target is read')
  assert.equal(buffer.length, 32, 'the bytes are copied into the caller buffer')
})

test('drawInto reads back only the region the caller names', async () => {
  const device = countingDevice()
  const frame = await makeRenderer(null, VIEW, VIEWPORT, { device })
  const target = { width: 8, height: 8 }
  const buffer = new Uint8Array(2 * 1 * 4)

  await frame.drawInto(target, buffer, { x: 3, y: 5, width: 2, height: 1 })

  assert.deepEqual(device.reads, [{ x: 3, y: 5, width: 2, height: 1 }])
})
