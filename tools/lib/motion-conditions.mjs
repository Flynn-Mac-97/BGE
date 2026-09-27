/**
 * Constraints for a kimodo generation: where a hand or foot must be, a pose to
 * hold, the ground path to keep. Turned into the features and mask
 * `kmd-generate --observed` reads, by the rules of upstream Kimodo's
 * `constraints.py`.
 *
 * A constraint file is one record:
 *
 *   {
 *     "template": "slash",           stored motion the body placement is read from (only pose, root and joint need it)
 *     "scale": 1.1,                  joint positions are multiplied by it (model metres to capture metres)
 *     "constraints": [
 *       { "kind": "pose", "at": [0, 1.73] },          the template's whole body at these seconds
 *       { "kind": "pose", "at": [0, 1.9], "from": 0 }, its body at 0 s, held at both: start and end in one stance
 *       { "kind": "root" },                           the template's ground path and heading, every frame
 *       { "kind": "path", "heading": 0,               a ground path [x, z] as curve keys, every frame from the
 *         "keys": [{ "at": 0, "value": [0, 0] }, { "at": 3, "value": [0, 4.2] }] }   first key to the last
 *       { "kind": "joint", "joint": "RightHand",      a hand or foot at these points
 *         "keys": [{ "at": 1, "value": [-0.5, 1.5, -0.05] }] }
 *       { "kind": "body", "keys": [{ "at": 1,         the hips, spine and head at these times: any of
 *         "height": 0.8, "heading": 0.3,              hips height in metres, body heading in radians,
 *         "torso": [0.3, 0.5, 0], "head": [0.5, 0.3, 0] }] }   torso and head turns [yaw, pitch, roll]
 *     ]
 *   }
 *
 * Times are seconds, as curve keys give them. A joint `value` is in the
 * capture's space with the hips' ground point as origin: metres, Y up, +Z the
 * way the body faces at heading 0, -X its right. That is a game model's own
 * space when its clips play without root motion, so a Worn Gear path's keys
 * are a joint constraint's keys once scaled.
 *
 * A `path` keeps the ground point under the hips on that curve, and the heading
 * too when `heading` (radians, 0 faces +Z) is given: a walk that goes straight
 * at the speed the game moves the body, so the feet do not slide.
 *
 * Upstream rules kept here: every constraint but `path` also fixes the ground point, the
 * hips height and the heading at its frames, read from the template. A joint
 * constraint fixes the positions of its chain (a hand and its middle finger
 * tip), moved together, and the template's turn of the hand itself.
 *
 * A `body` key's turns are from the rest T-pose, in radians: yaw about Y
 * (positive turns the front toward +X, the body's left), then pitch about X
 * (positive tips forward and down), then roll about Z. `torso` places the
 * spine, neck, head and shoulders by turning the skeleton's own rest offsets
 * about the hips, and turns the chest; `head` turns the head. The points come
 * from the capture skeleton, not the model's, so a model whose chest is higher
 * does not ask the spine to stretch.
 */
import { SKELETONS } from './motion-clip.mjs'
import { makeCurve } from '../../engine/curves.js'

