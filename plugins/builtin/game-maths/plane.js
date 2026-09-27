/**
 * Game Maths in 2D: points as plain arrays `[x, y]`. An angle is radians
 * counter-clockwise from +x, with +y up. Every function answers a new array
 * and changes none it is given.
 */

/** The sum of two points. */
export const add = (first, second) => [first[0] + second[0], first[1] + second[1]]

/** The point from `second` to `first`. */
export const subtract = (first, second) => [first[0] - second[0], first[1] - second[1]]

/** A point times a number. */
export const scaled = (point, factor) => [point[0] * factor, point[1] * factor]

/** The dot product of two points. */
export const dot = (first, second) => first[0] * second[0] + first[1] * second[1]

/** The 2D cross product: positive when `second` is counter-clockwise of `first`. */
export const cross = (first, second) => first[0] * second[1] - first[1] * second[0]

/** How long a point is from the origin. */
export const lengthOf = point => Math.hypot(point[0], point[1])

/** A point of length 1 the same way, or the zero point unchanged. */
export const unit = point => scaled(point, 1 / (lengthOf(point) || 1))

/** A point turned `angle` radians counter-clockwise about the origin. */
export function turnedBy(point, angle) {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos]
}

/** The angle of a point from +x, in plus or minus PI. */
export const angleOf = point => Math.atan2(point[1], point[0])
