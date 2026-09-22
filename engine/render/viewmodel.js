/**
 * Kernel: the weapon in first person, drawn in its own pass over a cleared
 * depth buffer through a narrower camera of its own.
 *
 * A weapon sits about half a metre from the eye, so in one shared depth buffer
 * it pushes into every wall; there is no fix in the world pass. Its scene is in
 * view space, so nothing has to track where the player is.
 */
import * as THREE from 'three/webgpu'
import { number } from '../frame-plan.js'
import { cachedModel, cloneModel } from './model-cache.js'
import {
  namedNodes, attachedModels, indexNodes, applyAttachments
} from './model-nodes.js'
import { eachMaterial } from './material-vocabulary.js'
import { readVector } from './read-value.js'
import { entityTint } from './entity-look.js'

export function makeViewmodel(state) {
  /**
   * The weapon in your hands, drawn in its own pass.
   *
   * A first-person weapon sits about half a metre from the eye, and in one
   * shared depth buffer that means it pushes into every wall you stand near.
   * There is no fix in the world pass — scaling it down or pulling it closer
   * only moves the distance at which it happens — so it is drawn afterwards,
   * against a cleared depth buffer, through a camera of its own. Its camera is
   * narrower, around 54 degrees against the world's 90, because a 90 degree view
   * of something 40 cm away is a fish-eye and reads as a toy. It has its own
   * light so a rifle looks the same in a tunnel as it does in the open, which is
   * what players actually expect even though it is not what light does.
   *
   * Its scene is in view space: the camera stays at the origin looking down -Z,
   * so a position is straight out of the eye and nothing has to track where the
   * player is.
   */
  const viewmodelScene = new THREE.Scene()
  const viewmodelCamera = new THREE.PerspectiveCamera(54, 1, 0.01, 20)
  const viewmodelRoot = new THREE.Group()
  viewmodelRoot.rotation.order = 'YXZ'
  viewmodelScene.add(viewmodelRoot)
  viewmodelScene.add(new THREE.AmbientLight(new THREE.Color('#aab6c8'), 1.1))
  const viewmodelKey = new THREE.DirectionalLight(new THREE.Color('#fff4e2'), 1.5)
  viewmodelKey.position.set(1.4, 2.2, 2.6)
  viewmodelScene.add(viewmodelKey)

  const viewmodelBase = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }
  const viewmodelShift = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }
  let viewmodelHeld = null

  /** Drop the held viewmodel and dispose only the geometry and materials built for it. */
  function clearViewmodel() {
    if (!viewmodelHeld) return
    viewmodelRoot.remove(viewmodelHeld)
    state.release(viewmodelHeld)
    // Anything still in flight for this pair of hands — the hands themselves, or
    // the weapon hanging off them — checks this before it does its work.
    viewmodelHeld.userData.stale = true
    attachedModels.delete(viewmodelHeld)
    namedNodes.delete(viewmodelHeld)
    // Only what was built here is disposed. A cloned model shares its geometry
    // and its materials with the cache and with every other copy of that file,
    // so disposing those would blank the character wearing the same rifle.
    viewmodelHeld.traverse(node => {
      if (!node.userData.ownGeometry) return
      node.geometry.dispose()
      eachMaterial(node, material => material.dispose())
    })
    viewmodelHeld = null
  }

  /** Put the viewmodel root at its base pose plus the current sway and kick shift. */
  function placeViewmodel() {
    if (!viewmodelHeld) return
    viewmodelRoot.position.set(
      viewmodelBase.position.x + viewmodelShift.position.x,
      viewmodelBase.position.y + viewmodelShift.position.y,
      viewmodelBase.position.z + viewmodelShift.position.z)
    viewmodelRoot.rotation.set(
      viewmodelBase.rotation.x + viewmodelShift.rotation.x,
      viewmodelBase.rotation.y + viewmodelShift.rotation.y,
      viewmodelBase.rotation.z + viewmodelShift.rotation.z)
    viewmodelRoot.scale.setScalar(viewmodelBase.scale)
  }

  /**
   * The weapon in first person, in its own pass with its own depth buffer.
   *
   * `set(null)` puts it away. Position and rotation are in view space: -Z is
   * straight ahead, +X is right, +Y is up, and the origin is the eye.
   *
   * `attachments` is the same declaration an entity carries, against the named
   * nodes of whatever `model` is — which is how a pair of hands and a weapon
   * are composed into one viewmodel:
   *
   *   set({ model: 'hands-terrorist.glb', attachments: { hands: 'ak47.glb' } })
   *
   * A second `model` parameter was the other way to spell that, and it is the
   * worse one: it would say where the weapon goes in the renderer, where the fact
   * actually lives in the export — the hands are authored with their origin at
   * the right wrist, so a grip at (0,0,0) under the node called `hands` lands
   * in the fist. One vocabulary for "hang a model off a named node" also means
   * a silencer, a torch or a shield needs nothing new here.
   */
  const viewmodel = {
    scene: viewmodelScene,

    set(spec) {
      if (!spec || !spec.model) { clearViewmodel(); return }

      viewmodelBase.position = readVector(spec.position, 'viewmodel.position')
      viewmodelBase.rotation = readVector(spec.rotation, 'viewmodel.rotation')
      viewmodelBase.scale = number(spec.scale, 1, 'viewmodel.scale')

      // Setting the weapon you are already holding is a move, not a swap. A
      // plugin that calls this from update() every frame is the obvious way to
      // write one, and rebuilding the model sixty times a second would be a
      // stutter nobody could explain from the game code.
      if (viewmodelHeld?.userData.model === spec.model) {
        placeViewmodel()
        applyAttachments(viewmodelHeld, spec.attachments, state.release)
        return
      }

      clearViewmodel()
      viewmodelShift.position = { x: 0, y: 0, z: 0 }
      viewmodelShift.rotation = { x: 0, y: 0, z: 0 }

      const held = new THREE.Group()
      held.userData.model = spec.model
      // Everything in this pass is in front of the eye by construction; see
      // loadAttachment, which reads this to decide the same for the weapon.
      held.userData.neverCull = true
      viewmodelHeld = held
      viewmodelRoot.add(held)

      cachedModel(spec.model, loaded => {
        if (viewmodelHeld !== held) return
        const instance = cloneModel(loaded)
        // Never culled: it is always in front of the eye by construction, and
        // a viewmodel that vanishes at the wrong angle is the classic bug.
        instance.traverse(node => { node.frustumCulled = false })
        held.add(instance)
        indexNodes(held, instance)
        // The weapon was asked for while the hands were still loading, which
        // is the normal case on the first frame of a round.
        applyAttachments(held, held.userData.attachmentsWanted, state.release)
      }, () => {
        if (viewmodelHeld !== held) return
        // The same rule as everywhere else: a thing that failed to load is a
        // visible block, never nothing at all.
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 0.4),
          new THREE.MeshBasicMaterial({ color: entityTint(String(spec.model)) }))
        block.userData.ownGeometry = true
        held.add(block)
      })
      placeViewmodel()
      applyAttachments(held, spec.attachments, state.release)
    },

    /** Per-frame bob, sway and kick, added on top of whatever `set` declared. */
    offset(position, rotation) {
      viewmodelShift.position = readVector(position, 'viewmodel.offset position')
      viewmodelShift.rotation = readVector(rotation, 'viewmodel.offset rotation')
      placeViewmodel()
    }
  }

  /**
   * Draw the weapon in its own pass.
   *
   * The whole point of the second pass: the weapon is measured against an empty
   * depth buffer, so no wall can ever be in front of it.
   */
  function viewmodelDraw() {
    if (!viewmodelHeld || state.flat()) return
    placeViewmodel()
    state.renderer.clearDepth()
    state.renderer.render(viewmodelScene, state.viewmodelCamera)
  }

  state.viewmodelCamera = viewmodelCamera
  state.viewmodel = viewmodel
  state.viewmodelDraw = viewmodelDraw
}