/** Per skeleton: the hips as [right, left], and each hand's and foot's chain, base first. */
const LIMBS = {
  'soma-30': {
    hips: ['RightLeg', 'LeftLeg'],
    torso: ['Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'LeftShoulder', 'LeftArm', 'RightShoulder', 'RightArm'],
    chest: 'Chest',
    head: 'Head',
    chains: {
      LeftFoot: ['LeftFoot', 'LeftToeBase'],
      RightFoot: ['RightFoot', 'RightToeBase'],
      LeftHand: ['LeftHand', 'LeftHandMiddleEnd'],
      RightHand: ['RightHand', 'RightHandMiddleEnd']
    }
  },
  'smplx-22': {
    hips: ['right_hip', 'left_hip'],
    torso: ['spine1', 'spine2', 'spine3', 'neck', 'head', 'left_collar', 'left_shoulder', 'right_collar', 'right_shoulder'],
    chest: 'spine3',
    head: 'head',
    chains: {
      LeftFoot: ['left_ankle', 'left_foot'],
      RightFoot: ['right_ankle', 'right_foot'],
      LeftHand: ['left_wrist'],
      RightHand: ['right_wrist']
    }
  },
  'g1-34': {
    hips: ['right_hip_pitch_skel', 'left_hip_pitch_skel'],
    chains: {
      LeftFoot: ['left_ankle_roll_skel', 'left_toe_base'],
      RightFoot: ['right_ankle_roll_skel', 'right_toe_base'],
      LeftHand: ['left_wrist_yaw_skel', 'left_hand_roll_skel'],
      RightHand: ['right_wrist_yaw_skel', 'right_hand_roll_skel']
    }
  }
}

/** What each constraint kind fixes, given the condition being filled and the constraint. */
const KINDS = {
  pose: (condition, constraint) => {
    const [source] = constraint.from === undefined ? [null] : framesAt(condition, [constraint.from])
    for (const frame of framesAt(condition, constraint.at)) {
      const posed = condition.posedAt(source ?? frame)
      keepPlacement(condition, frame, posed)
      posed.positions.forEach((position, joint) => keepPosition(condition, frame, joint, position, posed))
    }
  },
  root: condition => {
    for (let frame = 0; frame < condition.frames; frame++) keepGround(condition, frame, condition.posedAt(frame))
  },
  path: (condition, constraint) => {
    const curve = makeCurve(constraint.keys)
    const [first, last] = framesAt(condition, [constraint.keys[0].at, curve.duration])
    for (let frame = first; frame <= last; frame++) {
      const [x, z] = curve.valueAt(frame / condition.framesPerSecond)
      keep(condition, frame, 0, x)
      keep(condition, frame, 2, z)
      if (constraint.heading === undefined) continue
      keep(condition, frame, 3, Math.cos(constraint.heading))
      keep(condition, frame, 4, Math.sin(constraint.heading))
    }
  },
  joint: (condition, constraint) => {
    const chain = LIMBS[condition.skeleton].chains[constraint.joint]
    if (!chain) throw new Error(`joint must be one of ${Object.keys(LIMBS[condition.skeleton].chains).join(', ')}`)
    const joints = chain.map(name => condition.names.indexOf(name))
    for (const key of constraint.keys) {
      const [frame] = framesAt(condition, [key.at])
      const posed = condition.posedAt(frame)
      keepPlacement(condition, frame, posed)
      const base = posed.positions[joints[0]]
      const wanted = [key.value[0] * condition.scale + posed.ground[0], key.value[1] * condition.scale, key.value[2] * condition.scale + posed.ground[1]]
      const shift = wanted.map((value, axis) => value - base[axis])
      for (const joint of joints) keepPosition(condition, frame, joint, posed.positions[joint].map((value, axis) => value + shift[axis]), posed)
      keepTurn(condition, frame, joints[0], posed.turns[joints[0]])
    }
  },
  body: (condition, constraint) => {
    const limbs = LIMBS[condition.skeleton]
    if (!limbs.torso) throw new Error(`the ${condition.skeleton} skeleton has no body constraint`)
    for (const key of constraint.keys) {
      const [frame] = framesAt(condition, [key.at])
      const posed = condition.posedAt(frame)
      keepPlacement(condition, frame, posed)
      const height = key.height === undefined ? posed.positions[0][1] : key.height * condition.scale
      const hips = [posed.ground[0], height, posed.ground[1]]
      keep(condition, frame, 1, height)
      keepPosition(condition, frame, 0, hips, posed)
      if (key.heading !== undefined) {
        keep(condition, frame, 3, Math.cos(key.heading))
        keep(condition, frame, 4, Math.sin(key.heading))
      }
      if (key.torso) {
        const turn = turnOf(key.torso)
        const rest = restPositions(condition.skeleton)
        for (const joint of limbs.torso.map(name => condition.names.indexOf(name))) {
          const offset = applied(turn, rest[joint].map((value, axis) => value - rest[0][axis]))
          keepPosition(condition, frame, joint, offset.map((value, axis) => value + hips[axis]), posed)
        }
        keepTurn(condition, frame, condition.names.indexOf(limbs.chest), turn)
      }
      if (key.head) keepTurn(condition, frame, condition.names.indexOf(limbs.head), turnOf(key.head))
    }
  }
}

/** Kinds filled after the rest, because every other kind sets the hips height and heading from the template at its frames. */
const FILLED_LAST = new Set(['body'])

/**
 * The condition for one generation: `{ observed, mask, firstHeading }`, the
 * first two float32 `[frames, 9 + 12 * joints]`. `template` is stored motion
 * (`readSource`) of the same skeleton, or null when no constraint reads one;
 * `frames` and `framesPerSecond` are the generation's. The first heading is the
 * template's at frame 0, else the first path heading, else 0.
 */
export function motionCondition({ skeleton, frames, framesPerSecond, template, record }) {
  const names = SKELETONS[skeleton].names
  if (template && template.joints !== names.length) throw new Error(`template has ${template.joints} joints, ${skeleton} has ${names.length}`)
  const width = 9 + 12 * names.length
  const posedFrames = new Map()
  const condition = {
    skeleton,
    names,
    frames,
    framesPerSecond,
    width,
    scale: record.scale ?? 1,
    observed: new Float32Array(frames * width),
    mask: new Float32Array(frames * width),
    posedAt: frame => {
      if (!template) throw new Error('pose, root and joint constraints read a template: name one')
      if (frame >= template.frames) throw new Error(`frame ${frame} is past the template's ${template.frames}`)
      if (!posedFrames.has(frame)) posedFrames.set(frame, posedFrame(skeleton, template, frame))
      return posedFrames.get(frame)
    }
  }
  const ordered = [
    ...record.constraints.filter(constraint => !FILLED_LAST.has(constraint.kind)),
    ...record.constraints.filter(constraint => FILLED_LAST.has(constraint.kind))
  ]
  for (const constraint of ordered) {
    const fill = KINDS[constraint.kind]
    if (!fill) throw new Error(`constraint kind "${constraint.kind}" is not one of ${Object.keys(KINDS).join(', ')}`)
    fill(condition, constraint)
  }
  const pathHeading = record.constraints.find(constraint => constraint.kind === 'path')?.heading ?? 0
  return { observed: condition.observed, mask: condition.mask, firstHeading: template ? condition.posedAt(0).heading : pathHeading }
}

/** Frame numbers for times in seconds, refused when one is outside the generation. */
function framesAt(condition, seconds) {
  return seconds.map(time => {
    const frame = Math.round(time * condition.framesPerSecond)
    if (frame < 0 || frame >= condition.frames) throw new Error(`${time} s is frame ${frame}, outside 0..${condition.frames - 1}`)
    return frame
  })
}

function keep(condition, frame, dimension, value) {
  condition.observed[frame * condition.width + dimension] = value
  condition.mask[frame * condition.width + dimension] = 1
}

/** The ground point and heading: upstream's `root2d` with a heading. */
function keepGround(condition, frame, posed) {
  keep(condition, frame, 0, posed.ground[0])
  keep(condition, frame, 2, posed.ground[1])
  keep(condition, frame, 3, Math.cos(posed.heading))
  keep(condition, frame, 4, Math.sin(posed.heading))
}

/** The ground point, heading and hips height, which every pose and joint constraint also fixes. */
function keepPlacement(condition, frame, posed) {
  keepGround(condition, frame, posed)
  keep(condition, frame, 1, posed.positions[0][1])
}

/** A joint's world position, stored relative to the ground point as the features hold it. */
function keepPosition(condition, frame, joint, position, posed) {
  keep(condition, frame, 5 + joint * 3, position[0] - posed.ground[0])
  keep(condition, frame, 6 + joint * 3, position[1])
  keep(condition, frame, 7 + joint * 3, position[2] - posed.ground[1])
}

/** A joint's world turn as its first two matrix columns, the features' `cont6`. */
function keepTurn(condition, frame, joint, matrix) {
  const start = 5 + condition.names.length * 3 + joint * 6
  for (let index = 0; index < 6; index++) keep(condition, frame, start + index, matrix[(index % 3) * 3 + Math.floor(index / 3)])
}

/**
 * One template frame posed: every joint's world position and turn (a row-major
 * 3×3 matrix), the ground point [x, z] under the hips, and the heading from the
 * hips as upstream measures it.
 */
function posedFrame(skeleton, template, frame) {
  const { names, parents, offsets } = SKELETONS[skeleton]
  const turns = []
  const positions = []
  names.forEach((name, joint) => {
    const at = (frame * names.length + joint) * 4
    const local = matrixOf(template.rotations.slice(at, at + 4))
    const parent = parents[joint]
    if (parent < 0) {
      turns.push(local)
      positions.push(Array.from(template.root.slice(frame * 3, frame * 3 + 3)))
      return
    }
    turns.push(product(turns[parent], local))
    positions.push(applied(turns[parent], offsets[joint]).map((value, axis) => value + positions[parent][axis]))
  })
  const [right, left] = LIMBS[skeleton].hips.map(name => positions[names.indexOf(name)])
  return {
    positions,
    turns,
    ground: [positions[0][0], positions[0][2]],
    heading: Math.atan2(right[2] - left[2], -(right[0] - left[0]))
  }
}

/** Every joint's position in the rest T-pose, where each joint's turn is the identity: its offsets summed. */
function restPositions(skeleton) {
  const { parents, offsets } = SKELETONS[skeleton]
  const positions = []
  offsets.forEach((offset, joint) => {
    const parent = parents[joint]
    positions.push(parent < 0 ? [0, 0, 0] : offset.map((value, axis) => value + positions[parent][axis]))
  })
  return positions
}

/** A turn from [yaw, pitch, roll] in radians as a row-major 3×3 matrix: yaw about Y, then pitch about X, then roll about Z. */
function turnOf([yaw = 0, pitch = 0, roll = 0]) {
  const about = (angle, cells) => cells(Math.cos(angle), Math.sin(angle))
  const aboutY = about(yaw, (cosine, sine) => [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine])
  const aboutX = about(pitch, (cosine, sine) => [1, 0, 0, 0, cosine, -sine, 0, sine, cosine])
  const aboutZ = about(roll, (cosine, sine) => [cosine, -sine, 0, sine, cosine, 0, 0, 0, 1])
  return product(product(aboutY, aboutX), aboutZ)
}

/** A unit quaternion [x, y, z, w] as a row-major 3×3 matrix. */
function matrixOf([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
  ]
}

const product = (first, second) =>
  Array.from({ length: 9 }, (unused, cell) => {
    const row = Math.floor(cell / 3)
    const column = cell % 3
    return first[row * 3] * second[column] + first[row * 3 + 1] * second[3 + column] + first[row * 3 + 2] * second[6 + column]
  })

const applied = (matrix, vector) =>
  [0, 1, 2].map(row => matrix[row * 3] * vector[0] + matrix[row * 3 + 1] * vector[1] + matrix[row * 3 + 2] * vector[2])
