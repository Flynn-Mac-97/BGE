/**
 * Turn captured joint rotations into a rig clip the engine can play.
 *
 * The shelf's half of Rig Animation. A motion generator writes two raw float32
 * buffers — local rotations `[frames, joints, 4]` as x,y,z,w and root positions
 * `[frames, 3]`. This reads them, renames the joints to the target model's node
 * names, and writes the clip file `plugins/builtin/rig-animation.js` reads.
 *
 * Nothing here knows which generator produced the buffers. Kimodo is one; a
 * capture exported from anywhere else with the same layout works unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'
import { planRetarget, retargetFrame, captureWorldTurns, meanHeading, retargetOrder, neutralFor, multiply } from './retarget.mjs'

/**
 * The skeletons kimodo.cpp emits: joint names, parent indices and bind-pose
 * offsets, each in the buffer's own joint order.
 *
 * Extracted from `src/skeleton.hpp` by `tools/extract-kimodo-skeletons.mjs`.
 * Run that again when a model version changes; a transposed row poses the wrong
 * limb and nothing reports it.
 */
export const SKELETONS = JSON.parse(
  fs.readFileSync(new URL('./skeletons.json', import.meta.url), 'utf8')
)

/** How many joints each skeleton has, which is how a buffer is identified. */
export const skeletonFor = joints =>
  Object.entries(SKELETONS).find(([, one]) => one.names.length === joints)?.[0] || null

/** A raw little-endian float32 file as numbers. */
export function readFloats(file) {
  const bytes = fs.readFileSync(file)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

/** A quarter turn about X, which is the whole of a Z-up to Y-up conversion. */
const Z_UP_TO_Y_UP = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]

/**
 * Build a clip from raw buffers.
 *
 * `map` renames joints: `{ 'LeftArm': 'arm_left' }`, or
 * `{ 'LeftArm': { node: 'arm_left', offset: [x, y, z, w] } }` when the target
 * rig rests in a different pose and every frame needs the same correction.
 * `model` is a skeleton from `readModelSkeleton`. With it, the map is read by
 * `retarget.mjs`: each entry takes one joint, and rest poses decide the turn.
 * `cycle` keeps only the frames that loop best. `standing: false` measures the
 * spine from the capture's straight bind rather than its standing stance.
 *
 * With a map, only the joints it names reach the clip — a rig with six hinges
 * does not need thirty.
 */
