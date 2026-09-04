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

/** Quaternion product, both x,y,z,w. */
export function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ]
}

/** A quarter turn about X, which is the whole of a Z-up to Y-up conversion. */
const Z_UP_TO_Y_UP = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]

/**
 * Build a clip from raw buffers.
 *
 * `map` renames joints: `{ 'LeftArm': 'arm_left' }`, or
 * `{ 'LeftArm': { node: 'arm_left', offset: [x, y, z, w] } }` when the target
 * rig rests in a different pose and every frame needs the same correction.
 * With a map, only the joints it names reach the clip — a rig with six hinges
 * does not need thirty.
 */
export function buildClip({
  rotations, root, joints, frames,
  skeleton, map = null, upAxis = 'y', rootScale = 1,
  framesPerSecond = 30, loop = true, decimals = 4, name = 'clip', source = null
}) {
  const names = SKELETONS[skeleton]?.names
  if (!names) throw new Error(`unknown skeleton ${skeleton} — one of ${Object.keys(SKELETONS).join(', ')}`)
  if (names.length !== joints) throw new Error(`${skeleton} has ${names.length} joints, the buffer has ${joints}`)

  const wanted = targetsIn(map, names)

  const round = value => Number(value.toFixed(decimals))
  const outputRotations = []
  const outputRoot = []

  const readJoint = (frame, index) => {
    const at = (frame * joints + index) * 4
    const turn = [rotations[at], rotations[at + 1], rotations[at + 2], rotations[at + 3]]
    // Only the root joint carries the world's up axis; every other rotation is
    // local to its parent and is already right.
    return upAxis === 'z' && index === 0 ? multiply(Z_UP_TO_Y_UP, turn) : turn
  }

  for (let frame = 0; frame < frames; frame++) {
    const line = []
    for (const target of wanted) {
      // Several sources compose into one node: a rig with one torso bone gets
      // the whole spine chain, which a single joint of it would understate.
      let turn = target.sources.map(index => readJoint(frame, index)).reduce(multiply)
      if (target.offset) turn = multiply(turn, target.offset)
      line.push(round(turn[0]), round(turn[1]), round(turn[2]), round(turn[3]))
    }
    outputRotations.push(line)

    if (!root) continue
    const at = frame * 3
    const position = upAxis === 'z'
      ? [root[at], root[at + 2], -root[at + 1]]
      : [root[at], root[at + 1], root[at + 2]]
    outputRoot.push(position.map(value => round(value * rootScale)))
  }

  return {
    name,
    framesPerSecond,
    loop,
    nodes: wanted.map(one => one.node),
    rotations: outputRotations,
    root: outputRoot.length ? outputRoot : null,
    source
  }
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
    clip.root ? '  ],' : '  ]'
  ]
  if (clip.root) lines.push('  "root": [', rows(clip.root), '  ]')
  lines.push('}', '')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}
