/**
 * Kernel: the world cameras and the viewport they are built from.
 *
 * The world camera's numbers come from `cameraProjection` in
 * `camera-project.js`, the same reading the headless projector uses, so the two
 * cannot drift. `view` and `viewport` belong to the session; this module only
 * reads them.
 *
 * A plugin that draws the scene from another camera gives a view record of the
 * same shape and gets a camera from the same `cameraProjection` reading, so an
 * off-screen view cannot be built differently from the main one.
 */
import * as THREE from 'three/webgpu'
import { cameraProjection } from '../camera-project.js'

/** An orthographic world camera looking down -Z, at the world's clip planes. */
function makeOrthographicCamera() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  camera.position.z = 10
  return camera
}

/**
 * A perspective world camera.
 *
 * Near is 0.05 rather than something rounder because the eye sits 1.62 m up
 * and a wall it is pressed against must not clip away. Far is 400 m, which is
 * an order of magnitude past the longest sightline any map of this kind has.
 */
function makePerspectiveCamera() {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 400)
  // Yaw before pitch, or looking up while turned would roll the horizon.
  camera.rotation.order = 'YXZ'
  return camera
}

/**
 * Write one projection onto a Three camera.
 *
 * The one place `cameraProjection`'s numbers reach a camera, so the session
 * camera and a view a plugin draws off-screen are built identically.
 */
function applyProjection(camera, projection) {
  if (projection.mode === 'ortho') {
    const halfWidth = projection.width / 2 / projection.zoom
    const halfHeight = projection.height / 2 / projection.zoom
    camera.left = -halfWidth
    camera.right = halfWidth
    camera.top = halfHeight
    camera.bottom = -halfHeight
    camera.position.x = projection.x
    camera.position.y = projection.y
    camera.updateProjectionMatrix()
    return
  }
  camera.position.set(projection.x, projection.y, projection.z)
  // The order was set once at construction, so this is yaw about +Y and pitch
  // about +X in the order the view object promises.
  camera.rotation.set(projection.pitch, projection.yaw, 0)
  camera.fov = projection.fov
  camera.aspect = projection.aspect
  camera.updateProjectionMatrix()
}

export function makeCamera(state) {
  const orthographic = makeOrthographicCamera()
  const perspective = makePerspectiveCamera()
  // A second pair for a view a plugin draws off-screen. Kept, so a view drawn
  // every frame allocates nothing and the session camera is never touched.
  const viewOrthographic = makeOrthographicCamera()
  const viewPerspective = makePerspectiveCamera()

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
    applyProjection(activeCamera(), cameraProjection(state.view, state.viewport))
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

  /**
   * A camera for a view that is not the session's, ready to project through.
   *
   * The same `cameraProjection` reading the session camera is built from, so a
   * minimap or a reflection cannot disagree with the main view. `viewport` is
   * the target's pixel size, so the view's aspect matches what it is drawn into.
   */
  function viewCamera(view, viewport) {
    const projection = cameraProjection(view, viewport)
    const camera = projection.mode === 'ortho' ? viewOrthographic : viewPerspective
    applyProjection(camera, projection)
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
  state.viewCamera = viewCamera
  state.toNDC = toNDC
  state.resize = resize
  state.frameSize = frameSize
  state.setPixelRatio = setPixelRatio
}
