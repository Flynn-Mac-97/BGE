/**
 * One camera's projection, read from a few points of the projector and reused
 * for every entity.
 *
 * `projector.place` answers one world point per call, so a hull built from
 * eight corners costs eight calls for every entity. The engine's projector is
 * a pinhole: screen x and y are affine functions of the world point divided by
 * one shared affine depth. Four control points in front of the eye determine
 * those three affine functions, so every later corner is arithmetic instead of
 * another call. The fit reproduces `place` exactly for the camera it was read
 * from, up to floating point, and the same guard conditions are applied.
 *
 * The result has the projector's own shape — `mode` and `place` — so callers
 * cannot tell the two apart. A camera the controls cannot determine returns
 * null, and the caller keeps the projector it was handed.
 */

/** Solve the four-by-four system by Gauss–Jordan. Null when it is singular. */
function invert4(rows) {
  const work = rows.map(row => [row[0], row[1], row[2], row[3], 0, 0, 0, 0])
  for (let at = 0; at < 4; at++) work[at][4 + at] = 1
  for (let column = 0; column < 4; column++) {
    let pivot = column
    for (let row = column + 1; row < 4; row++) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row
    }
    if (Math.abs(work[pivot][column]) < 1e-9) return null
    const swap = work[column]
    work[column] = work[pivot]
    work[pivot] = swap
    const divisor = work[column][column]
    for (let at = column; at < 8; at++) work[column][at] /= divisor
    for (let row = 0; row < 4; row++) {
      if (row === column) continue
      const factor = work[row][column]
      if (factor === 0) continue
      for (let at = column; at < 8; at++) work[row][at] -= factor * work[column][at]
    }
  }
  return work.map(row => row.slice(4))
}

/** The coefficients of the affine function the inverse maps a value list to. */
function fit(inverse, values) {
  return [0, 1, 2, 3].map(at =>
    inverse[at][0] * values[0] + inverse[at][1] * values[1]
    + inverse[at][2] * values[2] + inverse[at][3] * values[3])
}

const affineAt = (coefficients, x, y, z) =>
  coefficients[0] + coefficients[1] * x + coefficients[2] * y + coefficients[3] * z

/**
 * Four world points in front of the eye that fix the camera's affine pieces.
 *
 * Perspective takes the centre of the entities as the focus distance so the
 * controls sit where the corners are, which keeps the fit conditioned. An
 * eye inside or past the scene clamps to one unit ahead, still in front.
 */
function controlPoints(mode, view, entities) {
  const eye = [view.x || 0, view.y || 0, view.z || 0]
  if (mode === 'ortho') {
    return [eye,
      [eye[0] + 1, eye[1], eye[2]],
      [eye[0], eye[1] + 1, eye[2]],
      [eye[0], eye[1], eye[2] + 1]]
  }
  const yaw = view.yaw || 0
  const pitch = view.pitch || 0
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch)
  const forward = [-sinYaw * cosPitch, sinPitch, -cosYaw * cosPitch]
  const right = [cosYaw, 0, -sinYaw]
  const up = [sinPitch * sinYaw, cosPitch, sinPitch * cosYaw]
  let focus = 10
  if (entities.length) {
    focus = 0
    for (const entity of entities) {
      focus += (entity.x - eye[0]) * forward[0]
        + (entity.y - eye[1]) * forward[1]
        + ((entity.z || 0) - eye[2]) * forward[2]
    }
    focus /= entities.length
  }
  const distance = Math.min(10000, Math.max(1, focus))
  const base = [
    eye[0] + forward[0] * distance,
    eye[1] + forward[1] * distance,
    eye[2] + forward[2] * distance
  ]
  return [base,
    [base[0] + right[0], base[1] + right[1], base[2] + right[2]],
    [base[0] + up[0], base[1] + up[1], base[2] + up[2]],
    [base[0] + forward[0], base[1] + forward[1], base[2] + forward[2]]]
}

/** The projector's screen map for one view, or null when it cannot be read. */
export function screenMap(projector, view, entities = []) {
  if (!projector || typeof projector.place !== 'function') return null
  if (!view || !Number.isFinite(view.x) || !Number.isFinite(view.y)) return null
  const mode = projector.mode === 'ortho' ? 'ortho' : projector.mode === 'perspective' ? 'perspective' : null
  if (!mode) return null
  const controls = controlPoints(mode, view, entities)
  if (controls.some(point => !point.every(Number.isFinite))) return null
  const inverse = invert4(controls.map(point => [1, point[0], point[1], point[2]]))
  if (!inverse) return null
  const placed = controls.map(point => projector.place(point[0], point[1], point[2]))
  if (placed.some(point => !point.inFront)) return null

  if (mode === 'ortho') {
    const screenX = fit(inverse, placed.map(point => point.x))
    const screenY = fit(inverse, placed.map(point => point.y))
    return {
      mode,
      place(x, y) {
        return { x: affineAt(screenX, x, y, 0), y: affineAt(screenY, x, y, 0), depth: 0, inFront: true }
      }
    }
  }

  // Screen x times depth and (50 - screen y) times depth are both affine in the
  // world point, and depth is affine on its own; the three fits recover them.
  const depth = fit(inverse, placed.map(point => point.depth))
  const screenX = fit(inverse, placed.map((point, at) => point.x * placed[at].depth))
  const screenY = fit(inverse, placed.map((point, at) => (50 - point.y) * placed[at].depth))
  return {
    mode,
    place(x, y, z = 0) {
      const away = affineAt(depth, x, y, z)
      return {
        x: affineAt(screenX, x, y, z) / away,
        y: 50 - affineAt(screenY, x, y, z) / away,
        depth: away,
        inFront: away > 0.001
      }
    }
  }
}
