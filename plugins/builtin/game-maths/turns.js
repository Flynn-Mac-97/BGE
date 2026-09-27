/**
 * Game Maths: turns as plain arrays. A turn is a unit quaternion
 * `[x, y, z, w]`; a point is `[x, y, z]`. A rotation `[x, y, z]` is Euler
 * angles in radians, applied yaw (Y), then pitch (X), then roll (Z), as the
 * renderer turns a node and an attachment. Every function answers a new array
 * and changes none it is given.
 */
import { cross, dot, unit } from './vectors.js'

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

/** The turn of `angle` radians about one axis: 0 x, 1 y, 2 z. */
export function turnAbout(axis, angle) {
  const turn = [0, 0, 0, Math.cos(angle / 2)]
  turn[axis] = Math.sin(angle / 2)
  return turn
}

/** The turn of Euler angles in radians, applied yaw, then pitch, then roll: the renderer's YXZ. */
export const fromYawPitchRoll = (x, y, z) => multiply(multiply(turnAbout(1, y), turnAbout(0, x)), turnAbout(2, z))

/** A unit turn as a rotation `[x, y, z]`, the inverse of fromYawPitchRoll. Straight up or down, roll is 0. */
export function yawPitchRollOf([x, y, z, w]) {
  const m23 = 2 * (y * z - w * x)
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)))
  if (Math.abs(m23) > 0.9999999) return [pitch, Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z)), 0]
  const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y))
  return [pitch, yaw, Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z))]
}

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
  const turn = [...cross(start, end), 1 + cosine]
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
