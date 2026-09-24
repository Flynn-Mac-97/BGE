/**
 * Kernel: a ray into the scene, and the two-way mapping between a world point
 * and a pixel.
 *
 * The raycaster sees every layer, because a merged entity keeps its own mesh on
 * a layer the camera does not draw.
 */
import * as THREE from 'three/webgpu'
import { entityDrawSize, spinRadians } from '../frame-plan.js'

/** Build the picking system and write its methods onto `state`. */
export function makePicking(state) {
  const raycaster = new THREE.Raycaster()
  // Merged entities keep a mesh nobody draws, on its own layer, so that picking
  // still answers against real geometry. The camera ignores that layer; the ray
  // must not.
  raycaster.layers.enableAll()

  /** The nearest ancestor that stands for an entity, for a ray that hit a child. */
  function entityIdOf(object) {
    for (let node = object; node; node = node.parent) {
      if (node.userData.entity) return node.userData.entity
    }
    return null
  }

  /** Visible means visible all the way up: a hidden group hides its children. */
  function shownInTree(object) {
    for (let node = object; node; node = node.parent) if (node.visible === false) return false
    return true
  }

  /** Everything the ray meets, nearest first, skipping what is not being drawn. */
  function rayHits(pixelX, pixelY) {
    state.readyCamera()
    state.scene.updateMatrixWorld()
    raycaster.setFromCamera(state.toNDC(pixelX, pixelY), state.activeCamera())
    // Recursive, because a model is a group of meshes rather than one mesh.
    return raycaster.intersectObjects([...state.meshes.values()], true).filter(hit => shownInTree(hit.object))
  }

  /**
   * A world point in pixels. `z` is ignored by the flat camera, which is why
   * every existing 2D caller can keep passing two numbers.
   */
  function toScreen(x, y, z = 0) {
    if (state.flat()) {
      return {
        x: (x - state.view.x) * state.view.zoom + state.viewport.width / 2,
        y: state.viewport.height / 2 - (y - state.view.y) * state.view.zoom
      }
    }
    const camera = state.readyCamera()
    const point = new THREE.Vector3(x, y, z)
    // Behind the eye is a question about the camera, not about the depth
    // range: a camera looks down its own -Z, so anything with a positive z in
    // camera space is behind it. Testing the projected depth instead — which
    // is what this used to do — called a point four hundred metres in front
    // "behind", and a point genuinely behind but within range "in front", so a
    // caller drew its gizmo at a convincing wrong place.
    const behind = point.clone().applyMatrix4(camera.matrixWorldInverse).z > 0
    const projected = point.project(camera)
    return {
      x: (projected.x * 0.5 + 0.5) * state.viewport.width,
      y: (0.5 - projected.y * 0.5) * state.viewport.height,
      behind
    }
  }

  /**
   * A pixel as a point in the world.
   *
   * Flat, this is exact. In perspective a pixel is a ray rather than a point,
   * so it resolves to whatever the ray first hits — and to the ground plane
   * when it hits nothing, because dropping a type onto empty air should still
   * land where the person was pointing.
   */
  function toWorld(pixelX, pixelY) {
    if (state.flat()) {
      return {
        x: (pixelX - state.viewport.width / 2) / state.view.zoom + state.view.x,
        y: state.view.y - (pixelY - state.viewport.height / 2) / state.view.zoom
      }
    }
    const [hit] = rayHits(pixelX, pixelY)
    if (hit) return { x: hit.point.x, y: hit.point.y, z: hit.point.z }

    // rayHits has just aimed the shared raycaster through this pixel, so the
    // ray is the one to intersect the ground with — no need to build a second.
    const castRay = raycaster.ray
    const toGround = castRay.direction.y < -1e-6 ? -castRay.origin.y / castRay.direction.y : 0
    const groundPoint = castRay.at(toGround > 0 ? toGround : 10, new THREE.Vector3())
    return { x: groundPoint.x, y: groundPoint.y, z: groundPoint.z }
  }

  /** Every entity under a screen point, front to back. */
  function pick(world, pixelX, pixelY) {
    if (state.flat()) {
      const worldPoint = toWorld(pixelX, pixelY)
      const hits = world.entities.filter(entity => {
        const { w, h } = entityDrawSize(entity)
        const angle = -spinRadians(entity)
        const deltaX = worldPoint.x - entity.x,
          deltaY = worldPoint.y - entity.y
        const localX = deltaX * Math.cos(angle) - deltaY * Math.sin(angle)
        const localY = deltaX * Math.sin(angle) + deltaY * Math.cos(angle)
        return Math.abs(localX) <= w / 2 && Math.abs(localY) <= h / 2
      })
      return hits.reverse()
    }
    // The ray already answers front to back, and it answers it against the
    // geometry actually on screen rather than against a box approximating it.
    const seen = new Set()
    const found = []
    for (const hit of rayHits(pixelX, pixelY)) {
      const id = entityIdOf(hit.object)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const entity = world.byId(id)
      if (entity) found.push(entity)
    }
    return found
  }

  /**
   * Which named node of one entity is under a screen point, and where on it.
   *
   * A model's skinned mesh answers with the bone its hit face is most weighted
   * to; any other mesh answers with its nearest named ancestor, a named part
   * included. A hit on something hung from the entity through
   * `entity.attachments` answers with the node it hangs from, and names the
   * attachment. `point` and `normal` are in that node's own space, so an
   * attachment written there is where the ray met the surface and moves with
   * the node. Null when the ray does not meet the entity.
   *
   * `ignore` lists attachment names the ray passes through, such as a preview
   * drawn under the pointer.
   *
   * @returns {{ node: string, point: number[], normal: number[], attachment: string|null }|null}
   */
  function pickNode(entity, pixelX, pixelY, { ignore = [] } = {}) {
    const isIgnored = candidate => ignore.includes(attachmentAbove(candidate.object)?.userData.attachment)
    const hit = rayHits(pixelX, pixelY).find(
      candidate => entityIdOf(candidate.object) === entity.id && !isIgnored(candidate)
    )
    if (!hit) return null
    const hung = attachmentAbove(hit.object)
    const node = hung ? hung.parent : (boneUnder(hit) ?? namedAncestor(hit.object))
    if (!node) return null
    const point = node.worldToLocal(hit.point.clone())
    const normal = hit.face
      ? hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .transformDirection(node.matrixWorld.clone().invert())
      : new THREE.Vector3(0, 1, 0)
    return {
      node: node.name,
      point: point.toArray(),
      normal: normal.toArray(),
      attachment: hung?.userData.attachment ?? null
    }
  }

  /**
   * The world ray through a screen point, for tools that want to intersect
   * their own objects — a 3D gizmo — without going through entity picking.
   *
   * `rayHits` aims the shared raycaster through the same pixel, so a tool
   * that reaches for this and then casts against its own scene objects sees
   * exactly the ray the entity pick would have used.
   */
  function ray(pixelX, pixelY) {
    state.readyCamera()
    state.scene.updateMatrixWorld()
    raycaster.setFromCamera(state.toNDC(pixelX, pixelY), state.activeCamera())
    return raycaster.ray
  }

  state.rayHits = rayHits
  state.toScreen = toScreen
  state.toWorld = toWorld
  state.pick = pick
  state.pickNode = pickNode
  state.ray = ray
}

/** The bone a skinned hit's face leans on most: its three corners' skin weights, summed per bone. */
function boneUnder(hit) {
  const mesh = hit.object
  const skinIndex = mesh.isSkinnedMesh && mesh.geometry.attributes.skinIndex
  if (!skinIndex || !hit.face) return null
  const skinWeight = mesh.geometry.attributes.skinWeight
  const weightOf = new Map()
  for (const corner of [hit.face.a, hit.face.b, hit.face.c]) {
    for (let slot = 0; slot < skinIndex.itemSize; slot++) {
      const bone = skinIndex.getComponent(corner, slot)
      weightOf.set(bone, (weightOf.get(bone) ?? 0) + skinWeight.getComponent(corner, slot))
    }
  }
  const [heaviest] = [...weightOf].sort((first, second) => second[1] - first[1])
  return mesh.skeleton.bones[heaviest[0]] ?? null
}

/** The attachment group a hit object is inside, or null. model-nodes.js marks each group with its name. */
function attachmentAbove(object) {
  for (let node = object; node; node = node.parent) if (node.userData.attachment) return node
  return null
}

/** The nearest object with a name, from the hit object up. */
function namedAncestor(object) {
  for (let node = object; node; node = node.parent) if (node.name) return node
  return null
}
