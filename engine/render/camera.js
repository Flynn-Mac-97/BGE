/**
 * Kernel: the two world cameras, the second one for the viewmodel, and the
 * viewport they are built from.
 *
 * `view` and `viewport` belong to the session; this module only reads them.
 */
import * as THREE from 'three/webgpu'

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

  /** Whether the session's view is the flat orthographic one. */
  const flat = () => state.view.mode === 'ortho'
  /** The camera the current view mode draws through. */
  const activeCamera = () => (flat() ? orthographic : perspective)

  /** Rebuild the active camera from the view and viewport: ortho, or perspective. */
  function updateCamera() {
    if (flat()) {
      const hw = state.viewport.width / 2 / state.view.zoom
      const hh = state.viewport.height / 2 / state.view.zoom
      orthographic.left = -hw; orthographic.right = hw
      orthographic.top = hh;   orthographic.bottom = -hh
      orthographic.position.x = state.view.x
      orthographic.position.y = state.view.y
      orthographic.updateProjectionMatrix()
      return
    }
    perspective.position.set(state.view.x, state.view.y, state.view.z || 0)
    // The order was set once at construction, so this is yaw about +Y and pitch
    // about +X in the order the view object promises.
    perspective.rotation.set(state.view.pitch || 0, state.view.yaw || 0, 0)
    perspective.fov = state.view.fov || 90
    perspective.aspect = state.viewport.width / Math.max(1, state.viewport.height)
    perspective.updateProjectionMatrix()

    state.viewmodelCamera.aspect = perspective.aspect
    state.viewmodelCamera.updateProjectionMatrix()
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
  const toNDC = (px, py) => new THREE.Vector2(
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
}
