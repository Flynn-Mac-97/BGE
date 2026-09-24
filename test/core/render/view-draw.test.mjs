/**
 * Drawing the entity scene from a view that is not the session camera.
 *
 * A pass declares a kernel target and draws the scene into it from a view
 * record. These tests drive the real pass graph and a recording device: the
 * device must be handed the second view's projection and not the session
 * camera's, the world must be walked once for both draws, and the view's pooled
 * target must follow a resize, come back after a device restore and be released
 * when its pass goes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { makeRenderer } from '../../../engine/render.js'
import { makeCamera } from '../../../engine/render/camera.js'

const SESSION_VIEW = { mode: 'perspective', x: 0, y: 1, z: 8, yaw: 0, pitch: 0, fov: 90 }
const SECOND_VIEW = { mode: 'perspective', x: -4, y: 2.5, z: 18, yaw: -1.1, pitch: 0.42, fov: 47 }
const VIEWPORT = { width: 320, height: 180 }

const box = id => ({ id, type: 'wall', x: 0, y: 0, z: -5, mesh: { box: [1, 1, 1] } })

/** A card that records every draw and the target it was bound to. */
function recordingDevice() {
  const device = {
    draws: [],
    onDeviceLost: null,
    onError: null,
    currentTarget: null,
    autoClear: false,
    shadowMap: { enabled: false, type: 0 },
    backend: null,
    hasFeature: () => false,
    // eslint-disable-next-line id-denylist -- three names this renderer field info.
    info: { autoReset: false, reset() {}, render: {}, memory: {}, programs: [] },
    setSize() {},
    setPixelRatio() {},
    getMaxAnisotropy: () => 1,
    setRenderTarget(target) {
      device.currentTarget = target
    },
    getRenderTarget: () => device.currentTarget,
    render(scene, camera) {
      device.draws.push({
        target: device.currentTarget,
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        projection: [...camera.projectionMatrix.elements]
      })
    },
    clear() {},
    clearDepth() {},
    setClearColor() {},
    getClearColor: color => color,
    getClearAlpha: () => 0,
    dispose() {}
  }
  return device
}

/** The camera the kernel's own construction path builds for one view and viewport. */
function expectedReadings(view, viewport) {
  const state = {
    view,
    viewport: { ...viewport },
    viewmodelCamera: new THREE.PerspectiveCamera(54, 1, 0.01, 20),
    canvas: { getBoundingClientRect: () => ({ ...viewport }) },
    renderer: { setSize() {} }
  }
  makeCamera(state)
  const camera = state.readyCamera()
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    projection: [...camera.projectionMatrix.elements]
  }
}

/**
 * A renderer with one pass that draws the scene from a second view into a
 * pooled target. `after: ['scene']` keeps the session draw first; `always`
 * keeps a target nothing reads from being dropped as dead.
 */
async function viewRenderer(device, view = SECOND_VIEW) {
  const renderer = await makeRenderer(null, SESSION_VIEW, VIEWPORT, { device })
  renderer.graph.add({
    name: 'minimap',
    after: ['scene'],
    always: true,
    writes: ['minimap'],
    target: {},
    execute: (frame, targets) => renderer.drawView(view, targets.get('minimap'))
  })
  return renderer
}

test('the view draw hands the device the second view projection, not the session camera', async () => {
  const device = recordingDevice()
  const renderer = await viewRenderer(device)
  renderer.draw({ entities: [box('a'), box('b')] })

  assert.equal(device.draws.length, 2, 'one session draw and one view draw, in graph order')
  const session = device.draws[0]
  const view = device.draws[1]

  const expected = expectedReadings(SECOND_VIEW, VIEWPORT)
  assert.deepEqual(view.projection, expected.projection, 'the device was handed the kernel-built second view')
  assert.deepEqual(view.position, expected.position, 'the second view camera is where the record put it')
  assert.notDeepEqual(view.projection, session.projection, 'the view draw is not the session camera projection')
  assert.equal(view.target, renderer.graph.targets.get('minimap'), 'the view drew into the declared pooled target')
})

test('the world is walked once for the session draw and the view draw', async () => {
  const device = recordingDevice()
  const renderer = await viewRenderer(device)
  let walks = 0
  // A mark's `begin` runs once per entity-sync walk, so it counts walks.
  renderer.marks.register('walkProbe', {
    draw() {},
    begin() {
      walks++
    }
  })

  renderer.draw({ entities: [box('a'), box('b')] })

  assert.equal(device.draws.length, 2, 'both draws happened')
  assert.equal(walks, 1, 'the world was walked once, not once per draw')
})

test('the view target follows a resize and comes back after a device restore', async () => {
  const device = recordingDevice()
  const renderer = await viewRenderer(device)
  const world = { entities: [box('a')] }

  renderer.draw(world)
  const first = renderer.graph.targets.get('minimap')
  assert.ok(first, 'the pass was given a pooled target')
  assert.equal(first.width, 320, 'the target started at the viewport width')

  renderer.frameSize(640, 360)
  renderer.draw(world)
  assert.equal(renderer.graph.targets.get('minimap'), first, 'the resize kept the same pooled target')
  assert.equal(first.width, 640, 'and sized it in place')

  renderer.deviceLost({})
  renderer.deviceRestored()
  renderer.draw(world)
  const rebuilt = renderer.graph.targets.get('minimap')
  assert.ok(rebuilt, 'the view target came back after the restore')
  assert.notEqual(rebuilt, first, 'the old target died with the device')
  assert.equal(rebuilt.width, 640, 'the rebuilt target keeps the size')
})

test('the view target is released when its pass is removed', async () => {
  const device = recordingDevice()
  const renderer = await viewRenderer(device)
  renderer.draw({ entities: [box('a')] })
  assert.equal(renderer.graph.pool.created, 1, 'the view target is pooled while the pass declares it')

  renderer.graph.remove('minimap')
  renderer.draw({ entities: [box('a')] })
  assert.equal(renderer.graph.targets.get('minimap'), null, 'the undeclared view target is released')
  assert.equal(renderer.graph.pool.created, 0, 'and disposed from the pool')
})
