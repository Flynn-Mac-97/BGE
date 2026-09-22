/**
 * Kernel: a loaded model addressed by node name.
 *
 * `pose` turns a named node and `attachments` hangs another model off one, so
 * both read the one index this module keeps. The index is kept out of
 * `userData` because three deep-copies `userData` through JSON on every clone,
 * and a map of live Object3Ds does not survive that trip.
 */
import * as THREE from 'three/webgpu'
import { declaredNumber } from '../frame-plan.js'
import { cachedModel, cloneModel } from './model-cache.js'
import { readVector } from './read-value.js'
import { reportOnce } from './report.js'

/**
 * Where a model's named children are, per instance.
 *
 * Kept outside `userData` because three deep-copies `userData` through JSON on
 * every clone, and a map of live Object3Ds does not survive that trip. Both
 * things that address a model by node name read this one index: `pose`, which
 * rotates a named node, and `attachments`, which hangs another model off one.
 */
export const namedNodes = new WeakMap()

/**
 * What is hanging off a model's named nodes right now.
 *
 * holder -> Map(node name -> { model, group }). This record is the whole reason
 * setting the same attachment twice is a move rather than a rebuild: a plugin
 * keeping a body's weapon in step with its inventory writes the same file name
 * sixty times a second, and rebuilding a scene graph at that rate is a stutter
 * nobody would ever trace back to the line that caused it.
 */
export const attachedModels = new WeakMap()

/** Every named node of a freshly cloned model, so pose and attachments can find one. */
export function indexNodes(holder, instance) {
  const nodes = {}
  // A bone or an empty helper draws nothing, but three projects every node in
  // the graph on every scene pass. Marking the helpers invisible makes
  // `_projectObject` return before their subtrees, so the hundreds of joints in
  // a rig cost nothing to describe. Visibility does not gate `updateMatrixWorld`,
  // so bones still update for the skinning.
  const draws = new Set([holder, instance])
  // One rig per set of bone objects the clone brought. SkeletonUtils.clone
  // gives every skinned mesh its own skeleton over the same bones, so three
  // rebuilds and uploads the same bone matrices once per mesh. These meshes are
  // pointed at one skeleton between them; each keeps its own bind matrix, so it
  // draws exactly as before.
  const rigs = []
  instance.traverse(node => {
    if (node.name && !nodes[node.name]) nodes[node.name] = node
    if (node.isSkinnedMesh && node.skeleton) {
      let rig = rigs.find(candidate => sameRig(candidate, node.skeleton))
      if (rig === undefined) rigs.push(node.skeleton)
      else if (rig !== node.skeleton) node.skeleton = rig
    }
    // A scene node's local matrix only changes when something poses it. Three
    // otherwise recomposes and re-multiplies every node's matrix on every draw,
    // which for a rigged model is most of what describing a frame costs. Pose
    // and attachments call `updateMatrix` after they write a transform.
    node.matrixAutoUpdate = false
    node.updateMatrix()
    if (node.isMesh || node.isSprite || node.isPoints || node.isLine || node.isLight || node.isCamera) {
      draws.add(node)
      for (let parent = node.parent; parent; parent = parent.parent) draws.add(parent)
    }
  })
  instance.traverse(node => { if (!draws.has(node)) node.visible = false })
  // A node that draws nothing and leads to nothing drawn or skinned is dead
  // weight: three still walks it on every `updateMatrixWorld`, and a rig brings
  // hundreds of them. Remove the top of each such subtree; anything an
  // attachment asks for is put back by `reattach`.
  const keeps = new Set([holder, instance])
  for (const rig of rigs) for (const bone of rig.bones) if (bone) for (let at = bone; at; at = at.parent) keeps.add(at)
  instance.traverse(node => {
    if (node.isMesh || node.isSprite || node.isPoints || node.isLine || node.isLight || node.isCamera) {
      for (let at = node; at; at = at.parent) keeps.add(at)
    }
  })
  const pruned = []
  instance.traverse(node => {
    if (!keeps.has(node) && node.parent && keeps.has(node.parent)) pruned.push(node)
  })
  for (const node of pruned) {
    prunedParents.set(node, node.parent)
    node.removeFromParent()
  }
  namedNodes.set(holder, nodes)
}

/** The parent a pruned subtree was removed from, so an attachment can put it back. */
const prunedParents = new WeakMap()

/**
 * Put back every pruned ancestor of a node, top down.
 *
 * A node with nothing drawn or skinned under it is removed from its model when
 * the model loads, so three stops walking it every frame. An attachment may
 * still name that node, and a node outside the scene graph draws nothing, so
 * the chain is re-added before the attachment hangs off it.
 */
function reattach(node, holder) {
  const chain = []
  for (let at = node; at && at !== holder; at = at.parent) {
    if (prunedParents.has(at)) chain.push(at)
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const at = chain[i]
    const parent = prunedParents.get(at)
    prunedParents.delete(at)
    parent.add(at)
  }
}

/**
 * Whether two skeletons are the same rig: the same bone objects over the same
 * inverse bind matrices. Meshes over one rig may share a skeleton; two rigs may
 * not, even when they name the same bones, because their bind poses differ.
 */
function sameRig(first, second) {
  if (first.bones.length !== second.bones.length) return false
  if (first.boneInverses !== second.boneInverses) return false
  for (let i = 0; i < first.bones.length; i++) if (first.bones[i] !== second.bones[i]) return false
  return true
}

