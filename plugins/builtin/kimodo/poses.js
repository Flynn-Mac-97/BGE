/**
 * Kimodo poser: key poses by name, in body terms, turned into the hand and
 * foot keys a design sends Kimodo (designer.js). An agent or a person says
 * "wind-up at 0.4 s, strike-down at 0.7 s", not coordinates; a picture of a
 * pose is read into the same terms.
 *
 * A limb's place:
 *   hand  { level, forward, out }  level is a word below or a height in
 *         metres; forward is metres ahead of the chest (negative is behind);
 *         out is metres out from the shoulder line (negative crosses the body)
 *   foot  { forward, out }         on the floor; metres from under the hip
 * A key pose names any of `right`, `left` (hands) and `rightFoot`,
 * `leftFoot`. A limb it leaves out is free: Kimodo moves it as the prompt
 * says. Every length scales with the model's own rest pose
 * (rig-animation/clip-reading.js), written for a 1.7 m body.
 */
import { restOf } from '../rig-animation/clip-reading.js'

/** The body height the poses are written for. */
const REFERENCE_HEIGHT = 1.7

/** Hand heights by word, from the rest pose: where on the body the hand is. */
const LEVELS = {
  'above-head': rest => rest.head[1] + 0.25,
  head: rest => rest.head[1],
  shoulder: rest => rest.left.shoulder[1],
  chest: rest => rest.chest[1],
  waist: rest => rest.hips[1],
  low: rest => rest.hips[1] - 0.2
}

/**
 * The vocabulary. A weapon is in the right hand; `mirror` a key to swap sides.
 * Each says what it is for in `means`, so a list of them reads as a menu.
 */
export const POSES = {
  rest: {
    means: 'arms relaxed at the sides',
    right: { level: 'low', forward: 0.05, out: 0.05 },
    left: { level: 'low', forward: 0.05, out: 0.05 }
  },
  ready: {
    means: 'hands low in front, weight even',
    right: { level: 'waist', forward: 0.25, out: 0.02 },
    left: { level: 'waist', forward: 0.2, out: 0.02 },
    rightFoot: { forward: -0.1, out: 0.08 },
    leftFoot: { forward: 0.1, out: 0.08 }
  },
  guard: {
    means: 'weapon hand chest high and forward, off hand in front, left foot leading',
    right: { level: 'chest', forward: 0.35, out: -0.05 },
    left: { level: 'chest', forward: 0.25, out: -0.08 },
    rightFoot: { forward: -0.15, out: 0.08 },
    leftFoot: { forward: 0.18, out: 0.06 }
  },
  'high-guard': {
    means: 'weapon raised over the head, point back, off hand guarding the chest',
    right: { level: 'above-head', forward: 0.05, out: 0.05 },
    left: { level: 'chest', forward: 0.25, out: -0.05 }
  },
  'wind-up': {
    means: 'weapon drawn back over the right shoulder, ready to swing down',
    right: { level: 'above-head', forward: -0.15, out: 0.12 },
    left: { level: 'shoulder', forward: 0.2, out: 0 },
    rightFoot: { forward: -0.2, out: 0.1 },
    leftFoot: { forward: 0.2, out: 0.06 }
  },
  'strike-down': {
    means: 'the end of a downward strike: weapon hand low and far forward',
    right: { level: 'waist', forward: 0.5, out: -0.08 },
    left: { level: 'waist', forward: 0.25, out: 0 },
    rightFoot: { forward: -0.25, out: 0.1 },
    leftFoot: { forward: 0.3, out: 0.06 }
  },
  thrust: {
    means: 'weapon hand driven straight forward at chest height, off hand back',
    right: { level: 'chest', forward: 0.6, out: -0.12 },
    left: { level: 'chest', forward: -0.1, out: 0.12 },
    rightFoot: { forward: -0.2, out: 0.08 },
    leftFoot: { forward: 0.3, out: 0.06 }
  },
  'slash-open': {
    means: 'weapon hand out wide on the right at shoulder height, before a flat slash',
    right: { level: 'shoulder', forward: 0.1, out: 0.35 },
    left: { level: 'chest', forward: 0.2, out: -0.05 }
  },
  'slash-close': {
    means: 'weapon hand swept across to the left at the waist, after a flat slash',
    right: { level: 'waist', forward: 0.35, out: -0.4 },
    left: { level: 'chest', forward: 0.1, out: 0.1 }
  },
  block: {
    means: 'both hands up in front of the face',
    right: { level: 'head', forward: 0.35, out: -0.05 },
    left: { level: 'head', forward: 0.35, out: -0.05 }
  },
  lunge: {
    means: 'long step forward on the right foot, weapon hand far forward',
    right: { level: 'chest', forward: 0.65, out: -0.08 },
    left: { level: 'waist', forward: -0.2, out: 0.15 },
    rightFoot: { forward: 0.5, out: 0.08 },
    leftFoot: { forward: -0.35, out: 0.08 }
  },
  'hands-up': {
    means: 'both arms raised high',
    right: { level: 'above-head', forward: 0.05, out: 0.1 },
    left: { level: 'above-head', forward: 0.05, out: 0.1 }
  }
}

