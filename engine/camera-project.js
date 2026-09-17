/**
 * Kernel: world position to screen position, from view state alone.
 *
 * The renderer derives its camera from `view` and `viewport` in
 * `updateCamera()` (render.js); this module derives the same projection with
 * no renderer, so a headless world can answer "where does this land on
 * screen". The two read the same numbers the same way — perspective is a
 * vertical `fov` through a YXZ yaw-then-pitch rotation, orthographic is
 * `zoom` pixels per world unit centred on `view.x/y`. Change one and change
 * the other.
 *
 * Screen positions are percentages, 0-100, x rightward and y downward, so an
 * answer is independent of the viewport's pixel size.
 */

/** Degrees the renderer defaults to when a view declares no field of view. */
const DEFAULT_FOV = 90

/**
 * The projection for one view and viewport: `place` puts a world point on
 * screen and `sizeAt` gives a world size on screen at a depth.
 *
 * A factory because the camera plugin moves the view between frames, and every
 * answer must read the view as it is when asked.
 */
export function makeProjector(view, viewport) {
  const width = Math.max(1, viewport.width)
  const height = Math.max(1, viewport.height)

  if (view.mode === 'ortho') {
    const zoom = view.zoom || 48
    return {
      mode: 'ortho',
      /** World point to screen percent. Everything is in front of an orthographic camera. */
      place(x, y) {
        return {
          x: (((x - view.x) * zoom + width / 2) / width) * 100,
          y: (((view.y - y) * zoom + height / 2) / height) * 100,
          depth: 0,
          inFront: true
        }
      },
      /** Screen percent size of a thing `w` by `h` world units, at any depth. */
      sizeAt(depth, w, h) {
        return { w: (w * zoom / width) * 100, h: (h * zoom / height) * 100 }
      }
    }
  }

  const yaw = view.yaw || 0
  const pitch = view.pitch || 0
  const fov = (view.fov || DEFAULT_FOV) * Math.PI / 180
  const focal = 1 / Math.tan(fov / 2)
  const aspect = width / height
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch)

  /** World point into camera space: translate to the eye, undo yaw, undo pitch. */
  function toCamera(x, y, z) {
    const dx = x - view.x
    const dy = y - view.y
    const dz = z - (view.z || 0)
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
    place(x, y, z = 0) {
      const cam = toCamera(x, y, z)
      const inFront = cam.z < -0.001
      const away = inFront ? -cam.z : 0.001
      return {
        x: ((cam.x * focal / aspect / away) + 1) / 2 * 100,
        y: (1 - (cam.y * focal / away)) / 2 * 100,
        depth: away,
        inFront
      }
    },
    sizeAt(depth, w, h) {
      const away = Math.max(0.001, depth)
      return {
        w: (w * focal / aspect / away) / 2 * 100,
        h: (h * focal / away) / 2 * 100
      }
    }
  }
}
