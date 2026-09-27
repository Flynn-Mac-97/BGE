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
 * The body's place:
 *   hips  { drop, turn }           drop is metres lower than standing (a crouch);
 *         turn is degrees the whole body faces left (negative is right)
 *   torso { lean, side, twist }    degrees from the hips: lean forward (negative
 *         is back), lean to the left side, twist the shoulders to the left
 *   head  { turn, nod }            degrees: look left, look down
 * A key pose names any of `right`, `left` (hands), `rightFoot`, `leftFoot`,
 * `hips`, `torso` and `head`. A part it leaves out is free: Kimodo moves it as
 * the prompt says. A hand's level word drops with the hips. Every length
 * scales with the model's own rest pose (rig-animation/clip-reading.js),
 * written for a 1.7 m body.
 */
import { restOf } from '../rig-animation/clip-reading.js'
import { DEGREES } from '../game-maths/numbers.js'

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
    leftFoot: { forward: 0.1, out: 0.08 },
    hips: { drop: 0.03 }
  },
  guard: {
    means: 'weapon hand chest high and forward, off hand in front, left foot leading',
    right: { level: 'chest', forward: 0.35, out: -0.05 },
    left: { level: 'chest', forward: 0.25, out: -0.08 },
    rightFoot: { forward: -0.15, out: 0.08 },
    leftFoot: { forward: 0.18, out: 0.06 },
    hips: { drop: 0.06, turn: -15 },
    torso: { lean: 8 }
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
    leftFoot: { forward: 0.2, out: 0.06 },
    hips: { drop: 0.04 },
    torso: { lean: -8, twist: -30 },
    head: { turn: 25 }
  },
  'strike-down': {
    means: 'the end of a downward strike: weapon hand low and far forward',
    right: { level: 'waist', forward: 0.5, out: -0.08 },
    left: { level: 'waist', forward: 0.25, out: 0 },
    rightFoot: { forward: -0.25, out: 0.1 },
    leftFoot: { forward: 0.3, out: 0.06 },
    hips: { drop: 0.15 },
    torso: { lean: 30, twist: 15 },
    head: { nod: 15 }
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
    leftFoot: { forward: -0.35, out: 0.08 },
    hips: { drop: 0.2 },
    torso: { lean: 15 }
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

/** The body parts a key pose may set, besides its limbs. */
const BODY = ['hips', 'torso', 'head']

/** Which way X runs for a side: the model faces +Z, so its left is +X. */
const SIDE_X = { left: 1, right: -1 }

/** A key pose made whole: the named pose, mirrored when asked, with the key's own limbs over it. */
export function keyPose(key) {
  const named = key.pose ? POSES[key.pose] : {}
  if (key.pose && !named) throw new Error(`no pose "${key.pose}" — try ${Object.keys(POSES).join(', ')}`)
  const base = key.mirror ? mirrored(named) : named
  const parts = Object.fromEntries(
    [...LIMBS.map(limb => limb.name), ...BODY].map(name => [
      name,
      key[name] ? { ...base[name], ...key[name] } : base[name]
    ])
  )
  return Object.fromEntries(Object.entries(parts).filter(([, place]) => place))
}

/** A pose with its sides swapped: the limbs change places and every leftward angle turns right. */
const mirrored = pose => ({
  right: pose.left,
  left: pose.right,
  rightFoot: pose.leftFoot,
  leftFoot: pose.rightFoot,
  hips: pose.hips && { ...pose.hips, turn: -(pose.hips.turn ?? 0) },
  torso: pose.torso && { ...pose.torso, side: -(pose.torso.side ?? 0), twist: -(pose.torso.twist ?? 0) },
  head: pose.head && { ...pose.head, turn: -(pose.head.turn ?? 0) }
})

const scaleOf = rest => rest.head[1] / REFERENCE_HEIGHT

/** How far a pose drops the hips, in the model's metres. */
const dropOf = (pose, rest) => (pose.hips?.drop ?? 0) * scaleOf(rest)

/** Where a limb's place is in model space, for a body whose rest pose is `rest`, with the hips `drop` metres low. */
function pointOf(limb, place, rest, drop) {
  const scale = scaleOf(rest)
  const x = SIDE_X[limb.side]
  const isFoot = limb.name.endsWith('Foot')
  const root = isFoot ? rest[limb.side].hip : rest[limb.side].shoulder
  const across = root[0] + x * place.out * scale
  if (isFoot) return [across, rest[limb.side].foot[1], place.forward * scale]
  const level = LEVELS[place.level]
  if (typeof place.level !== 'number' && !level)
    throw new Error(`no hand level "${place.level}" — try ${Object.keys(LEVELS).join(', ')}, or a height in metres`)
  const height = level ? level(rest) - drop : place.level
  const shoulder = rest[limb.side].shoulder
  return withinReach(
    [across, height, rest.chest[2] + place.forward * scale],
    [shoulder[0], shoulder[1] - drop, shoulder[2]],
    armLength(rest, limb.side)
  )
}

/** The torso's turn from the rest pose as [yaw, pitch, roll] radians: the body's turn plus the twist, the lean, the side lean. */
function torsoTurnOf(pose) {
  const torso = pose.torso ?? {}
  const yaw = ((pose.hips?.turn ?? 0) + (torso.twist ?? 0)) * DEGREES
  return [yaw, (torso.lean ?? 0) * DEGREES, -(torso.side ?? 0) * DEGREES]
}

const rounded = angles => angles.map(angle => Number(angle.toFixed(3)))

/**
 * The body key a pose asks for at `at`, for motion-conditions.mjs's `body`
 * constraint: `{ at, height?, heading?, torso?, head? }`, or null when the
 * pose sets no body part. The head's turn adds its own look to the torso's
 * yaw and pitch, which is close enough at the angles a pose uses.
 */
function bodyKeyOf(pose, rest, at) {
  if (!BODY.some(part => pose[part])) return null
  const [yaw, pitch, roll] = torsoTurnOf(pose)
  const head = pose.head && [yaw + (pose.head.turn ?? 0) * DEGREES, pitch + (pose.head.nod ?? 0) * DEGREES, roll]
  return {
    at,
    ...(pose.hips ? { height: Number((rest.hips[1] - dropOf(pose, rest)).toFixed(3)) } : {}),
    ...(pose.hips?.turn ? { heading: Number((pose.hips.turn * DEGREES).toFixed(3)) } : {}),
    ...(pose.torso ? { torso: rounded([yaw, pitch, roll]) } : {}),
    ...(head ? { head: rounded(head) } : {})
  }
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

/**
 * The designer keys for a timeline of key poses: `{ keys: { RightHand: [{ at,
 * value, ease }], ... }, body: [{ at, height?, heading?, torso?, head? }] }`.
 * A design stores both (designer.js).
 */
export function keysOf(timeline, skeleton) {
  const rest = restOf(skeleton)
  const keys = {}
  const body = []
  for (const key of timeline) {
    const pose = keyPose(key)
    const drop = dropOf(pose, rest)
    for (const limb of LIMBS.filter(candidate => pose[candidate.name])) {
      const limbKey = { at: key.at, value: pointOf(limb, pose[limb.name], rest, drop), ease: 'sine-in-out' }
      keys[limb.handle] = [...(keys[limb.handle] ?? []), limbKey]
    }
    const bodyKey = bodyKeyOf(pose, rest, key.at)
    if (bodyKey) body.push(bodyKey)
  }
  return { keys, body }
}

/** One key pose in words, as asked: what the agent or person meant it to be. */
export function poseWords(key) {
  const pose = keyPose(key)
  const centimetres = metres => Math.round(Math.abs(metres) * 100)
  const along = metres => `${centimetres(metres)} cm ${metres >= 0 ? 'ahead' : 'behind'}`
  const aside = metres => `${centimetres(metres)} cm ${metres >= 0 ? 'out' : 'across'}`
  const place = (name, spot) => {
    if (PART_WORDS[name]) return PART_WORDS[name](spot)
    if (name.endsWith('Foot')) return `${name.replace('Foot', '')} foot ${along(spot.forward)}`
    return `${name} hand ${typeof spot.level === 'number' ? `${spot.level} m up` : spot.level.replace('-', ' ')}, ${along(spot.forward)}, ${aside(spot.out)}`
  }
  return `${key.pose ?? 'custom'} at ${key.at} s: ${Object.entries(pose)
    .map(([name, spot]) => place(name, spot))
    .join('; ')}`
}

/** Each dial's words for a positive and a negative angle. */
const DIAL_WORDS = {
  hips: { turn: ['turned left', 'turned right'] },
  torso: {
    lean: ['forward', 'back'],
    side: ['to the left side', 'to the right side'],
    twist: ['twisted left', 'twisted right']
  },
  head: { turn: ['looking left', 'looking right'], nod: ['down', 'up'] }
}

/** A body part's set angles in words, `30° forward, 15° twisted left`. */
const anglesOf = (part, spot) =>
  Object.entries(DIAL_WORDS[part])
    .filter(([dial]) => spot[dial])
    .map(([dial, [positive, negative]]) => `${Math.abs(spot[dial])}° ${spot[dial] > 0 ? positive : negative}`)

/** A body part of a key pose in words. */
const PART_WORDS = {
  hips: spot =>
    `hips ${[...(spot.drop ? [`${Math.round(spot.drop * 100)} cm low`] : []), ...anglesOf('hips', spot)].join(', ') || 'level'}`,
  torso: spot => `torso ${anglesOf('torso', spot).join(', ') || 'upright'}`,
  head: spot => `head ${anglesOf('head', spot).join(', ') || 'level'}`
}
