/**
 * Kernel: world position to screen position, from view state alone.
 *
 * The renderer builds its Three camera from `view` and `viewport` in
 * `render/camera.js`; this module derives the same projection with no renderer,
 * so a headless world can answer "where does this land on screen". Both read
 * `cameraProjection` below, the one reading of the numbers, so the two cannot
 * drift apart.
 *
 * Screen positions are percentages, 0-100, x rightward and y downward, so an
 * answer is independent of the viewport's pixel size.
 */

/** Degrees the renderer defaults to when a view declares no field of view. */
const DEFAULT_FOV = 90

/** Pixels per world unit the orthographic camera uses when a view declares no zoom. */
const DEFAULT_ZOOM = 48

/**
 * The projection for one view and viewport, with every default resolved.
 *
 * This is the one reading of `view` and `viewport` that both the headless
 * projector and the Three camera are built from. Perspective is a vertical
 * `fov` in degrees through a YXZ yaw-then-pitch rotation; orthographic is
 * `zoom` pixels per world unit centred on the eye. `x`/`y`/`z` are the eye.
 */
export function cameraProjection(view, viewport) {
  const width = Math.max(1, viewport.width)
  const height = Math.max(1, viewport.height)

  if (view.mode === 'ortho') {
    return {
      mode: 'ortho',
      x: view.x,
      y: view.y,
      zoom: view.zoom || DEFAULT_ZOOM,
      width,
      height
    }
  }

  const fov = view.fov || DEFAULT_FOV
  return {
    mode: 'perspective',
    x: view.x,
    y: view.y,
    z: view.z || 0,
    yaw: view.yaw || 0,
    pitch: view.pitch || 0,
    fov,
    aspect: width / height,
    focal: 1 / Math.tan((fov * Math.PI) / 180 / 2)
  }
}

/**
 * The projection for one view and viewport: `place` puts a world point on
 * screen and `sizeAt` gives a world size on screen at a depth.
 *
 * A factory because the camera plugin calls it again after it moves the view,
 * so every answer is built from the view as it was when the factory was called.
 */
export function makeProjector(view, viewport) {
  const projection = cameraProjection(view, viewport)

  if (projection.mode === 'ortho') {
    const { x, y, zoom, width, height } = projection
    return {
      mode: 'ortho',
      /** World point to screen percent. Everything is in front of an orthographic camera. */
      place(worldX, worldY) {
        return {
          x: (((worldX - x) * zoom + width / 2) / width) * 100,
          y: (((y - worldY) * zoom + height / 2) / height) * 100,
          depth: 0,
          inFront: true
        }
      },
      /** Screen percent size of a thing `w` by `h` world units, at any depth. */
      sizeAt(depth, w, h) {
        return { w: ((w * zoom) / width) * 100, h: ((h * zoom) / height) * 100 }
      }
    }
  }

  const { x, y, z, yaw, pitch, focal, aspect } = projection
  const cosYaw = Math.cos(yaw),
    sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch),
    sinPitch = Math.sin(pitch)

  /** World point into camera space: translate to the eye, undo yaw, undo pitch. */
  function toCamera(worldX, worldY, worldZ) {
    const dx = worldX - x
    const dy = worldY - y
    const dz = worldZ - z
    const rx = cosYaw * dx - sinYaw * dz
    const rz = sinYaw * dx + cosYaw * dz
    return {
      x: rx,
      y: cosPitch * dy + sinPitch * rz,
      z: cosPitch * rz - sinPitch * dy
    }
  }

  return {
    mode: 'perspective',
    place(worldX, worldY, worldZ = 0) {
      const cam = toCamera(worldX, worldY, worldZ)
      const inFront = cam.z < -0.001
      const away = inFront ? -cam.z : 0.001
      return {
        x: (((cam.x * focal) / aspect / away + 1) / 2) * 100,
        y: ((1 - (cam.y * focal) / away) / 2) * 100,
        depth: away,
        inFront
      }
    },
    sizeAt(depth, w, h) {
      const away = Math.max(0.001, depth)
      return {
        w: ((w * focal) / aspect / away / 2) * 100,
        h: ((h * focal) / away / 2) * 100
      }
    }
  }
}
