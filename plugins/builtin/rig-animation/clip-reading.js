/**
 * Rig Animation: a clip read as joint positions, frame by frame, for the
 * checks that judge a motion (pose-facts.js, motion-faults.js).
 *
 * A joint is found by its role, not its name, so any humanoid rig reads the
 * same way: `hips`, `chest`, `neck`, `head`, and for each side `shoulder`
 * (the upper-arm bone's root), `elbow`, `hand`, `hip` (the thigh's root),
 * `knee`, `foot` and `toe`. Positions are metres in model space (+Y up, +Z
 * the model's front), with the clip's root travel over the ground added, so
 * a foot planted on the floor holds still in them.
 */
import { pointIn } from './skeleton.js'

/** The pattern that finds each role's node, and per side the prefix that tells left from right. */
const CENTRE_ROLES = {
  hips: /hips|pelvis/i,
  chest: /spine2|upperchest|chest/i,
  neck: /neck/i,
  head: /head(?!top|_end)/i
}
const SIDE_ROLES = {
  shoulder: /(?<!fore_?|lower_?)(upper_?arm|arm)$/i,
  elbow: /(fore_?arm|lower_?arm)$/i,
  hand: /hand$/i,
  hip: /(up_?leg|thigh|upper_?leg)$/i,
  knee: /((?<!up_?)leg|calf|shin|lower_?leg)$/i,
  foot: /foot$/i,
  toe: /toe(base)?$/i
}
const SIDES = { left: /left|_l\b|\.l\b/i, right: /right|_r\b|\.r\b/i }

/** Each role's node name in a skeleton: `{ hips, chest, ..., left: { hand, ... }, right: { ... } }`; a role not found is left out. */
export function rolesOf(skeleton) {
  const names = Object.keys(skeleton.nodes)
  const findOne = (pattern, among) => among.find(name => pattern.test(name.split(':').pop()))
  const centre = Object.fromEntries(
    Object.entries(CENTRE_ROLES)
      .map(([role, pattern]) => [
        role,
        findOne(
          pattern,
          names.filter(name => !SIDES.left.test(name) && !SIDES.right.test(name))
        )
      ])
      .filter(([, name]) => name)
  )
  const side = which => {
    const among = names.filter(name => SIDES[which].test(name))
    return Object.fromEntries(
      Object.entries(SIDE_ROLES)
        .map(([role, pattern]) => [role, findOne(pattern, among)])
        .filter(([, name]) => name)
    )
  }
  return { ...centre, left: side('left'), right: side('right') }
}

/** The pose a clip holds at one frame: node -> turn, or turn and local position. */
function poseAt(clip, frame) {
  const pose = {}
  const turns = clip.rotations[frame]
  clip.nodes.forEach((node, index) => {
    const turn = turns.slice(index * 4, index * 4 + 4)
    pose[node] = clip.positions?.[node] ? [...turn, ...clip.positions[node][frame]] : turn
  })
  return pose
}

/**
 * Every role's position at every frame: `{ frames: [{ hips: [x, y, z], ...,
 * left: { hand: [...] }, right: {...} }], framesPerSecond, loop, roles }`.
 */
export function readClip(skeleton, clip) {
  const roles = rolesOf(skeleton)
  const frames = []
  for (let frame = 0; frame < clip.count; frame++) {
    const pose = poseAt(clip, frame)
    const travel = clip.root ? [clip.root[frame][0], 0, clip.root[frame][2]] : [0, 0, 0]
    frames.push(
      placedRoles(roles, name => pointIn(skeleton, pose, name, [0, 0, 0]).map((value, axis) => value + travel[axis]))
    )
  }
  return { frames, framesPerSecond: clip.framesPerSecond, loop: clip.loop, roles }
}

/** Every role's position in the rest pose, the same shape as one frame of `readClip`: the ruler every limit is measured with. */
export function restOf(skeleton) {
  const roles = rolesOf(skeleton)
  return placedRoles(roles, name => pointIn(skeleton, {}, name, [0, 0, 0]))
}

/** Each role's node placed by `at(name)`, in the shape of `rolesOf`. */
function placedRoles(roles, at) {
  const placed = {}
  for (const [role, name] of Object.entries(roles)) {
    if (typeof name === 'string') placed[role] = at(name)
  }
  for (const side of ['left', 'right']) {
    placed[side] = Object.fromEntries(Object.entries(roles[side]).map(([role, name]) => [role, at(name)]))
  }
  return placed
}
