/**
 * Kernel: the two world cameras and the viewport they are built from.
 *
 * The world camera's numbers come from `cameraProjection` in
 * `camera-project.js`, the same reading the headless projector uses, so the two
 * cannot drift. `view` and `viewport` belong to the session; this module only
 * reads them.
 */
import * as THREE from 'three/webgpu'
import { cameraProjection } from '../camera-project.js'

export function makeCamera(state) {
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  orthographic.position.z = 10

  // Near is 0.05 rather than something rounder because the eye sits 1.62 m up
  // and a wall it is pressed against must not clip away. Far is 400 m, which is
  // an order of magnitude past the longest sightline any map of this kind has.
  const perspective = new THREE.PerspectiveCamera(90, 1, 0.05, 400)
  // Yaw before pitch, or looking up while turned would roll the horizon.
  perspective.rotation.order = 'YXZ'

  /** Take the canvas's own size as the viewport and rebuild the camera for it. */
  function resize() {
    const r = state.canvas.getBoundingClientRect()
    state.viewport.width = Math.max(1, r.width)
    state.viewport.height = Math.max(1, r.height)
    state.renderer.setSize(state.viewport.width, state.viewport.height, false)
    updateCamera()
  }

  /**
   * Draw at a stated size instead of the window's.
   *
   * A game is designed for a screen shape, and the shape of the window an
   * agent happens to have is not it. `resize()` puts the window's own size
   * back.
   */
  function frameSize(width, height) {
    state.viewport.width = Math.max(1, Math.round(width))
    state.viewport.height = Math.max(1, Math.round(height))
    state.renderer.setSize(state.viewport.width, state.viewport.height, false)
    updateCamera()
  }

  /**
   * Take a new device pixel ratio.
   *
   * The drawing buffer, the camera built against it and the renderer's pooled
   * targets all follow; the CSS viewport keeps its size, so input and
   * world-to-screen mapping stay put. A window moved to a display with a
   * different ratio does not always fire a resize, so this is called on its own.
   */
  function setPixelRatio(ratio) {
    // Matches the cap at init: above two, the buffer costs memory and bandwidth
    // for pixels no screen shows.
    const wanted = Math.min(Math.max(1, Number(ratio) || 1), 2)
    if (wanted === state.pixelRatio) return
    state.pixelRatio = wanted
    state.renderer.setPixelRatio(wanted)
    state.renderer.setSize(state.viewport.width, state.viewport.height, false)
    updateCamera()
    state.graph?.setPixelRatio?.(wanted)
  }

  /** Whether the session's view is the flat orthographic one. */
  const flat = () => state.view.mode === 'ortho'
  /** The camera the current view mode draws through. */
  const activeCamera = () => (flat() ? orthographic : perspective)

  /** Rebuild the active camera from the view and viewport: ortho, or perspective. */
  function updateCamera() {
    const projection = cameraProjection(state.view, state.viewport)
    if (projection.mode === 'ortho') {
      const halfWidth = projection.width / 2 / projection.zoom
      const halfHeight = projection.height / 2 / projection.zoom
      orthographic.left = -halfWidth
      orthographic.right = halfWidth
      orthographic.top = halfHeight
      orthographic.bottom = -halfHeight
      orthographic.position.x = projection.x
      orthographic.position.y = projection.y
      orthographic.updateProjectionMatrix()
      return
    }
    perspective.position.set(projection.x, projection.y, projection.z)
    // The order was set once at construction, so this is yaw about +Y and pitch
    // about +X in the order the view object promises.
    perspective.rotation.set(projection.pitch, projection.yaw, 0)
    perspective.fov = projection.fov
    perspective.aspect = projection.aspect
    perspective.updateProjectionMatrix()
  }

  /**
   * The camera, ready to be projected through outside of a draw.
   *
   * `render()` refreshes the world matrices as a side effect, so anything asking
   * where a point lands on screen between two frames would otherwise read the
   * matrices from the frame before the camera moved.
   */
  function readyCamera() {
    updateCamera()
    const camera = activeCamera()
    // A camera's updateMatrixWorld also refreshes matrixWorldInverse, which is
    // the half project() and the raycaster actually read.
    camera.updateMatrixWorld()
    return camera
  }

  /** A pixel in the viewport as normalized device coordinates, y upward. */
  const toNDC = (px, py) =>
    new THREE.Vector2(
      (px / Math.max(1, state.viewport.width)) * 2 - 1,
      1 - (py / Math.max(1, state.viewport.height)) * 2
    )

  state.flat = flat
  state.activeCamera = activeCamera
  state.updateCamera = updateCamera
  state.readyCamera = readyCamera
  state.toNDC = toNDC
  state.resize = resize
  state.frameSize = frameSize
  state.setPixelRatio = setPixelRatio
}
