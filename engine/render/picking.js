/**
 * Kernel: a ray into the scene, and the two-way mapping between a world point
 * and a pixel.
 *
 * The raycaster sees every layer, because a merged entity keeps its own mesh on
 * a layer the camera does not draw.
 */
import * as THREE from 'three/webgpu'
import { entityDrawSize, spinRadians } from '../frame-plan.js'

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
  function rayHits(px, py) {
    state.readyCamera()
    state.scene.updateMatrixWorld()
    raycaster.setFromCamera(state.toNDC(px, py), state.activeCamera())
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
    const p = point.project(camera)
    return {
      x: (p.x * 0.5 + 0.5) * state.viewport.width,
      y: (0.5 - p.y * 0.5) * state.viewport.height,
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
  function toWorld(px, py) {
    if (state.flat()) {
      return {
        x: (px - state.viewport.width / 2) / state.view.zoom + state.view.x,
        y: state.view.y - (py - state.viewport.height / 2) / state.view.zoom
      }
    }
    const [hit] = rayHits(px, py)
    if (hit) return { x: hit.point.x, y: hit.point.y, z: hit.point.z }

    // rayHits has just aimed the shared raycaster through this pixel, so the
    // ray is the one to intersect the ground with — no need to build a second.
    const castRay = raycaster.castRay
    const toGround = castRay.direction.y < -1e-6 ? -castRay.origin.y / castRay.direction.y : 0
    const p = castRay.at(toGround > 0 ? toGround : 10, new THREE.Vector3())
    return { x: p.x, y: p.y, z: p.z }
  }

  /** Every entity under a screen point, front to back. */
  function pick(world, px, py) {
    if (state.flat()) {
      const p = toWorld(px, py)
      const hits = world.entities.filter(e => {
        const { w, h } = entityDrawSize(e)
        const a = -spinRadians(e)
        const dx = p.x - e.x,
          dy = p.y - e.y
        const lx = dx * Math.cos(a) - dy * Math.sin(a)
        const ly = dx * Math.sin(a) + dy * Math.cos(a)
        return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2
      })
      return hits.reverse()
    }
    // The ray already answers front to back, and it answers it against the
    // geometry actually on screen rather than against a box approximating it.
    const seen = new Set()
    const found = []
    for (const hit of rayHits(px, py)) {
      const id = entityIdOf(hit.object)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const e = world.byId(id)
      if (e) found.push(e)
    }
    return found
  }

  /**
   * The world ray through a screen point, for tools that want to intersect
   * their own objects — a 3D gizmo — without going through entity picking.
   *
   * `rayHits` aims the shared raycaster through the same pixel, so a tool
   * that reaches for this and then casts against its own scene objects sees
   * exactly the ray the entity pick would have used.
   */
  function ray(px, py) {
    state.readyCamera()
    state.scene.updateMatrixWorld()
    raycaster.setFromCamera(state.toNDC(px, py), state.activeCamera())
    return raycaster.ray
  }

  state.rayHits = rayHits
  state.toScreen = toScreen
  state.toWorld = toWorld
  state.pick = pick
  state.ray = ray
}