export function buildClip({
  rotations, root, joints, frames,
  skeleton, map = null, upAxis = 'y', rootScale = 1,
  framesPerSecond = 30, loop = true, decimals = 4, name = 'clip', source = null,
  model = null, cycle = false, standing = true
}) {
  const names = SKELETONS[skeleton]?.names
  if (!names) throw new Error(`unknown skeleton ${skeleton} — one of ${Object.keys(SKELETONS).join(', ')}`)
  if (names.length !== joints) throw new Error(`${skeleton} has ${names.length} joints, the buffer has ${joints}`)

  if (model && !map) throw new Error('retargeting onto a model needs a map')
  const wanted = model ? null : targetsIn(map, names)
  const plan = model ? planRetarget({ map, skeleton: SKELETONS[skeleton], model, neutral: standing ? neutralFor(skeleton) : null }) : null
  const modelOrder = model ? retargetOrder(plan, model) : null

  const round = value => Number(value.toFixed(decimals))
  const outputRotations = []
  const outputPositions = {}
  const outputRoot = []

  const readJoint = (frame, index) => {
    const at = (frame * joints + index) * 4
    const turn = [rotations[at], rotations[at + 1], rotations[at + 2], rotations[at + 3]]
    // Only the root joint carries the world's up axis; every other rotation is
    // local to its parent and is already right.
    return upAxis === 'z' && index === 0 ? multiply(Z_UP_TO_Y_UP, turn) : turn
  }
  const readFrame = frame => names.map((_, index) => readJoint(frame, index))
  const heading = model ? meanHeading(Array.from({ length: frames }, (_, frame) => readJoint(frame, 0))) : 0

  for (let frame = 0; frame < frames; frame++) {
    const rootHeight = root ? (upAxis === 'z' ? root[frame * 3 + 2] : root[frame * 3 + 1]) * rootScale : null
    const placed = model
      ? retargetFrame(plan, model, captureWorldTurns(readFrame(frame), SKELETONS[skeleton], heading), modelOrder, rootHeight)
      : null
    const plannedNodes = model ? [...plan, ...plan.followers].map(entry => entry.node) : null
    placed?.forEach((one, index) => {
      if (!one.position) return
      const node = plannedNodes[index]
      ;(outputPositions[node] ||= []).push(one.position.map(round))
    })
    const turns = model
      ? placed.map(one => one.rotation)
      : wanted.map(target => {
          // Several sources compose into one node: a rig with one torso bone gets
          // the whole spine chain, which a single joint of it would understate.
          const turn = target.sources.map(index => readJoint(frame, index)).reduce(multiply)
          return target.offset ? multiply(turn, target.offset) : turn
        })
    outputRotations.push(turns.flatMap(turn => turn.map(round)))

    if (!root) continue
    const at = frame * 3
    const position = upAxis === 'z'
      ? [root[at], root[at + 2], -root[at + 1]]
      : [root[at], root[at + 1], root[at + 2]]
    outputRoot.push(position.map(value => round(value * rootScale)))
  }

  const window = cycle ? loopWindow(outputRotations) : { first: 0, last: frames }
  // A cycle's window ends one frame before the pose it returns to. That frame
  // is kept only to close the loop, then dropped.
  const loopRotations = cycle ? closeQuaternionLoop(outputRotations.slice(window.first, window.last + 1)) : outputRotations
  const loopPositions = list => (cycle ? closeVectorLoop(list.slice(window.first, window.last + 1)) : list)
  return {
    name,
    framesPerSecond,
    loop,
    nodes: model ? [...plan, ...plan.followers].map(entry => entry.node) : wanted.map(one => one.node),
    rotations: cycle ? loopRotations.map(frame => frame.map(round)) : loopRotations,
    positions: Object.keys(outputPositions).length
      ? Object.fromEntries(Object.entries(outputPositions).map(([node, list]) => [node, cycle ? loopPositions(list).map(frame => frame.map(round)) : list]))
      : null,
    root: outputRoot.length ? outputRoot.slice(window.first, window.last) : null,
    // The capture frames kept, so a clip frame can be matched to its source frame.
    source: source && cycle ? { ...source, kept: [window.first, window.last] } : source
  }
}

/**
 * The frames that loop with the smallest jump back to the start.
 *
 * A generated clip is not a cycle: its last frame is not its first. This picks
 * the pair of frames whose poses match best, at least `shortest` frames apart,
 * and keeps the frames from the first up to the one before the second.
 */
export function loopWindow(rotations, shortest = 24) {
  let best = { first: 0, last: rotations.length, cost: Infinity }
  for (let first = 0; first < rotations.length; first++) {
    for (let last = first + shortest; last < rotations.length; last++) {
      const cost = poseDistance(rotations[first], rotations[last])
      // A longer window at the same cost keeps more of the motion.
      if (cost < best.cost - 1e-4 || (cost < best.cost + 1e-4 && last - first > best.last - best.first)) {
        best = { first, last, cost }
      }
    }
  }
  return best
}

/**
 * Spread a loop's jump back to its start evenly over the whole loop.
 *
 * `frames` runs one past the loop: its last frame is the pose the loop returns
 * to, which should equal its first. Frame `i` of `n` is moved back by `i / n`
 * of the difference, so the last kept frame flows into the first with no pop.
 * Each quaternion is taken on the first frame's side before the difference and
 * normalized after. The returned list drops the closing frame.
 */
export function closeQuaternionLoop(frames) {
  const count = frames.length - 1
  const start = frames[0]
  const end = alignedTo(start, frames[count])
  return frames.slice(0, count).map((frame, index) => {
    const aligned = alignedTo(start, frame)
    const share = index / count
    return normalizeEach(aligned.map((value, at) => value - (end[at] - start[at]) * share))
  })
}

