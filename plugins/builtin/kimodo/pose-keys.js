/**
 * Kimodo designer: a pose record (Image Models, `assets/poses/*.json`) as
 * keys on a design at one time, so a photo's pose becomes a key pose.
 *
 * The record's points are already in model space (+Y up, facing +Z, left at
 * +X, feet on the floor); they are scaled so the person's legs are as long
 * as the rig's, so a crouch stays a crouch, and turned about +Y so the hips
 * face +Z, so a person photographed side-on keys a rig that faces forward. Wrists and ankles key the hands and feet; each elbow and knee
 * becomes a target a little past the joint, away from its limb's straight
 * line, so the limb bends the way the photo's does; the hips key the height,
 * the neck the chest's lean and the nose the head's look. A point the record
 * lacks keys nothing.
 */
import { add, scaled, subtract, unit, lengthOf } from '../game-maths/space.js'
import { withKey } from './designer.js'
import { bodyChangeOf, bodyTargetAt, withBodyKey } from './body-rig.js'

/** How far past its joint an elbow or knee target is put, in metres. */
const BEND_REACH = 0.3

/** Each limb key and the record point it is. */
const LIMB_POINTS = { RightHand: 'right_wrist', LeftHand: 'left_wrist', RightFoot: 'right_ankle', LeftFoot: 'left_ankle' }

/** Each elbow and knee target, and its limb's root, joint and end points. */
const BEND_POINTS = {
  RightElbow: ['right_shoulder', 'right_elbow', 'right_wrist'],
  LeftElbow: ['left_shoulder', 'left_elbow', 'left_wrist'],
  RightKnee: ['right_hip', 'right_knee', 'right_ankle'],
  LeftKnee: ['left_hip', 'left_knee', 'left_ankle']
}

const middleOf = (first, second) => scaled(add(first, second), 0.5)

/** `points` turned about +Y so the line right hip to left hip points +X; unturned without both hips. */
function facingForward(points) {
  if (!points.left_hip || !points.right_hip) return points
  const [x, , z] = subtract(points.left_hip, points.right_hip)
  const angle = Math.atan2(z, x)
  const [cosine, sine] = [Math.cos(angle), Math.sin(angle)]
  return Object.fromEntries(Object.entries(points).map(([name, [pointX, pointY, pointZ]]) =>
    [name, [pointX * cosine + pointZ * sine, pointY, pointZ * cosine - pointX * sine]]))
}

/** Hip to knee to ankle, summed over the legs `sides` has; 0 when it has none. */
function legLengthOf(sides) {
  const lengths = sides.filter(leg => leg.every(Boolean)).map(([hip, knee, ankle]) =>
    lengthOf(subtract(knee, hip)) + lengthOf(subtract(ankle, knee)))
  return lengths.length ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length : 0
}

/** A target past `joint`, away from the line `root` to `end`; null for a straight limb. */
function bendTarget(root, joint, end) {
  const away = subtract(joint, middleOf(root, end))
  return lengthOf(away) < 0.01 ? null : add(joint, scaled(unit(away), BEND_REACH))
}

/** `design` with the hands, feet, and elbow and knee targets keyed at `seconds`, from `pointOf(name)`. */
function withLimbKeys(design, pointOf, seconds) {
  let keyed = design
  for (const [limb, name] of Object.entries(LIMB_POINTS)) if (pointOf(name)) keyed = withKey(keyed, limb, seconds, pointOf(name))
  for (const [pole, names] of Object.entries(BEND_POINTS)) {
    const [root, joint, end] = names.map(pointOf)
    const target = root && joint && end && bendTarget(root, joint, end)
    if (target) keyed = withKey(keyed, pole, seconds, target)
  }
  return keyed
}

/**
 * The body key the pose asks for: the hips' height over the middle of the
 * floor, the chest leaning along hips to neck, the head looking along ears
 * to nose. `hips` is the scaled middle of the hips, or null.
 */
function bodyKeyOf(pointOf, hips, rest, seconds) {
  const rested = bodyTargetAt({ body: [{ at: seconds }] }, rest, seconds)
  const height = hips ? { height: Number(hips[1].toFixed(3)), ground: [0, 0] } : {}
  const neck = pointOf('neck')
  const lean = neck && hips ? bodyChangeOf('Chest', add(rested.hips, subtract(neck, hips)), rested) : {}
  const ears = pointOf('left_ear') && pointOf('right_ear') ? middleOf(pointOf('left_ear'), pointOf('right_ear')) : null
  const look = pointOf('nose') && ears ? bodyChangeOf('Head', add(rested.head, subtract(pointOf('nose'), ears)), rested) : {}
  return { ...height, ...lean, ...look }
}

/**
 * `design` with the pose of person `person` in `record` keyed at `seconds`,
 * on a rig whose rest pose is `rest` (clip-reading.js restOf).
 */
export function withPoseKeys(design, record, { seconds, rest, person = 0 }) {
  const photographed = record.people?.[person]?.points
  if (!photographed) throw new Error(`the pose record has no person ${person}`)
  const points = facingForward(photographed)
  const rawHips = points.left_hip && points.right_hip ? middleOf(points.left_hip, points.right_hip) : null
  const photoLeg = legLengthOf(['left', 'right'].map(side => ['hip', 'knee', 'ankle'].map(part => points[`${side}_${part}`])))
  const rigLeg = legLengthOf(['left', 'right'].map(side => ['hip', 'knee', 'foot'].map(part => rest[side][part])))
  const size = photoLeg > 0.1 ? rigLeg / photoLeg : 1
  const pointOf = name => points[name] && scaled(points[name], size)
  const hips = rawHips && scaled(rawHips, size)
  return withBodyKey(withLimbKeys(design, pointOf, seconds), seconds, bodyKeyOf(pointOf, hips, rest, seconds))
}
