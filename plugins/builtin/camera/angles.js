/**
 * Game Camera: the angle rules every camera mode shares.
 */

/** Exactly 90 degrees makes the camera basis degenerate and the view rolls. */
export const MAX_PITCH = 89 * Math.PI / 180

/** A value held between two limits. */
export const clamp = (value, lowest, highest) => Math.min(highest, Math.max(lowest, value))

/** Into plus or minus PI, so a yaw that has been turning all game stays small. */
export function wrapAngle(radians) {
  const shifted = (radians + Math.PI) % (Math.PI * 2)
  return shifted < 0 ? shifted + Math.PI : shifted - Math.PI
}
