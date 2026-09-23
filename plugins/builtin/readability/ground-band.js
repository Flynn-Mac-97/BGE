/**
 * Readability: the TSL of a flat mark on the floor — how far a point on one of the
 * ground quads is from its middle, and the feathered band a ring draws.
 */
import { oneMinus, positionGeometry, smoothstep } from 'three/tsl'

/**
 * How far a point on one of the ground quads is from its middle.
 *
 * Both quads are a unit plane laid flat, so the position is in XZ and doubling
 * it gives 0 at the middle and 1 at an edge.
 */
export const groundReach = () => positionGeometry.xz.mul(2).length()

/**
 * The band a ground ring draws, where 1.0 is its radius.
 *
 * Both edges are feathered: a hard edge adds two lines to the frame's edge
 * count, and the ring only has to be found.
 */
export function groundRingBand() {
  const reach = groundReach()
  return smoothstep(0.70, 0.81, reach).mul(oneMinus(smoothstep(0.93, 1.0, reach)))
}