/** The limbs a key pose places, each with its designer handle and the side it is on. */
const LIMBS = [
  { name: 'right', handle: 'RightHand', side: 'right' },
  { name: 'left', handle: 'LeftHand', side: 'left' },
  { name: 'rightFoot', handle: 'RightFoot', side: 'right' },
  { name: 'leftFoot', handle: 'LeftFoot', side: 'left' }
]

/** Which way X runs for a side: the model faces +Z, so its left is +X. */
const SIDE_X = { left: 1, right: -1 }

/** A key pose made whole: the named pose, mirrored when asked, with the key's own limbs over it. */
export function keyPose(key) {
  const named = key.pose ? POSES[key.pose] : {}
  if (key.pose && !named) throw new Error(`no pose "${key.pose}" — try ${Object.keys(POSES).join(', ')}`)
  const base = key.mirror ? mirrored(named) : named
  const limbs = Object.fromEntries(
    LIMBS.map(limb => [limb.name, key[limb.name] ? { ...base[limb.name], ...key[limb.name] } : base[limb.name]])
  )
  return Object.fromEntries(Object.entries(limbs).filter(([, place]) => place))
}

/** A pose with its sides swapped. */
const mirrored = pose => ({ right: pose.left, left: pose.right, rightFoot: pose.leftFoot, leftFoot: pose.rightFoot })

/** Where a limb's place is in model space, for a body whose rest pose is `rest`. */
function pointOf(limb, place, rest) {
  const scale = rest.head[1] / REFERENCE_HEIGHT
  const x = SIDE_X[limb.side]
  const isFoot = limb.name.endsWith('Foot')
  const root = isFoot ? rest[limb.side].hip : rest[limb.side].shoulder
  const across = root[0] + x * place.out * scale
  if (isFoot) return [across, rest[limb.side].foot[1], place.forward * scale]
  const height = typeof place.level === 'number' ? place.level : LEVELS[place.level]?.(rest)
  if (height === undefined)
    throw new Error(`no hand level "${place.level}" — try ${Object.keys(LEVELS).join(', ')}, or a height in metres`)
  return withinReach(
    [across, height, rest.chest[2] + place.forward * scale],
    rest[limb.side].shoulder,
    armLength(rest, limb.side)
  )
}

const armLength = (rest, side) =>
  distance(rest[side].shoulder, rest[side].elbow) + distance(rest[side].elbow, rest[side].hand)
const distance = (first, second) => Math.hypot(...first.map((value, axis) => value - second[axis]))

/** A hand point pulled in to 97% of the arm's length from the shoulder, so the arm is never asked to stretch. */
function withinReach(point, shoulder, length) {
  const offset = point.map((value, axis) => value - shoulder[axis])
  const share = Math.min(1, (0.97 * length) / (Math.hypot(...offset) || 1))
  return shoulder.map((value, axis) => Number((value + offset[axis] * share).toFixed(3)))
}

/** The designer keys for a timeline of key poses: `{ RightHand: [{ at, value }], ... }`. */
export function keysOf(timeline, skeleton) {
  const rest = restOf(skeleton)
  const keys = {}
  for (const key of timeline) {
    const pose = keyPose(key)
    for (const limb of LIMBS.filter(candidate => pose[candidate.name])) {
      keys[limb.handle] = [
        ...(keys[limb.handle] ?? []),
        { at: key.at, value: pointOf(limb, pose[limb.name], rest), ease: 'sine-in-out' }
      ]
    }
  }
  return keys
}

/** One key pose in words, as asked: what the agent or person meant it to be. */
export function poseWords(key) {
  const pose = keyPose(key)
  const centimetres = metres => Math.round(Math.abs(metres) * 100)
  const along = metres => `${centimetres(metres)} cm ${metres >= 0 ? 'ahead' : 'behind'}`
  const aside = metres => `${centimetres(metres)} cm ${metres >= 0 ? 'out' : 'across'}`
  const place = (name, spot) =>
    name.endsWith('Foot')
      ? `${name.replace('Foot', '')} foot ${along(spot.forward)}`
      : `${name} hand ${typeof spot.level === 'number' ? `${spot.level} m up` : spot.level.replace('-', ' ')}, ${along(spot.forward)}, ${aside(spot.out)}`
  return `${key.pose ?? 'custom'} at ${key.at} s: ${Object.entries(pose)
    .map(([name, spot]) => place(name, spot))
    .join('; ')}`
}
