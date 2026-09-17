/**
 * Retarget captured motion onto a model's own skeleton, using the model's rest pose.
 *
 * A plain map copies each joint's local rotation, which is right only when both
 * skeletons rest with the same bone axes. A real rig does not: a Rigify bone
 * points along its own Y, and its arms may rest down where the capture's rest
 * straight out. This path works in model space instead. Each mapped bone takes
 * the capture joint's world turn, applied after the rotation that lays the
 * bone's rest direction along the joint's rest direction. Its local rotation is
 * then whatever that world turn needs under its parent, so any hierarchy works,
 * including bones parented to bones the map never names.
 *
 * Both skeletons must be Y-up and face the same way. Kimodo's SOMA faces +Z, and
 * so does a Blender model built facing -Y, once exported Y-up.
 */
import fs from 'node:fs'

// ------------------------------------------------------------------ quaternions, x,y,z,w

export const multiply = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
]

const inverse = turn => [-turn[0], -turn[1], -turn[2], turn[3]]

const IDENTITY = [0, 0, 0, 1]

/** Each capture skeleton's standing stance, by name. See the file's `_what`. */
const NEUTRAL = JSON.parse(fs.readFileSync(new URL('./skeleton-neutral.json', import.meta.url), 'utf8'))
export const neutralFor = skeletonName => NEUTRAL[skeletonName] || null

/** Metres from the capture's centre line within which a joint is on the midline. */
const MIDLINE = 0.01

function normalise(turn) {
  const length = Math.hypot(...turn) || 1
  return turn.map(value => value / length)
}

function rotate(turn, vector) {
  const moved = multiply(multiply(turn, [...vector, 0]), inverse(turn))
  return [moved[0], moved[1], moved[2]]
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** The shortest turn that lays direction `from` along direction `to`. */
export function turnBetween(from, to) {
  const a = normalise(from)
  const b = normalise(to)
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  if (dot < -0.999999) {
    // Opposite: any axis at right angles to `a` is a half turn.
    const axis = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]]
    return normalise([...axis, 0])
  }
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  return normalise([...cross, 1 + dot])
}

/** A turn with its part about Y removed, so a clip does not carry the capture's facing. */
function withoutHeading(turn, heading) {
  const half = -heading / 2
  return multiply([0, Math.sin(half), 0, Math.cos(half)], turn)
}

/** The angle about Y that a turn faces +Z towards. */
function headingOf(turn) {
  const forward = rotate(turn, [0, 0, 1])
  return Math.atan2(forward[0], forward[2])
}

// ------------------------------------------------------------------ the model's skeleton

/**
 * Every node of a .glb in its rest pose: name, parent index, local rotation and
 * translation, and its rest world rotation and position in model space.
 */
