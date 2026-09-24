/**
 * Rig Animation: reading one moment out of a clip — which two frames, how far
 * between, and blending one node's rotation. Shared by the base clip and a layer.
 */

/**
 * The two frames either side of a time in a clip, and how far between them.
 * A clip that plays once holds its last frame, and says it is done.
 */
export function framesAt(clip, seconds) {
  const position = seconds * clip.framesPerSecond
  const last = clip.count - 1
  const first = Math.floor(position)
  if (clip.loop) {
    const wrapped = ((first % clip.count) + clip.count) % clip.count
    return { first: wrapped, second: (wrapped + 1) % clip.count, blend: position - first, isDone: false }
  }
  if (first >= last) return { first: last, second: last, blend: 0, isDone: true }
  return { first, second: first + 1, blend: position - first, isDone: false }
}

/**
 * Blend two frames of one node into the pose, normalised.
 *
 * Straight interpolation, not slerp: neighbouring frames of a capture are a
 * fraction of a degree apart, where the two answers differ by less than the
 * rounding in the file. The sign flip is not optional — two quaternions that
 * name the same rotation with opposite signs interpolate the long way round.
 */
export function mixInto(into, a, b, at, blend) {
  const dot = a[at] * b[at] + a[at + 1] * b[at + 1] + a[at + 2] * b[at + 2] + a[at + 3] * b[at + 3]
  const sign = dot < 0 ? -1 : 1
  let length = 0
  for (let axis = 0; axis < 4; axis++) {
    const value = a[at + axis] + (b[at + axis] * sign - a[at + axis]) * blend
    into[axis] = value
    length += value * value
  }
  length = Math.sqrt(length) || 1
  for (let axis = 0; axis < 4; axis++) into[axis] /= length
}
