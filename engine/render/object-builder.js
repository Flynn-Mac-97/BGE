/**
 * Kernel: the scene object that stands for one entity, rebuilt when its look
 * changes, and the disposal that goes with it.
 */
import * as THREE from 'three/webgpu'
import { number, meshOf, partsOf, materialLook } from '../frame-plan.js'
import { solidGeometry } from './geometry-cache.js'
import { cachedModel, cloneModel } from './model-cache.js'
import {
  namedNodes, attachedModels, indexNodes, nodeNamed, applyAttachments
} from './model-nodes.js'
import { eachMaterial, setMaterialOpacity } from './material-vocabulary.js'
import { reportOnce } from './report.js'

export function makeObjectBuilder(state) {
  /**
   * The object standing for one entity.
   *
   * A sprite or a box is one Mesh with a shared or private material. A model is
   * a Group holding a tinted box until the file arrives and its clone in its
   * place afterwards, so the entity has something to be at every moment —
   * including the moment the file turns out not to exist.
   */
  function buildObject(entity, described) {
    const declared = meshOf(entity)
    if (declared?.model) return buildModel(entity, declared, described)
    const parts = partsOf(declared, `${entity.type}.mesh`)
    if (parts) return buildParts(entity, parts, described)

    const object = new THREE.Mesh(
      state.geometryFor(entity),
      entity.mesh ? state.meshMaterial(entity, described.material) : state.spriteMaterial(entity))
    object.userData.entity = entity.id
    object.userData.look = described.look
    // A sprite's material belongs to it alone and is disposed with it; a mesh
    // shares one with every wall that looks the same, and disposing that would
    // blank the other three hundred.
    object.userData.privateMaterial = !entity.mesh
    return object
  }

  /**
   * A body made of boxes: one Group, one Mesh per part.
   *
   * Geometry and material both come out of the caches every other box uses, so
   * a hundred kittens are a hundred groups over one set of shared boxes and one
   * set of shared colours rather than a hundred copies of either.
   */
  function buildParts(entity, parts, described) {
    const holder = new THREE.Group()
    holder.userData.entity = entity.id
    holder.userData.look = described.look
    // Shared, like every other mesh material — disposing one would blank every
    // other body built from the same declaration.
    holder.userData.privateMaterial = false

    for (const part of parts.list) {
      const key = materialLook(entity, part.declaration, part.shape)
      const piece = new THREE.Mesh(
        solidGeometry('box', part.shape.w, part.shape.h, part.shape.d),
        state.meshMaterial(entity, key, part))
      piece.position.set(part.at.x, part.at.y, part.at.z)
      piece.rotation.set(part.turn.x, part.turn.y, part.turn.z)
      // A named part is a part `pose` can move, exactly as a named node of a
      // model is. Its declared angle is where it rests, so a pose is added to
      // that rather than replacing it — a tail held at 68 degrees must not snap
      // flat the first time something swishes it.
      if (part.name) {
        piece.name = part.name
        piece.userData.restRotationX = part.turn.x
      }
      holder.add(piece)
    }
    indexNodes(holder, holder)
    return holder
  }

  /** A group holding a placeholder box, replaced by the model clone once its file arrives. */
  function buildModel(entity, declared, described) {
    const holder = new THREE.Group()
    holder.userData.entity = entity.id
    holder.userData.look = described.look
    holder.userData.model = declared.model

    // Something visible while the file is in flight, and something visible for
    // good if it never arrives.
    const waiting = new THREE.Mesh(state.geometryFor(entity), state.meshMaterial(entity, described.material))
    holder.add(waiting)

    cachedModel(declared.model, loaded => {
      // The entity may have changed its look, or gone, while this was in the
      // air. The flag is what says so, not `holder.parent`: the second entity
      // to want a model already in the cache is answered on the spot, before
      // the caller has had a chance to add this holder to the scene at all.
      if (holder.userData.stale) return
      const instance = cloneModel(loaded)
      indexNodes(holder, instance)
      holder.remove(waiting)
      release(waiting)
      holder.add(instance)
      // Whatever was asked for while the file was in flight. Without this an
      // entity that declared its attachment once, before the body existed,
      // would hold air until something happened to declare it again.
      applyAttachments(holder, holder.userData.attachmentsWanted, release)
      state.shadowDirty = true
    }, () => {
      // The box stays, and `cachedModel()` has already named the file on the console.
    })

    return holder
  }

  /**
   * Tell three that an object and everything under it are gone for good.
   *
   * The WebGPU renderer keeps its own record for every object it has drawn, and
   * drops it only on the object's `dispose` event. Removing an object from the
   * scene, or disposing its geometry, leaves that record and the arrays it holds.
   * `Object3D.dispose` only fires the event, so shared geometry and materials are
   * left alone.
   */
  function release(object) {
    object.traverse(node => {
      node.dispose()
      if (state.compilesRunning > 0) state.releasedWhileCompiling.add(node)
    })
  }


  function releaseAgainAfterCompile() {
    for (const node of state.releasedWhileCompiling) node.dispose()
    if (state.compilesRunning === 0) state.releasedWhileCompiling.clear()
  }

  /**
   * Drop every render record the scene's objects hold, so the next frame makes
   * only the ones it draws with.
   *
   * three keeps a record per object per render target and frees them only when
   * the object is disposed. Each level load brings a new room probe and a new
   * post chain, and the records for the old ones stayed: about 1,500 per load on
   * a heavy scene. Compiled pipelines are cached apart, so nothing compiles again.
   */
  function forgetDrawRecords() {
    state.scene.traverse(node => node.dispose())
  }

  /** Remove an object from the scene and revoke anything private it still holds. */
  function discard(object) {
    state.scene.remove(object)
    state.shadowDirty = true
    release(object)
    namedNodes.delete(object)
    attachedModels.delete(object)
    // Anything still in flight for this object — a model being fetched — checks
    // this before it does its work.
    object.userData.stale = true
    // The record that stood for this object must stop answering with it, or the
    // fast path would hand back an object that is no longer in the scene.
    const record = object.userData.record
    if (record) { record.object = null; record.drawnLook = null }
    if (!object.userData.privateMaterial) return
    object.traverse(node => eachMaterial(node, material => material.dispose()))
  }

  /** The scene object for one entity, rebuilt when its look changed. */
  function objectFor(entity, described, record) {
    let object = record.object
    // The record's own object answers almost every frame, and `drawnLook` is on
    // the record rather than in `userData`, where every feature the renderer gains
    // grows the object's shape. The id lookup into `meshes` runs only when there
    // is none — a first sight, or an object discarded behind the record's back.
    if (object !== null && record.drawnLook === described.look) return object
    if (object === null) {
      const found = state.meshes.get(entity.id)
      if (found && !found.userData.stale) object = found
    }
    if (object !== null) {
      if (object.userData.look === described.look) {
        record.object = object
        record.drawnLook = described.look
        object.userData.record = record
        record.keylineMesh = object.userData.keylineMesh ?? null
        return object
      }
      // Changing a texture — or a box size — in the inspector has to show up
      // without a reload. Rebuilding rather than patching is what lets a sprite,
      // a box and a model all be the same entity at different moments.
      state.leaveBatch(entity.id)
      discard(object)
      state.meshes.delete(entity.id)
    }
    const known = state.meshes.has(entity.id)
    object = buildObject(entity, described)
    // Three recomputes every object's local and world matrix on every scene
    // traversal, and the scene is traversed once per pass and per render. A
    // still object's matrix is already right, so the renderer writes it once and
    // keeps three away from it; `sync` updates it when the entity moves.
    object.matrixAutoUpdate = false
    state.scene.add(object)
    state.shadowDirty = true
    state.meshes.set(entity.id, object)
    record.object = object
    record.drawnLook = described.look
    object.userData.record = record
    // The new object carries no keyline yet, whatever the old one had.
    record.keylineMesh = null
    record.keylineWidth = -1
    record.keylineColour = null
    // An id that had nothing before may mean an old object is now dead.
    if (!known) state.objectsGrew = true
    return object
  }

  /**
   * Dim one object, taking private materials the moment it needs them.
   *
   * Dimming is the editor's hover preview and nothing else, so at most a handful
   * of objects ever pay for a private copy — and everything else keeps sharing,
   * which is what makes several hundred walls affordable in the first place.
   */
  function dim(object, opacity) {
    if (opacity >= 1 && !object.userData.privateMaterial) return
    if (!object.userData.privateMaterial) {
      object.traverse(node => {
        if (!node.material) return
        node.material = Array.isArray(node.material)
          ? node.material.map(one => one.clone())
          : node.material.clone()
      })
      object.userData.privateMaterial = true
    }
    object.traverse(node => eachMaterial(node, material => setMaterialOpacity(material, opacity)))
  }

  /**
   * Rotate the named children of a model.
   *
   * `entity.pose` names nodes and says how each one turns. A value may be
   * written two ways, and the two answer different needs:
   *
   *   entity.pose = {
   *     legLeft: -0.4,                  // radians about X — a hinge
   *     LeftArm: [0.1, 0, 0.3, 0.94],   // a quaternion x,y,z,w — the whole turn
   *     Thigh: [0, 0, 0, 1, 0.1, 3, 0]  // a turn, then a local position
   *   }
   *
   * A number is the cheap half: a walk cycle a behaviour computes from speed is
   * half a dozen angles, and a hinge per limb is all it needs. It adds to where
   * the part was declared to rest, so a `parts` body keeps its declared angle.
   *
   * A quaternion is what a captured clip carries — three axes per joint, which
   * a hinge cannot hold. It REPLACES the node's rotation rather than adding to
   * a rest angle, because a clip's value is already the joint's full local
   * rotation; anything the target rig needs on top of that is retargeting, and
   * is baked into the clip before it gets here.
   *
   * `indexNodes` traverses everything, so a skinned GLB's bones are named nodes
   * like any other. Turning bones by name is therefore how a rig plays — no
   * separate skinning path, and the mesh follows because three reads the bone
   * matrices it already has.
   */
  function applyPose(object, pose) {
    const nodes = namedNodes.get(object)
    // Still loading. The next frame will pose it, and there is no state to keep.
    if (!nodes) return
    for (const name of Object.keys(pose)) {
      const node = nodeNamed(nodes, name)
      if (!node) {
        reportOnce(`[render] ${object.userData.model || object.userData.entity}: no node named "${name}" to pose`)
        continue
      }
      const turn = pose[name]
      if (Array.isArray(turn)) {
        if (turn.length !== 4 && turn.length !== 7) {
          reportOnce(`[render] pose.${name}: a rotation is 4 numbers x,y,z,w, or 7 with a local position after, got ${turn.length}`)
          continue
        }
        // Normalised because a clip stores rounded numbers, and an unnormalised
        // quaternion scales the node it is set on.
        node.quaternion.set(turn[0], turn[1], turn[2], turn[3]).normalize()
        if (turn.length === 7) node.position.set(turn[4], turn[5], turn[6])
        node.updateMatrix()
        continue
      }
      // The fast path: this runs for every limb of every character every frame,
      // and naming the failure costs a string whether or not there is one.
      const wanted = Number.isFinite(turn) ? turn : number(turn, 0, `pose.${name}`)
      node.rotation.x = (node.userData.restRotationX || 0) + wanted
      node.updateMatrix()
    }
  }

  state.buildObject = buildObject
  state.objectFor = objectFor
  state.discard = discard
  state.dim = dim
  state.applyPose = applyPose
  state.release = release
  state.releaseAgainAfterCompile = releaseAgainAfterCompile
  state.forgetDrawRecords = forgetDrawRecords
}
