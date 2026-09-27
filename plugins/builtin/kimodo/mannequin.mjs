/**
 * Kimodo's mannequin: a body made from Kimodo's own soma-30 skeleton, so a
 * take is watched and designed on the bones Kimodo solves, not on a game's
 * model. Node only; it writes a .glb and the bone map that retargets onto it.
 *
 * Each joint keeps its soma-30 rest offset, and nine are renamed to the names
 * the designer and Rig Animation find limbs by (soma's `LeftLeg` is a thigh;
 * everywhere else here `LeftLeg` is a shin). The spine, neck, head and
 * shoulders rest in soma's standing turns (`skeleton-neutral.json`), because
 * the retarget measures motion from that stance; with the same rest, the
 * retarget through `mannequinMap()` gives back Kimodo's own pose. The hips
 * rest as high as the lowest joint is below them, so the feet are at 0, as
 * Kimodo's body and joint keys are measured.
 *
 * Each bone is one flat grey box from its joint toward the joint it points
 * at, drawn on the joint's own node, so the glb has one node per joint and no
 * skin.
 */
import { SKELETONS } from '../../../tools/lib/motion-clip.mjs'
import { neutralFor } from '../../../tools/lib/retarget.mjs'
import { multiply, rotate } from '../game-maths/turns.js'
import { add, cross, scaled, unit } from '../game-maths/space.js'

const SOMA = SKELETONS['soma-30']
const STANDING = neutralFor('soma-30')

/** Soma-30 names the mannequin gives a different name. */
const RENAMED = {
  Spine1: 'Spine',
  Spine2: 'Spine1',
  Chest: 'Spine2',
  Neck1: 'Neck',
  Neck2: 'Neck1',
  LeftLeg: 'LeftUpLeg',
  LeftShin: 'LeftLeg',
  RightLeg: 'RightUpLeg',
  RightShin: 'RightLeg'
}

const nodeName = joint => RENAMED[joint] ?? joint

/** How far the lowest joint is below the hips at rest, in metres. */
function hipsHeight() {
  const turns = []
  const places = []
  SOMA.names.forEach((joint, index) => {
    const parent = SOMA.parents[index]
    const turn = STANDING[joint] ?? [0, 0, 0, 1]
    turns[index] = parent < 0 ? turn : multiply(turns[parent], turn)
    places[index] = parent < 0 ? [0, 0, 0] : rotate(turns[parent], SOMA.offsets[index]).map((value, axis) => value + places[parent][axis])
  })
  return -Math.min(...places.map(place => place[1]))
}

/**
 * Per soma joint: the joint its box points at and the box's width and depth
 * in metres. A joint not listed has no box: eyes, jaw and finger tips. The
 * head box points up, past the top of the skeleton, which ends at the head
 * joint; a toe box points forward.
 */
const BONES = {
  Hips: { to: 'Spine1', width: 0.26, depth: 0.16 },
  Spine1: { to: 'Spine2', width: 0.24, depth: 0.15 },
  Spine2: { to: 'Chest', width: 0.26, depth: 0.16 },
  Chest: { to: 'Neck1', width: 0.3, depth: 0.18 },
  Neck1: { to: 'Neck2', width: 0.08, depth: 0.08 },
  Neck2: { to: 'Head', width: 0.08, depth: 0.08 },
  Head: { end: [0, 0.22, 0], width: 0.16, depth: 0.19 },
  LeftShoulder: { to: 'LeftArm', width: 0.07, depth: 0.07 },
  LeftArm: { to: 'LeftForeArm', width: 0.08, depth: 0.08 },
  LeftForeArm: { to: 'LeftHand', width: 0.07, depth: 0.07 },
  LeftHand: { to: 'LeftHandMiddleEnd', width: 0.08, depth: 0.03 },
  RightShoulder: { to: 'RightArm', width: 0.07, depth: 0.07 },
  RightArm: { to: 'RightForeArm', width: 0.08, depth: 0.08 },
  RightForeArm: { to: 'RightHand', width: 0.07, depth: 0.07 },
  RightHand: { to: 'RightHandMiddleEnd', width: 0.08, depth: 0.03 },
  LeftLeg: { to: 'LeftShin', width: 0.12, depth: 0.12 },
  LeftShin: { to: 'LeftFoot', width: 0.1, depth: 0.1 },
  LeftFoot: { to: 'LeftToeBase', width: 0.09, depth: 0.07 },
  LeftToeBase: { end: [0, 0, 0.06], width: 0.09, depth: 0.04 },
  RightLeg: { to: 'RightShin', width: 0.12, depth: 0.12 },
  RightShin: { to: 'RightFoot', width: 0.1, depth: 0.1 },
  RightFoot: { to: 'RightToeBase', width: 0.09, depth: 0.07 },
  RightToeBase: { end: [0, 0, 0.06], width: 0.09, depth: 0.04 }
}

// Leaf joints that move nothing are left out of the map, as the shelf's maps do.
const UNMAPPED = new Set(['Jaw', 'LeftEye', 'RightEye', 'LeftHandThumbEnd', 'LeftHandMiddleEnd', 'RightHandThumbEnd', 'RightHandMiddleEnd'])

/**
 * The bone map from soma-30 onto the mannequin, in the shape of
 * `tools/lib/rig-maps/*.json`. Neck comes before the shoulders, as soma
 * orders them, so the chest aims at the neck.
 */
