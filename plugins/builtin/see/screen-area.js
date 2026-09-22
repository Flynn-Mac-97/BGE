import { convexHull } from './frame-facts.js'

/**
 * The part of a convex polygon inside the frame [0, 100] by [0, 100].
 *
 * Sutherland–Hodgman: each frame edge clips the polygon in turn. The frame is
 * the same rectangle the screen uses, so a share measured here matches what a
 * camera actually shows, on any view.
 */
export function clipToFrame(polygon) {
  const inside = [
    point => point[0] >= 0,
    point => point[0] <= 100,
    point => point[1] >= 0,
    point => point[1] <= 100
  ]
  const crossing = (a, b, edge) => {
    const t = edge === 0 ? (0 - a[0]) / (b[0] - a[0])
      : edge === 1 ? (100 - a[0]) / (b[0] - a[0])
      : edge === 2 ? (0 - a[1]) / (b[1] - a[1])
      : (100 - a[1]) / (b[1] - a[1])
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
  }
  let output = polygon
  for (let edge = 0; edge < 4 && output.length; edge++) {
    const input = output
    output = []
    for (let at = 0; at < input.length; at++) {
      const current = input[at]
      const previous = input[(at + input.length - 1) % input.length]
      const currentInside = inside[edge](current)
      const previousInside = inside[edge](previous)
      if (currentInside) {
        if (!previousInside) output.push(crossing(previous, current, edge))
        output.push(current)
      } else if (previousInside) {
        output.push(crossing(previous, current, edge))
      }
    }
  }
  return output
}

/** The area of a polygon in percent-squared, by the shoelace formula. */
export function polygonArea(polygon) {
  let sum = 0
  for (let at = 0; at < polygon.length; at++) {
    const a = polygon[at]
    const b = polygon[(at + 1) % polygon.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/**
 * Where a world box lands on screen: its eight projected corners, their convex
 * hull, and the part of that hull inside the frame.
 *
 * The hull is the drawn shape, so coverage and cut come from the hull and not
 * from a bounding rectangle. A tilted box or a long thin one projects to a
 * shape a rectangle cannot state.
 *
 * Every corner must sit clearly in front of a perspective eye. A corner behind
 * the eye would drop out of the hull, and a corner grazing it projects
 * thousands of percent off frame. One unsafe corner returns null, the same
 * guard the engine screen hull uses, and the caller drops the entity.
 *
 * The screen position is the mean of the projected corners and the depth is
 * the mean of their depths. Depth is affine in the world point, so that mean
 * is the centre depth exactly; both come from the eight projections the hull
 * already needs, with no second pass.
 */
export function projectedShape(box, projector) {
  const corners = []
  let sumX = 0, sumY = 0, sumDepth = 0
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const point = projector.place(
      box.x + sx * box.w / 2,
      box.y + sy * box.h / 2,
      (box.z || 0) + sz * (box.l || 0) / 2)
    if (!point.inFront || (projector.mode !== 'ortho' && point.depth < 0.2)) return null
    corners.push([point.x, point.y])
    sumX += point.x
    sumY += point.y
    sumDepth += point.depth
  }
  const hull = convexHull(corners)
  if (hull.length < 3) return null
  const full = polygonArea(hull)
  const clipped = polygonArea(clipToFrame(hull))
  return {
    hull,
    full,
    clipped,
    share: full > 0 ? clipped / full : 0,
    at: [sumX / corners.length, sumY / corners.length],
    depth: sumDepth / corners.length
  }
}
