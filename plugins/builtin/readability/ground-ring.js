/**
 * Readability: the ground ring — a coloured band on the floor under the one
 * actor a rule names.
 *
 * It answers "which one is mine" in a crowd where a silhouette cannot, and a
 * hundred of them mark nothing, so the ring is handed out differently from the
 * keyline and the shadow: one actor, named by the rule.
 *
 * It is drawn beside an entity rather than by it: the band is geometry this
 * plugin builds, so a model's own materials are never touched to make room for
 * it.
 */
import * as THREE from 'three/webgpu'
import { attribute } from 'three/tsl'
import { readColour } from '../../../engine/render/read-value.js'
import { DRAWN } from '../../../engine/render/scene-layers.js'
import { groundRingBand } from './ground-band.js'
import { placeList, placeMarks, seedInstanceMatrices } from './floor-mark.js'

export function makeGroundRings(host) {
  const { scene, view, readability } = host

  /**
   * Every ground ring in the frame, in one draw call.
   *
   * Built like the contact shadow — one instanced quad, capacity kept — because
   * a ring is the same kind of thing: a flat mark on the floor, occluded by
   * whatever stands in front of it.
   *
   * Its own geometry, not the shadow's: an instanced attribute belongs to the
   * geometry, so two instanced meshes sharing one quad would share one set of
   * per-instance values.
   */
  const RING_QUAD = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const ringPlaces = placeList()
  const ringColours = new Map()
  let groundRings = null
  let ringTints = null
  let ringStrengths = null

  /** A declared ring colour, read once per distinct value. */
  function ringColour(declared) {
    let colour = ringColours.get(declared)
    if (!colour) {
      colour = readColour(declared, 'mesh.ringColour') || new THREE.Color('#ffffff')
      ringColours.set(declared, colour)
    }
    return colour
  }

  /** The instanced material every ground ring in the frame shares. */
  function groundRingMaterial() {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, fog: false
    })
    // The tint is the colour rather than a multiply on top of one, because the
    // material carries no colour of its own for it to multiply into.
    material.colorNode = attribute('ringTint', 'vec3')
    material.opacityNode = attribute('ringStrength', 'float').mul(groundRingBand())
    material.alphaTest = 0.004
    return material
  }

  /** Grow the ring instance room to hold `wanted`, never shrinking it. */
  function growGroundRings(wanted) {
    if (groundRings && groundRings.instanceMatrix.count >= wanted) return
    const room = Math.max(8, 2 ** Math.ceil(Math.log2(wanted)))
    if (groundRings) {
      scene.remove(groundRings)
      groundRings.dispose()
    }
    ringTints = new THREE.InstancedBufferAttribute(new Float32Array(room * 3), 3)
    ringStrengths = new THREE.InstancedBufferAttribute(new Float32Array(room), 1)
    RING_QUAD.setAttribute('ringTint', ringTints)
    RING_QUAD.setAttribute('ringStrength', ringStrengths)
    groundRings = new THREE.InstancedMesh(RING_QUAD, groundRingMaterial(), room)
    seedInstanceMatrices(groundRings)
    // Rewritten every frame, so a bounding sphere from them is a frame old.
    groundRings.frustumCulled = false
    // After the contact shadow, which is the other transparent thing on the
    // floor under the same actor.
    groundRings.renderOrder = 1
    groundRings.layers.set(DRAWN)
    scene.add(groundRings)
  }

  /** True when the ring rule names this entity. */
  function ringNames(entity) {
    const rule = readability.ring
    if (rule === 'followed') {
      // A first-person body wears the camera, so its ring would be drawn under
      // the eye and mark nothing.
      if (view.mode === 'first-person') return false
      return view.follows != null && entity.id === view.follows
    }
    return typeof rule === 'string' && (entity.id === rule || entity.type === rule)
  }

  /**
   * Note where one entity's ring goes.
   *
   * The radius comes from the entity's own footprint, so a boar's ring is a
   * boar wide. Unlike the shadow it does not spread or fade with lift: the ring
   * states a position on the ground, and one that grew with height would blur
   * the only fact it carries.
   */
  function noteGroundRing(entity, declared, shape, place) {
    const asked = declared.ring ?? ringNames(entity)
    if (!asked || !shape) return
    const scale = entity.scale ?? 1
    const across = Math.max(shape.w, shape.d) * scale
    // Wider than the contact shadow's 0.55, so the band lies outside the dark
    // ellipse instead of muddying it.
    const stated = typeof asked === 'number' ? asked : across * 0.85
    if (!(stated > 0)) return

    const at = ringPlaces.count++
    ringPlaces.x[at] = place.x
    ringPlaces.z[at] = place.z || 0
    ringPlaces.radius[at] = stated
    ringPlaces.colour[at] = declared.ringColour ?? readability.ringColour
    ringPlaces.strength[at] = declared.ringStrength ?? readability.ringStrength
  }

  /** Write the frame's rings into the instanced mesh. Called once per sync. */
  function placeGroundRings() {
    placeMarks(ringPlaces, {
      meshOf: () => groundRings,
      // Above the contact shadow's 0.015, so the colour wins where they meet.
      height: readability.groundY + 0.02,
      grow: growGroundRings,
      attributesOf: () => [ringTints, ringStrengths],
      write: (places, i) => {
        const colour = ringColour(places.colour[i])
        ringTints.setXYZ(i, colour.r, colour.g, colour.b)
        ringStrengths.setX(i, places.strength[i])
      }
    })
  }

  /** The ground ring of one entity, when the ring rule or `mesh.ring` names it. */
  function draw(entity, object, place, declared, record) {
    if (entity.hidden) return
    noteGroundRing(entity, declared, record.shape, place)
  }

  /** Start a frame with no ring noted yet. */
  function begin() { ringPlaces.count = 0 }

  /** How many rings this frame noted, for `stats`. */
  const count = stats => { stats.groundRings = ringPlaces.count }

  /**
   * The one entity named by the ring rule. Everything else that is never moved
   * and declares no mark can be left exactly as it was last frame.
   */
  function heldId(seen) {
    const rule = readability.ring
    if (rule === 'followed') return seen.mode === 'first-person' ? null : seen.follows ?? null
    return typeof rule === 'string' ? rule : null
  }

  /** A declared ring needs the full pass on a still frame and on a moved one. */
  const holds = (entity, declared) => declared.ring !== undefined
  const holdsMoving = (entity, declared) => declared.ring !== undefined

  return { draw, begin, place: placeGroundRings, count, heldId, holds, holdsMoving }
}