export function readModelSkeleton(file) {
  const bytes = fs.readFileSync(file)
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a .glb`)
  const length = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'))
  const nodes = document.nodes.map((node, index) => {
    if (node.matrix) throw new Error(`${file} node ${node.name || index} stores a matrix; export it as TRS`)
    return {
      name: node.name || `node${index}`,
      parent: -1,
      rotation: node.rotation || IDENTITY,
      translation: node.translation || [0, 0, 0],
      scale: node.scale ? node.scale[0] : 1
    }
  })
  document.nodes.forEach((node, index) => (node.children || []).forEach(child => { nodes[child].parent = index }))
  // A skin joint deforms the mesh; a node outside every skin is a control or helper.
  for (const skin of document.skins || []) for (const joint of skin.joints) nodes[joint].joint = true
  return withRestWorld(nodes)
}

/** Adds rest world rotation, scale and position to nodes that carry local ones and a parent index. */
export function withRestWorld(nodes) {
  for (const index of parentsFirst(nodes)) {
    const node = nodes[index]
    const parent = nodes[node.parent]
    node.worldRotation = parent ? multiply(parent.worldRotation, node.rotation) : node.rotation
    node.worldScale = (parent ? parent.worldScale : 1) * node.scale
    node.worldPosition = parent
      ? add(parent.worldPosition, rotate(parent.worldRotation, node.translation.map(value => value * parent.worldScale)))
      : node.translation
  }
  return nodes
}

/** Node indices ordered so that every parent comes before its children. */
function parentsFirst(nodes) {
  const order = []
  const visit = index => {
    if (order.includes(index)) return
    if (nodes[index].parent >= 0) visit(nodes[index].parent)
    order.push(index)
  }
  nodes.forEach((_, index) => visit(index))
  return order
}

// ------------------------------------------------------------------ the retarget

/**
 * One entry per mapped bone: the capture joint that drives it and the alignment
 * turn, in model space, from the bone's rest direction to the joint's.
 *
 * A bone's direction runs to the next mapped bone below it; `aim` in the map
 * names which one when there are several. A bone with none below it keeps its
 * nearest mapped ancestor's alignment.
 */
export function planRetarget({ map, skeleton, model, neutral = null }) {
  const indexOfJoint = new Map(skeleton.names.map((name, index) => [name, index]))
  const indexOfNode = new Map(model.map((node, index) => [node.name, index]))

  const entries = []
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith('_')) continue
    const entry = typeof value === 'string' ? { node: value } : value
    const jointName = (entry.from || [key])[0]
    if (!indexOfJoint.has(jointName)) throw new Error(`map names joint ${jointName}, which this skeleton has not got`)
    if (!indexOfNode.has(entry.node)) throw new Error(`map names node ${entry.node}, which the model has not got`)
    entries.push({ node: entry.node, nodeIndex: indexOfNode.get(entry.node), joint: indexOfJoint.get(jointName), aim: entry.aim, offset: entry.offset || null })
  }

  // The capture is turned to face the way the model faces, so a model built
  // facing any direction takes the motion without being rebuilt.
  const facing = facingOf(entries, skeleton, model)
  const facingTurn = [0, Math.sin(facing / 2), 0, Math.cos(facing / 2)]
  const restPosition = restPositions(skeleton).map(position => rotate(facingTurn, position))
  entries.facing = facing
  entries.facingTurn = facingTurn

  const isAncestor = (ancestor, index, parents) => {
    for (let at = parents(index); at >= 0; at = parents(at)) if (at === ancestor) return true
    return false
  }
  // Directions follow the capture's hierarchy, not the model's: a Rigify DEF bone
  // is parented to a control bone, so the next DEF bone is rarely its child.
  const jointParent = index => skeleton.parents[index]

  const captureRest = restPositions(skeleton)
  // The capture's standing stance, turned to the model's facing: a midline bone
  // moves by the motion's change from it, not from the capture's straight bind.
  const neutralWorld = []
  skeleton.names.forEach((name, index) => {
    const parent = skeleton.parents[index]
    const local = neutral?.[name] || IDENTITY
    neutralWorld[index] = parent < 0 ? local : multiply(neutralWorld[parent], local)
  })
  const standing = joint => inverse(multiply(multiply(facingTurn, neutralWorld[joint]), inverse(facingTurn)))
  for (const entry of entries) {
    // Hips, spine, neck and head, and the shoulders hung off the chest, rest in
    // the model's own anatomy, not a pose: a chest bone modelled leaning
    // forward, or a collarbone, turned to the capture's bind caves the rib cage
    // in. They move by the motion's change from standing. Legs and arms, whose
    // rest pose differs from model to model (A-pose, splayed legs), are lined up.
    const onMidline = joint => joint >= 0 && Math.abs(captureRest[joint][0]) < MIDLINE
    const parent = jointParent(entry.joint)
    if (parent < 0 || onMidline(entry.joint) || (onMidline(parent) && jointParent(parent) >= 0)) {
      entry.alignment = standing(entry.joint)
      continue
    }
    const below = entries.filter(other => isAncestor(entry.joint, other.joint, jointParent))
    const aimed = entry.aim ? below.find(other => skeleton.names[other.joint] === entry.aim) : below[0]
    if (entry.aim && !aimed) throw new Error(`${entry.node} aims at ${entry.aim}, which is not mapped below it`)
    if (!aimed) continue
    const jointDirection = subtract(restPosition[aimed.joint], restPosition[entry.joint])
    const boneDirection = subtract(model[aimed.nodeIndex].worldPosition, model[entry.nodeIndex].worldPosition)
    entry.alignment = turnBetween(boneDirection, jointDirection)
  }
  for (const entry of entries) {
    if (entry.alignment) continue
    let ancestor = null
    for (let at = jointParent(entry.joint); at >= 0 && !ancestor; at = jointParent(at)) {
      ancestor = entries.find(other => other.joint === at && other.alignment)
    }
    entry.alignment = ancestor ? ancestor.alignment : IDENTITY
  }
  anchorEntries(entries, skeleton, model, restPosition)
  entries.followers = followersOf(entries, model)
  return entries
}

/**
 * The angle about Y from the capture's facing to the model's, read from the
 * rest direction heel to toe. 0 when neither foot and toe are mapped.
 */
function facingOf(entries, skeleton, model) {
  for (const side of ['Left', 'Right']) {
    const foot = entries.find(entry => skeleton.names[entry.joint] === `${side}Foot`)
    const toe = entries.find(entry => skeleton.names[entry.joint] === `${side}ToeBase`)
    if (!foot || !toe) continue
    const captured = restPositions(skeleton)
    const capture = subtract(captured[toe.joint], captured[foot.joint])
    const built = subtract(model[toe.nodeIndex].worldPosition, model[foot.nodeIndex].worldPosition)
    const turn = Math.atan2(built[0], built[2]) - Math.atan2(capture[0], capture[2])
    // Quarter turns only: a foot splays a few degrees, and that is not the body's facing.
    return Math.round(turn / (Math.PI / 2)) * (Math.PI / 2)
  }
  return 0
}

/**
 * Give each entry what it needs to be placed as well as turned.
 *
 * `anchor` is the entry its capture parent drives, set only when the model hangs
 * the bone somewhere else. `restOffset` is the bone's rest place from the
 * anchor, in the anchor's own axes. The root keeps the heights that scale its bob.
 */
function anchorEntries(entries, skeleton, model, restPosition) {
  const lowestCapture = Math.min(...restPosition.map(position => position[1]))
  const lowestModel = Math.min(...entries.map(entry => model[entry.nodeIndex].worldPosition[1]))
  for (const entry of entries) {
    const node = model[entry.nodeIndex]
    if (skeleton.parents[entry.joint] < 0) {
      entry.isRoot = true
      entry.captureRestHeight = restPosition[entry.joint][1] - lowestCapture
      entry.rootRestHeight = node.worldPosition[1] - lowestModel
      continue
    }
    let anchor = null
    for (let at = skeleton.parents[entry.joint]; at >= 0 && !anchor; at = skeleton.parents[at]) {
      anchor = entries.find(other => other.joint === at) || null
    }
    if (!anchor || node.parent === anchor.nodeIndex) continue
    entry.anchor = anchor
    entry.restOffset = rotate(inverse(model[anchor.nodeIndex].worldRotation), subtract(node.worldPosition, model[anchor.nodeIndex].worldPosition))
  }
}

/**
 * Deforming bones the map never names and nothing mapped carries — a Rigify
 * pelvis under ORG-pelvis. Each is held rigidly to the mapped bone whose rest
 * head is nearest, or it stays at rest while the body around it moves.
 *
 * Deforming means named `DEF-` when the rig uses that prefix, else a skin joint.
 */
function followersOf(entries, model) {
  const mapped = new Set(entries.map(entry => entry.nodeIndex))
  const prefixed = model.some(node => /^def[-_]/i.test(node.name))
  const deforms = node => (prefixed ? /^def[-_]/i.test(node.name) : node.joint === true)
  const carried = index => {
    for (let at = model[index].parent; at >= 0; at = model[at].parent) if (mapped.has(at)) return true
    return false
  }
  const followers = []
  model.forEach((node, index) => {
    if (mapped.has(index) || !deforms(node) || carried(index)) return
    const nearest = entries.reduce((best, entry) => {
      const distance = Math.hypot(...subtract(model[entry.nodeIndex].worldPosition, node.worldPosition))
      return distance < best.distance ? { entry, distance } : best
    }, { entry: null, distance: Infinity }).entry
    if (!nearest) return
    const anchorRest = model[nearest.nodeIndex]
    followers.push({
      node: node.name,
      nodeIndex: index,
      anchor: nearest,
      restOffset: rotate(inverse(anchorRest.worldRotation), subtract(node.worldPosition, anchorRest.worldPosition)),
      restTurn: multiply(inverse(anchorRest.worldRotation), node.worldRotation)
    })
  })
  // A follower under another follower is carried by it.
  const followed = new Set(followers.map(one => one.nodeIndex))
  return followers.filter(one => {
    for (let at = model[one.nodeIndex].parent; at >= 0; at = model[at].parent) if (followed.has(at)) return false
    return true
  })
}

/** Capture joint positions in the rest pose, where every joint's rotation is identity. */
function restPositions(skeleton) {
  const positions = []
  skeleton.names.forEach((_, index) => {
    const parent = skeleton.parents[index]
    positions[index] = parent < 0 ? skeleton.offsets[index] : add(positions[parent], skeleton.offsets[index])
  })
  return positions
}

/**
 * The capture's world turn for every joint, one frame.
 *
 * `heading` is removed from the root, so the clip keeps the body's sway but not
 * the direction the capture happened to face. The game sets facing.
 */
export function captureWorldTurns(localTurns, skeleton, heading) {
  const world = []
  skeleton.names.forEach((_, index) => {
    const parent = skeleton.parents[index]
    world[index] = parent < 0
      ? withoutHeading(localTurns[index], heading)
      : multiply(world[parent], localTurns[index])
  })
  return world
}

/** The mean facing of a capture's root across all its frames. */
export function meanHeading(rootTurns) {
  let sine = 0
  let cosine = 0
  for (const turn of rootTurns) {
    const heading = headingOf(turn)
    sine += Math.sin(heading)
    cosine += Math.cos(heading)
  }
  return Math.atan2(sine, cosine)
}

/**
 * Local rotation, and local position where one is needed, for every planned bone, one frame.
 *
 * Walks the whole model so that an unmapped bone between two mapped ones keeps
 * its rest local transform and still carries its parent's turn down.
 *
 * `rootHeight` is the capture root's height this frame, in metres; the root bone
 * rises and falls by the same share of its own rest height.
 *
 * Returns `[{ rotation, position }]` in plan order; `position` is null for a bone
 * whose rest place under its parent is already right.
 */
export function retargetFrame(plan, model, captureWorld, order = retargetOrder(plan, model), rootHeight = null) {
  const driven = new Map(plan.map(entry => [entry.nodeIndex, entry]))
  const following = new Map((plan.followers || []).map(one => [one.nodeIndex, one]))
  if (plan.facing) {
    const back = inverse(plan.facingTurn)
    captureWorld = captureWorld.map(turn => multiply(multiply(plan.facingTurn, turn), back))
  }
  const world = []
  const place = []
  const scale = []
  const out = new Map()
  for (const index of order) {
    const node = model[index]
    const parent = node.parent
    const parentWorld = parent >= 0 ? world[parent] : IDENTITY
    const parentPlace = parent >= 0 ? place[parent] : [0, 0, 0]
    const parentScale = parent >= 0 ? scale[parent] : 1
    scale[index] = parentScale * node.scale
    const entry = driven.get(index)
    const restPlace = () => add(parentPlace, rotate(parentWorld, node.translation.map(value => value * parentScale)))
    const follower = following.get(index)
    if (follower) {
      const anchor = follower.anchor.nodeIndex
      world[index] = multiply(world[anchor], follower.restTurn)
      place[index] = add(place[anchor], rotate(world[anchor], follower.restOffset))
      out.set(follower.node, {
        rotation: normalise(multiply(inverse(parentWorld), world[index])),
        position: rotate(inverse(parentWorld), subtract(place[index], parentPlace)).map(value => value / parentScale)
      })
      continue
    }
    if (!entry) {
      world[index] = multiply(parentWorld, node.rotation)
      place[index] = restPlace()
      continue
    }
    world[index] = multiply(multiply(captureWorld[entry.joint], entry.alignment), node.worldRotation)
    let rotation = normalise(multiply(inverse(parentWorld), world[index]))
    if (entry.offset) rotation = multiply(rotation, entry.offset)

    let position = null
    const wanted = wantedPlace(entry, model, world, place, rootHeight)
    if (wanted) {
      place[index] = wanted
      position = rotate(inverse(parentWorld), subtract(wanted, parentPlace)).map(value => value / parentScale)
    } else {
      place[index] = restPlace()
    }
    out.set(entry.node, { rotation, position })
  }
  return [...plan, ...(plan.followers || [])].map(entry => out.get(entry.node))
}

/**
 * Where a bone must be, or null when its rest place under its parent is right.
 *
 * A bone hung off a control bone the map never names — a Rigify arm under
 * ORG-shoulder — would stay where it rests while the chest turns. It is held at
 * its rest offset from the bone its capture parent drives instead.
 */
function wantedPlace(entry, model, world, place, rootHeight) {
  if (entry.isRoot) {
    if (rootHeight === null || !entry.rootRestHeight) return null
    const node = model[entry.nodeIndex]
    const lift = (rootHeight - entry.captureRestHeight) * entry.rootRestHeight / entry.captureRestHeight
    return [node.worldPosition[0], node.worldPosition[1] + lift, node.worldPosition[2]]
  }
  if (!entry.anchor) return null
  const anchor = entry.anchor.nodeIndex
  return add(place[anchor], rotate(world[anchor], entry.restOffset))
}

/** Node indices with every parent, and every bone's anchor, before the bone. */
export function retargetOrder(plan, model) {
  const anchorOf = new Map([...plan, ...(plan.followers || [])].filter(entry => entry.anchor).map(entry => [entry.nodeIndex, entry.anchor.nodeIndex]))
  const order = []
  const seen = new Set()
  const visit = index => {
    if (seen.has(index)) return
    seen.add(index)
    if (model[index].parent >= 0) visit(model[index].parent)
    if (anchorOf.has(index)) visit(anchorOf.get(index))
    order.push(index)
  }
  model.forEach((_, index) => visit(index))
  return order
}

export { parentsFirst }