/** The same closing for a list of `[x, y, z]` positions. */
export function closeVectorLoop(frames) {
  const count = frames.length - 1
  const start = frames[0]
  const end = frames[count]
  return frames.slice(0, count).map((frame, index) => frame.map((value, axis) => value - (end[axis] - start[axis]) * (index / count)))
}

/** Each quaternion of `frame` flipped where needed to lie on the same side as `reference`'s. */
function alignedTo(reference, frame) {
  const out = frame.slice()
  for (let at = 0; at < frame.length; at += 4) {
    const dot = reference[at] * frame[at] + reference[at + 1] * frame[at + 1] + reference[at + 2] * frame[at + 2] + reference[at + 3] * frame[at + 3]
    if (dot < 0) for (let part = at; part < at + 4; part++) out[part] = -frame[part]
  }
  return out
}

/** Every quaternion in a flat frame scaled back to length one. */
function normalizeEach(frame) {
  for (let at = 0; at < frame.length; at += 4) {
    const length = Math.hypot(frame[at], frame[at + 1], frame[at + 2], frame[at + 3])
    for (let part = at; part < at + 4; part++) frame[part] /= length
  }
  return frame
}

/** Summed angle-like distance between two frames of quaternions. */
function poseDistance(a, b) {
  let total = 0
  for (let at = 0; at < a.length; at += 4) {
    total += 1 - Math.abs(a[at] * b[at] + a[at + 1] * b[at + 1] + a[at + 2] * b[at + 2] + a[at + 3] * b[at + 3])
  }
  return total
}

/**
 * Every node the clip will carry: its name, which joints feed it, and any
 * standing correction.
 *
 * Without a map, every joint keeps its own name. With one, the map's own order
 * is the clip's order, and a key beginning `_` is a note rather than a joint.
 */
function targetsIn(map, names) {
  if (!map) return names.map((name, index) => ({ node: name, sources: [index], offset: null }))

  const indexOf = new Map(names.map((name, index) => [name, index]))
  const targets = []
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith('_')) continue
    const entry = typeof value === 'string' ? { node: value } : value
    if (!entry?.node) throw new Error(`map entry ${key} has no node name`)
    const sources = (entry.from || [key]).map(jointName => {
      if (!indexOf.has(jointName)) throw new Error(`map names joint ${jointName}, which this skeleton has not got`)
      return indexOf.get(jointName)
    })
    targets.push({ node: entry.node, sources, offset: entry.offset || null })
  }
  return targets
}

/**
 * Write a clip, one frame to a line.
 *
 * `JSON.stringify` with an indent puts every number on its own line, which is
 * fifty thousand lines for a short clip and unreadable in a diff. One line per
 * frame is the form a person and an agent can both scan.
 */
export function writeClip(file, clip) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const rows = frames => frames.map(frame => '    ' + JSON.stringify(frame)).join(',\n')
  const lines = [
    '{',
    `  "name": ${JSON.stringify(clip.name)},`,
    `  "framesPerSecond": ${clip.framesPerSecond},`,
    `  "loop": ${clip.loop},`,
    `  "nodes": ${JSON.stringify(clip.nodes)},`,
    `  "source": ${JSON.stringify(clip.source)},`,
    '  "rotations": [',
    rows(clip.rotations),
    clip.positions || clip.root ? '  ],' : '  ]'
  ]
  if (clip.positions) {
    const nodes = Object.entries(clip.positions)
    lines.push('  "positions": {')
    nodes.forEach(([node, frames], index) => {
      lines.push(`    ${JSON.stringify(node)}: [`, rows(frames).replace(/^ {4}/gm, '      '), index < nodes.length - 1 ? '    ],' : '    ]')
    })
    lines.push(clip.root ? '  },' : '  }')
  }
  if (clip.root) lines.push('  "root": [', rows(clip.root), '  ]')
  lines.push('}', '')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}