/**
 * A node by the name the file gives it. The glTF loader strips `.`, `:`, `/`
 * and brackets from node names, so `DEF-shin.R` is stored as `DEF-shinR`.
 */
export function nodeNamed(nodes, name) {
  return nodes[name] || nodes[THREE.PropertyBinding.sanitizeNodeName(name)]
}

/**
 * One attachment, in its object form.
 *
 * `attachments: { weaponMount: 'ak47.glb' }` is the shorthand for
 * `{ weaponMount: { model: 'ak47.glb' } }`, and it is normalised in ONE place
 * for exactly the reason `meshOf` normalises the mesh: two readings of one
 * declaration in two places is how half a file comes to treat a string as a
 * file name and the other half as an object that has no file name in it.
 */
function attachmentOf(value, where) {
  if (value === null || value === undefined || value === false) return null
  if (typeof value === 'string') return value ? { model: value } : null
  if (typeof value === 'object' && typeof value.model === 'string' && value.model) return value
  reportOnce(`[render] ${where}: expected a model file name, got ${JSON.stringify(value)}`)
  return null
}

/**
 * Hang models off a model's named nodes, and take off what is no longer wanted.
 *
 *   entity.attachments = { weaponMount: 'counter-strike/models/ak47.glb' }
 *
 * A character is exported with an empty node at the right hand, and what goes in
 * that hand changes as the game runs — so it is a declaration, read on sync,
 * alongside `pose` and `anchor`. It belongs here rather than in a plugin because
 * the renderer already owns the model cache: a plugin doing its own parenting would
 * fetch and hold a second copy of every GLB the world models already have, and
 * the copies would be invalidated separately when somebody edited the file.
 *
 * The request is remembered rather than read once, because the node it names may
 * not exist yet — whoever finishes loading the model applies the standing
 * request the moment the nodes are there. So one call is enough, and a caller
 * does not have to keep asking until the file lands.
 */
export function applyAttachments(holder, declared, release) {
  holder.userData.attachmentsWanted = declared || null

  const held = attachedModels.get(holder)
  if (!declared && !held) return
  const nodes = namedNodes.get(holder)
  // Still loading. The request is written down above, and applied from there.
  if (!nodes) return

  const where = holder.userData.model
  const record = held || new Map()
  if (!held) attachedModels.set(holder, record)

  // Everything that changed file, or is no longer asked for, comes off first —
  // so a swap frees the node before the thing replacing it wants it.
  for (const [name, entry] of [...record]) {
    const wanted = attachmentOf(declared?.[name], `${where}.attachments.${name}`)
    if (wanted && wanted.model === entry.model) continue
    entry.group.userData.stale = true
    entry.group.parent?.remove(entry.group)
    release(entry.group)
    record.delete(name)
  }

  if (!declared) return
  for (const name of Object.keys(declared)) {
    const spec = attachmentOf(declared[name], `${where}.attachments.${name}`)
    if (!spec) continue

    let entry = record.get(name)
    if (!entry) {
      const node = nodeNamed(nodes, name)
      if (!node) {
        // Once, by name. This is written every frame, and a message that repeats
        // sixty times a second is a console nobody reads.
        reportOnce(`[render] ${where}: no node named "${name}" to attach "${spec.model}" to`)
        continue
      }
      // A pruned node is not in the graph, and an attachment under one draws
      // nothing. The chain is put back before the group is hung on it.
      reattach(node, holder)
      // A joint with no mesh of its own was hidden when the model loaded, and a
      // hidden node hides everything added under it. The attachment draws, so
      // the node and its ancestors have to show again.
      for (let at = node; at && at !== holder; at = at.parent) at.visible = true
      // A group of its own rather than the loaded scene directly: the offset
      // that fits a grip into a fist has to survive the file arriving late, and
      // a node that exists from the first frame is the simplest way to hold it.
      const group = new THREE.Group()
      group.rotation.order = 'YXZ'
      node.add(group)
      entry = { model: spec.model, group }
      record.set(name, entry)
      loadAttachment(holder, group, spec.model)
    }

    const position = readVector(spec.position, `${where}.attachments.${name}.position`)
    const rotation = readVector(spec.rotation, `${where}.attachments.${name}.rotation`)
    entry.group.position.set(position.x, position.y, position.z)
    entry.group.rotation.set(rotation.x, rotation.y, rotation.z)
    entry.group.scale.setScalar(declaredNumber(spec.scale, 1, `${where}.attachments.${name}.scale`))
    entry.group.updateMatrix()
  }
}

/** Load one attachment model and add it to its group, unless either has gone stale first. */
function loadAttachment(holder, group, file) {
  cachedModel(file, loaded => {
    // Either the attachment or the thing it hangs off may have gone while the
    // file was in the air — and the second body to want a model already in the
    // cache is answered before its group has been parented at all, so the flags
    // are the only honest test.
    if (group.userData.stale || holder.userData.stale) return
    const instance = cloneModel(loaded)
    // A viewmodel is in front of the eye by construction, so culling it against
    // a frustum it is always inside costs a test per frame and can only ever be
    // wrong. A weapon in somebody else's hands is culled like anything else.
    if (holder.userData.neverCull) instance.traverse(node => { node.frustumCulled = false })
    group.add(instance)
  }, () => {
    // `cachedModel()` has already named the file on the console. An empty hand is the
    // least bad answer here: a fallback block held in a fist reads as artwork
    // rather than as a failure, which is the one thing it must not do.
  })
}
