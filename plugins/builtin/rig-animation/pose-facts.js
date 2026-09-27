/**
 * Rig Animation: one moment of a clip as facts an agent reads, not a picture.
 *
 * From a frame of `readClip` and the rest pose (clip-reading.js): how far
 * each elbow and knee is bent, where each hand is against the body, how the
 * spine leans, which feet are on the floor and where the weight is. The body's
 * own front and left come from its hips, so a turned body reads the same.
 * `words` says the same in one line. Lengths are centimetres, angles degrees.
 */
import { cross, dot, lengthOf, subtract, unit } from '../game-maths/space.js'

/** Metres above its rest height under which a foot is on the floor. */
export const PLANTED = 0.03

const DEGREES = 180 / Math.PI
const centimetres = metres => Math.round(metres * 100)

/** How far a joint is bent: 0 straight, 90 a right angle. */
function bendOf(from, joint, to) {
  const cosine = dot(unit(subtract(from, joint)), unit(subtract(to, joint)))
  return Math.round(180 - Math.acos(Math.max(-1, Math.min(1, cosine))) * DEGREES)
}

/** The body's own axes at a frame: `left` from the right hip to the left, `front` across it, both level. */
function axesOf(frame) {
  const across = subtract(frame.left.hip, frame.right.hip)
  const left = unit([across[0], 0, across[2]])
  return { left, front: unit(cross(left, [0, 1, 0])) }
}

/** How far a line across the body is turned left from +X, about Y, in radians. */
const yawOf = across => Math.atan2(-across[2], across[0])

/** An angle brought within -π..π. */
const wrapped = angle => Math.atan2(Math.sin(angle), Math.cos(angle))

/** How high a foot is over its rest height, from its ankle or toe, whichever is lower. */
export const liftOf = (frame, rest, side) =>
  Math.min(
    frame[side].foot[1] - rest[side].foot[1],
    frame[side].toe ? frame[side].toe[1] - rest[side].toe[1] : Infinity
  )

/**
 * The clip's own floor: how high over its rest height the lowest foot comes,
 * over every frame. A take that hovers has its feet planted this far up, so a
 * foot is planted against this, not against the rest pose.
 */
export const floorOf = (frames, rest) =>
  Math.min(...frames.flatMap(frame => ['left', 'right'].map(side => liftOf(frame, rest, side))))

/** Where a hand is up the body, as a word. */
function handLevel(frame, side) {
  const height = frame[side].hand[1]
  if (height > frame.head[1]) return 'above the head'
  if (height > frame.neck[1]) return 'at the head'
  if (height > frame.chest[1] - 0.05) return 'at the shoulder'
  if (height > frame.hips[1] + 0.1) return 'at the chest'
  if (height > frame.hips[1] - 0.1) return 'at the waist'
  return 'low'
}

/** Where the weight is: on one foot, between them, or on neither. */
function weightOf(frame, planted) {
  if (!planted.left && !planted.right) return 'in the air'
  if (!planted.right) return 'on the left foot'
  if (!planted.left) return 'on the right foot'
  const between = subtract(frame.right.foot, frame.left.foot)
  const along = dot(subtract(frame.hips, frame.left.foot), between) / (dot(between, between) || 1)
  if (along < 0.3) return 'on the left foot'
  if (along > 0.7) return 'on the right foot'
  return 'between the feet'
}

/**
 * The facts of one frame: `{ elbows, knees, hands, spine, crouch, turn, twist,
 * feet, weight, words }`. `turn` is degrees the hips face left of +Z; `twist`
 * is degrees the shoulders turn left of the hips.
 * `floor` is the clip's own floor (`floorOf`); a foot within PLANTED of it is planted.
 */
export function poseFacts(frame, rest, floor = 0) {
  const { left, front } = axesOf(frame)
  const facts = { elbows: {}, knees: {}, hands: {}, feet: {} }
  const planted = {}
  for (const side of ['left', 'right']) {
    const limb = frame[side]
    facts.elbows[side] = bendOf(limb.shoulder, limb.elbow, limb.hand)
    facts.knees[side] = bendOf(limb.hip, limb.knee, limb.foot)
    const fromChest = subtract(limb.hand, frame.chest)
    facts.hands[side] = {
      level: handLevel(frame, side),
      forward: centimetres(dot(fromChest, front)),
      out: centimetres(dot(fromChest, left) * (side === 'left' ? 1 : -1))
    }
    const lift = liftOf(frame, rest, side) - floor
    planted[side] = lift < PLANTED
    facts.feet[side] = planted[side] ? 'planted' : `lifted ${centimetres(lift)}`
  }
  const spine = subtract(frame.neck, frame.hips)
  facts.spine = {
    forward: Math.round(Math.atan2(dot(spine, front), spine[1]) * DEGREES),
    side: Math.round(Math.atan2(dot(spine, left), spine[1]) * DEGREES)
  }
  facts.crouch = centimetres(rest.hips[1] - frame.hips[1])
  const hipsYaw = yawOf(subtract(frame.left.hip, frame.right.hip))
  facts.turn = Math.round(hipsYaw * DEGREES)
  facts.twist = Math.round(wrapped(yawOf(subtract(frame.left.shoulder, frame.right.shoulder)) - hipsYaw) * DEGREES)
  facts.weight = weightOf(frame, planted)
  facts.words = wordsOf(facts)
  return facts
}

/** The facts in one line. */
function wordsOf(facts) {
  const hand = side =>
    `${side} hand ${facts.hands[side].level}, ${facts.hands[side].forward} cm ahead of the chest, elbow bent ${facts.elbows[side]}°`
  const foot = side =>
    `${side} foot ${facts.feet[side]}${facts.feet[side] === 'planted' ? '' : ' cm'}, knee bent ${facts.knees[side]}°`
  const lean =
    facts.spine.forward >= 0 ? `leans forward ${facts.spine.forward}°` : `leans back ${-facts.spine.forward}°`
  return [
    hand('right'),
    hand('left'),
    lean,
    facts.crouch > 5 ? `crouched ${facts.crouch} cm` : 'standing tall',
    foot('left'),
    foot('right'),
    `weight ${facts.weight}`
  ].join('; ')
}

/** How far apart two positions are, in metres. */
export const distanceBetween = (first, second) => lengthOf(subtract(first, second))
