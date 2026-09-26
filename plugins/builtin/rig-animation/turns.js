/**
 * Rig Animation: turns and points as plain arrays, for the pose solvers.
 *
 * A turn is a unit quaternion `[x, y, z, w]`; a point is `[x, y, z]`. Every
 * function answers a new array and changes none it is given.
 */

/** The turn `first` then `second` applied inside it: `first * second`. */
export const multiply = (first, second) => [
  first[3] * second[0] + first[0] * second[3] + first[1] * second[2] - first[2] * second[1],
  first[3] * second[1] - first[0] * second[2] + first[1] * second[3] + first[2] * second[0],
  first[3] * second[2] + first[0] * second[1] - first[1] * second[0] + first[2] * second[3],
  first[3] * second[3] - first[0] * second[0] - first[1] * second[1] - first[2] * second[2]
]

/** The turn that undoes a unit turn. */
export const inverse = turn => [-turn[0], -turn[1], -turn[2], turn[3]]

/** A point turned by a unit turn. */
export function rotate(turn, point) {
  const moved = multiply(multiply(turn, [point[0], point[1], point[2], 0]), inverse(turn))
  return [moved[0], moved[1], moved[2]]
}

/** The turn of Euler angles in radians, applied yaw, then pitch, then roll: the renderer's YXZ. */
export function fromYawPitchRoll(x, y, z) {
  const half = angle => [Math.sin(angle / 2), Math.cos(angle / 2)]
  const [sinX, cosX] = half(x)
  const [sinY, cosY] = half(y)
  const [sinZ, cosZ] = half(z)
  return multiply(multiply([0, sinY, 0, cosY], [sinX, 0, 0, cosX]), [0, 0, sinZ, cosZ])
}

/** The sum of two points. */
export const add = (first, second) => [first[0] + second[0], first[1] + second[1], first[2] + second[2]]

/** The point from `second` to `first`. */
export const subtract = (first, second) => [first[0] - second[0], first[1] - second[1], first[2] - second[2]]

/** A point times a number. */
export const scaled = (point, factor) => [point[0] * factor, point[1] * factor, point[2] * factor]

/** The dot product of two points. */
export const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2]

/** How long a point is from the origin. */
export const lengthOf = point => Math.hypot(point[0], point[1], point[2])

/** A point of length 1 the same way, or the zero point unchanged. */
export const unit = point => scaled(point, 1 / (lengthOf(point) || 1))

/** The shortest turn that lays direction `from` along direction `onto`. */
export function turnBetween(from, onto) {
  const start = unit(from)
  const end = unit(onto)
  const cosine = dot(start, end)
  if (cosine < -0.999999) {
    // Opposite: any axis at right angles to `start` is a half turn.
    const axis = Math.abs(start[0]) < 0.9 ? [0, -start[2], start[1]] : [-start[2], 0, start[0]]
    return [...unit(axis), 0]
  }
  const cross = [
    start[1] * end[2] - start[2] * end[1],
    start[2] * end[0] - start[0] * end[2],
    start[0] * end[1] - start[1] * end[0]
  ]
  const turn = [...cross, 1 + cosine]
  const size = Math.hypot(...turn)
  return turn.map(value => value / size)
}

/**
 * The turn `amount` of the way from `from` to `onto`, normalised. Straight
 * interpolation along the shorter way round: a solver's turns are small enough
 * that it differs from slerp by less than a clip's rounding.
 */
export function blendTurns(from, onto, amount) {
  const sign = from[0] * onto[0] + from[1] * onto[1] + from[2] * onto[2] + from[3] * onto[3] < 0 ? -1 : 1
  const mixed = from.map((value, axis) => value + (onto[axis] * sign - value) * amount)
  const size = Math.hypot(...mixed) || 1
  return mixed.map(value => value / size)
}
