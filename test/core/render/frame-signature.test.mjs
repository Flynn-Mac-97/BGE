/**
 * The frame's observable output is a checked invariant.
 *
 * A change to kernel internals — the camera projection, the Three camera, the
 * frame plan, the renderer's sync — must leave the numbers the frame draws from
 * untouched. This test rebuilds the fixed headless frame the
 * `2026-09-23-one-camera-projection/frame-signature.mjs` probe builds and
 * asserts one digest over the serialized signature, so a kernel change that
 * moves the frame fails here instead of going unnoticed.
 *
 * The digest covers `JSON.stringify(signature, null, 1)` plus the newline
 * `console.log` appends: the probe prints the signature and the recorded digest
 * was taken from that stdout. The probe's file write has no trailing newline and
 * hashes to a different value, so the two are not the same bytes.
 *
 * Re-record only after an intended frame change: run
 * `node --test test/core/render/frame-signature.test.mjs`, read the new digest
 * from the failure message, and replace `FRAME_SIGNATURE_DIGEST` with it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as THREE from 'three/webgpu'
import { makeProjector } from '../../../engine/camera-project.js'
import { makeCamera } from '../../../engine/render/camera.js'
import { planFrame } from '../../../engine/frame-plan.js'
import { makeRenderer } from '../../../engine/render.js'

const VIEWPORT = { width: 1280, height: 720 }

const VIEWS = [
  { mode: 'ortho', x: 3, y: -2, z: 0, zoom: 32 },
  { mode: 'ortho', x: -7, y: 4, z: 0, zoom: 48 },
  { mode: 'perspective', x: 0.6, y: 0.8, z: 21, yaw: 0.05, pitch: -0.04, fov: 58 },
  { mode: 'perspective', x: -4, y: 2.5, z: 18, yaw: -1.1, pitch: 0.42, fov: 47 }
]

const POINTS = [
  [0, 0, 0],
  [2, 3, -1],
  [-3.5, 1.25, 2],
  [1.5, -0.5, 4],
  [8, -6, 0]
]

const FRAME_SIGNATURE_DIGEST = '33926230a67eb5ebd70ea233ff4a60747ca50160520f5dc97b35882391cdef96'

/** A camera owner with just the fields `makeCamera` reads. */
function cameraStateFor(view) {
  const state = {
    view,
    viewport: { ...VIEWPORT },
    viewmodelCamera: new THREE.PerspectiveCamera(54, 1, 0.01, 20),
    canvas: { getBoundingClientRect: () => ({ ...VIEWPORT }) },
    renderer: { setSize() {} }
  }
  makeCamera(state)
  return state
}

/** Every projection number the projector and the Three camera produce for one view. */
function cameraReadingFor(view) {
  const projector = makeProjector(view, VIEWPORT)
  const camera = cameraStateFor(view).readyCamera()
  return {
    view,
    projector: {
      mode: projector.mode,
      place: POINTS.map(point => projector.place(point[0], point[1], point[2])),
      sizeAt: POINTS.map(point => projector.sizeAt(point[2], 2, 3))
    },
    camera: {
      type: camera.type,
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
      order: camera.rotation.order,
      fov: camera.fov ?? null,
      aspect: camera.aspect ?? null,
      bounds: camera.isOrthographicCamera
        ? { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom }
        : null,
      projectionMatrix: [...camera.projectionMatrix.elements],
      matrixWorld: [...camera.matrixWorld.elements]
    }
  }
}

const frameWorld = {
  entities: Array.from({ length: 8 }, (_, index) => ({
    id: `e${index}`,
    type: 'wall',
    x: index,
    y: 0,
    z: 0,
    mesh: { box: [1, 1, 1] }
  }))
}

const HEADLESS_VIEW = { mode: 'ortho', x: 0, y: 0, z: 0, zoom: 1 }
const HEADLESS_VIEWPORT = { width: 320, height: 180 }

/** The probe's signature, built with no file, no network and no browser. */
async function frameSignature() {
  const cameras = VIEWS.map(cameraReadingFor)
  const frame = await makeRenderer(null, HEADLESS_VIEW, HEADLESS_VIEWPORT)
  frame.sync(frameWorld)
  const firstSync = { entities: frame.stats.entities, merged: frame.stats.merged, batches: frame.stats.batches }
  for (let index = 0; index < 45; index++) frame.sync(frameWorld)
  const settled = { entities: frame.stats.entities, merged: frame.stats.merged, batches: frame.stats.batches }
  return JSON.stringify({ cameras, framePlan: planFrame(frameWorld), firstSync, settled }, null, 1)
}

test('the headless frame keeps its recorded signature', async () => {
  const signature = await frameSignature()
  const digest = createHash('sha256')
    .update(signature + '\n')
    .digest('hex')
  assert.equal(
    digest,
    FRAME_SIGNATURE_DIGEST,
    `the frame's observable output moved. If that was intended, re-record FRAME_SIGNATURE_DIGEST as ${digest}.`
  )
})
