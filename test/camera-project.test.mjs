/**
 * The headless projector and the renderer's Three camera must agree.
 *
 * `camera-project.js` answers where a world point lands on screen with no
 * renderer; `render/camera.js` builds the camera the frame is drawn through.
 * Both derive from one `cameraProjection`, and this drives both from the same
 * `view` and `viewport` and compares the numbers, so a change to the projection
 * that only one side follows fails here instead of drifting in silence.
 *
 * The last two views declare no zoom and no yaw, pitch or fov, so the defaults
 * are compared, not just two views that happen to agree.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'

import { makeProjector } from '../engine/camera-project.js'
import { makeCamera } from '../engine/render/camera.js'

const VIEWPORT = { width: 1280, height: 720 }

const VIEWS = [
  { mode: 'ortho', x: 3, y: -2, z: 0, zoom: 32 },
  { mode: 'ortho', x: -7, y: 4, z: 0, zoom: 48 },
  { mode: 'perspective', x: 0.6, y: 0.8, z: 21, yaw: 0.05, pitch: -0.04, fov: 58 },
  { mode: 'perspective', x: -4, y: 2.5, z: 18, yaw: -1.1, pitch: 0.42, fov: 47 },
  { mode: 'ortho', x: 0, y: 0, z: 0 },
  { mode: 'perspective', x: 0, y: 2, z: 20 }
]

const POINTS = [[0, 0, 0], [2, 3, -1], [-3.5, 1.25, 2], [1.5, -0.5, 4], [8, -6, 0]]

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

test('makeProjector and the Three camera agree on the same view and viewport', () => {
  for (const view of VIEWS) {
    const projector = makeProjector(view, VIEWPORT)
    const camera = cameraStateFor(view).readyCamera()
    let checked = 0

    for (const [worldX, worldY, worldZ] of POINTS) {
      const projected = projector.place(worldX, worldY, worldZ)
      if (!projected.inFront) continue
      checked++

      const ndc = new THREE.Vector3(worldX, worldY, worldZ).project(camera)
      const screenX = (ndc.x + 1) / 2 * 100
      const screenY = (1 - ndc.y) / 2 * 100

      assert.ok(Math.abs(screenX - projected.x) < 1e-9,
        `${view.mode} x: projector ${projected.x}, three ${screenX}`)
      assert.ok(Math.abs(screenY - projected.y) < 1e-9,
        `${view.mode} y: projector ${projected.y}, three ${screenY}`)
    }

    assert.ok(checked > 0, `${view.mode} view had no point in front of the eye`)
  }
})