export function mannequinMap() {
  const map = { _what: 'SOMA-30 joints onto the Kimodo mannequin, which keeps their rest pose.', _skeleton: 'soma-30' }
  for (const joint of SOMA.names) {
    if (UNMAPPED.has(joint)) continue
    map[joint] = joint === 'Chest' ? { node: nodeName(joint), aim: 'Neck1' } : { node: nodeName(joint) }
  }
  return map
}


/** Each face of a box as its outward direction and its four corners, in unit steps: [across, through, along]. */
const BOX_FACES = [
  [[1, 0, 0], [[1, -1, 0], [1, 1, 0], [1, 1, 1], [1, -1, 1]]],
  [[-1, 0, 0], [[-1, 1, 0], [-1, -1, 0], [-1, -1, 1], [-1, 1, 1]]],
  [[0, 1, 0], [[-1, 1, 0], [1, 1, 0], [1, 1, 1], [-1, 1, 1]]],
  [[0, -1, 0], [[1, -1, 0], [-1, -1, 0], [-1, -1, 1], [1, -1, 1]]],
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[-1, 1, 0], [1, 1, 0], [1, -1, 0], [-1, -1, 0]]]
]

/**
 * A box from the joint along `along`: corners, normals and indices. It is
 * `width` side to side and `depth` front to back for an upright bone; a bone
 * lying side to side takes its width up and down instead.
 */
function boxOf(along, width, depth) {
  const start = [0, 0, 0]
  const direction = unit(along)
  const side = Math.abs(direction[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
  const through = unit(cross(side, direction))
  const across = cross(direction, through)
  const axes = [scaled(across, width / 2), scaled(through, depth / 2), along]
  const place = steps => steps.reduce((point, step, axis) => add(point, scaled(axes[axis], step)), start)
  const box = { positions: [], normals: [], indices: [] }
  for (const [outward, corners] of BOX_FACES) {
    const base = box.positions.length / 3
    const facing = place(outward.map((step, axis) => (axis === 2 ? 0 : step))).map((value, axis) => value - start[axis])
    const faceNormal = outward[2] ? scaled(direction, outward[2]) : unit(facing)
    for (const corner of corners) {
      box.positions.push(...place(corner))
      box.normals.push(...faceNormal)
    }
    box.indices.push(...[0, 1, 2, 0, 2, 3].map(index => base + index))
  }
  return box
}

/** Pad a buffer to four bytes, as a glb chunk needs. */
function padded(buffer, fill) {
  const extra = (4 - (buffer.length % 4)) % 4
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer
}

/** The mannequin as .glb bytes. */
export function mannequinGlb() {
  const chunks = []
  let offset = 0
  const views = []
  const accessors = []
  /** Store one typed array as a buffer view and an accessor; answers the accessor's index. */
  const store = (array, type, componentType, target, bounds = {}) => {
    const bytes = padded(Buffer.from(array.buffer), 0)
    views.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength, target })
    chunks.push(bytes)
    offset += bytes.length
    accessors.push({ bufferView: views.length - 1, componentType, count: array.length / { VEC3: 3, SCALAR: 1 }[type], type, ...bounds })
    return accessors.length - 1
  }
  /** One primitive of a box, drawn with `material`. */
  const primitiveOf = (box, material) => {
    const bounds = axis => box.positions.filter((unused, place) => place % 3 === axis)
    return {
      attributes: {
        POSITION: store(new Float32Array(box.positions), 'VEC3', 5126, 34962, {
          min: [0, 1, 2].map(axis => Math.min(...bounds(axis))),
          max: [0, 1, 2].map(axis => Math.max(...bounds(axis)))
        }),
        NORMAL: store(new Float32Array(box.normals), 'VEC3', 5126, 34962)
      },
      indices: store(new Uint16Array(box.indices), 'SCALAR', 5123, 34963),
      material
    }
  }
  const childrenOf = joint => SOMA.parents.flatMap((parent, child) => (parent === joint ? [child] : []))
  const meshes = []
  const nodes = SOMA.names.map((joint, index) => {
    const node = {
      name: nodeName(joint),
      translation: index === 0 ? [0, hipsHeight(), 0] : SOMA.offsets[index],
      ...(STANDING[joint] ? { rotation: STANDING[joint] } : {}),
      ...(childrenOf(index).length ? { children: childrenOf(index) } : {})
    }
    const bone = BONES[joint]
    if (!bone) return node
    const end = bone.end ?? SOMA.offsets[SOMA.names.indexOf(bone.to)]
    meshes.push({ name: node.name, primitives: [primitiveOf(boxOf(end, bone.width, bone.depth), 0)] })
    return { ...node, mesh: meshes.length - 1 }
  })
  const material = (name, colour) => ({ name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: colour, metallicFactor: 0, roughnessFactor: 0.8 } })
  const document = {
    asset: { version: '2.0', generator: 'kimodo mannequin' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials: [material('mannequin', [0.62, 0.66, 0.7, 1])],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }]
  }
  const json = padded(Buffer.from(JSON.stringify(document)), 0x20)
  const binary = Buffer.concat(chunks)
  const chunkHeader = (length, kind) => {
    const bytes = Buffer.alloc(8)
    bytes.writeUInt32LE(length, 0)
    bytes.writeUInt32LE(kind, 4)
    return bytes
  }
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8)
  return Buffer.concat([header, chunkHeader(json.length, 0x4e4f534a), json, chunkHeader(binary.length, 0x004e4942), binary])
}
