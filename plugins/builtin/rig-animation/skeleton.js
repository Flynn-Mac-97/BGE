/**
 * Rig Animation: a model's skeleton as data, and where each node is under a pose.
 *
 * A skeleton file is written by `rig.retarget` as `motion/<model>.skeleton.json`:
 *
 *   { model: 'models/hero.glb', nodes: { 'Hips': { parent: 'hero-rig', position, rotation, scale }, ... } }
 *
 * `position` and `rotation` are the node's rest place under its parent; the
 * first node has `parent: null`. Places are in model space: the space of the
 * model file, before the entity's own place, turn and scale.
 */
import { blendTurns, inverse, multiply, rotate } from '../game-maths/turns.js'
import { add, scaled } from '../game-maths/vectors.js'

/** A bone name as the glTF loader stores it: dots, colons, slashes and brackets dropped. */
const plain = name => name.replace(/[[\].:/]/g, '')

/** A skeleton file as written, checked, with a lookup by either spelling of a name. */
export function widenSkeleton(raw, file) {
  const nodes = raw.nodes || {}
  if (!Object.keys(nodes).length) throw new Error(`${file}: no nodes`)
  for (const [name, node] of Object.entries(nodes)) {
    if (node.parent !== null && !nodes[node.parent])
      throw new Error(`${file}: ${name} names parent ${node.parent}, which is not a node`)
  }
  const byPlainName = new Map(Object.keys(nodes).map(name => [plain(name), name]))
  return {
    model: raw.model || null,
    nodes,
    nameOf: name => (nodes[name] ? name : (byPlainName.get(plain(name)) ?? null))
  }
}

/**
 * Where node `name` is under `pose`, in model space: `{ turn, position, scale }`.
 * A node the pose does not name keeps its rest turn; one whose pose entry has
 * seven numbers takes its local position from the last three.
 */
export function placeOf(skeleton, pose, name) {
  const node = skeleton.nodes[name]
  const posed = pose[name]
  const turn = posed ? posed.slice(0, 4) : node.rotation
  const position = posed?.length === 7 ? posed.slice(4, 7) : node.position
  if (!node.parent) return { turn, position, scale: node.scale ?? 1 }
  const parent = placeOf(skeleton, pose, node.parent)
  return {
    turn: multiply(parent.turn, turn),
    position: add(parent.position, rotate(parent.turn, scaled(position, parent.scale))),
    scale: parent.scale * (node.scale ?? 1)
  }
}

/** The model-space point at `local` in node `name`'s own space. */
export function pointIn(skeleton, pose, name, local) {
  const place = placeOf(skeleton, pose, name)
  return add(place.position, rotate(place.turn, scaled(local, place.scale)))
}

/**
 * Give node `name` the model-space turn `turn`, blended by `weight` from its
 * posed turn, by writing its local turn into the pose.
 */
export function turnNodeTo(skeleton, pose, name, turn, weight) {
  const parent = skeleton.nodes[name].parent
  const local = parent ? multiply(inverse(placeOf(skeleton, pose, parent).turn), turn) : turn
  const posed = pose[name]
  const blended = blendTurns(posed.slice(0, 4), local, weight)
  for (let axis = 0; axis < 4; axis++) posed[axis] = blended[axis]
}

/** Node names as the skeleton spells them, or null when any is missing or the pose does not turn it. */
export function posedNames(skeleton, pose, names) {
  const found = (names ?? []).map(name => skeleton.nameOf(name))
  return found.length && found.every(name => name && pose[name]) ? found : null
}
