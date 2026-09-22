/**
 * Kernel: the contact shadow — a soft ellipse under a moving thing, all of them
 * in one draw call.
 *
 * It is drawn beside an entity rather than by it: the ellipse is geometry the
 * renderer builds, so a model's own materials are never touched to make room
 * for it.
 */
import * as THREE from 'three/webgpu'
import { attribute, oneMinus, smoothstep } from 'three/tsl'
import { readColour } from './read-value.js'
import { groundReach } from './ground-band.js'
import { seedInstanceMatrices } from './floor-mark.js'
import { DRAWN } from './scene-layers.js'

export function makeContactShadows(state) {
  /**
   * Every contact shadow in the frame, in one draw call.
   *
   * The art budget allows one shadow-casting light, so this is a projected
   * ellipse and not a second shadow map. Capacity grows and is never given
   * back: a horde that peaked at three hundred will peak again.
   */
  const SHADOW_QUAD = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

  /**
   * One frame's contact shadows, as one typed array: x, z, radius, strength.
   *
   * A plain array stores a fractional double as a heap number, and the four
   * parallel arrays a shadow used to write spread one entity across four cache
   * streams. One `Float64Array` with a stride keeps a shadow's four numbers in
   * the same cache line and allocates nothing once the room has grown.
   */
  const SHADOW_STRIDE = 4
  let shadowData = new Float64Array(0)
  let shadowCount = 0

  /** Room for one shadow per entity, keeping what is already there. */
  function growShadowData(length) {
    if (shadowData.length >= length * SHADOW_STRIDE) return
    const next = new Float64Array(length * SHADOW_STRIDE)
    next.set(shadowData)
    shadowData = next
  }

  let contactShadows = null
  let contactStrengths = null

  /** The one instanced material every contact shadow in the frame shares. */
  function contactShadowMaterial() {
    const material = new THREE.MeshBasicNodeMaterial({
      color: readColour(state.readability.shadowColour, 'readability.shadowColour') || new THREE.Color('#000000'),
      transparent: true, depthWrite: false, fog: false
    })
    // Per instance, so one draw call carries every shadow at its own weight.
    const strength = attribute('contactStrength', 'float')
    material.opacityNode = strength.mul(oneMinus(smoothstep(0.15, 1.0, groundReach())))
    // What the GLSL discarded. Below this the ellipse is invisible and only
    // costs blending.
    material.alphaTest = 0.004
    return material
  }

  /** Grow the shadow instance room to hold `wanted`, never shrinking it. */
  function growContactShadows(wanted) {
    // Against the room allocated, not against `count` — `count` is last frame's
    // number of shadows and says nothing about how many will fit.
    if (contactShadows && contactShadows.instanceMatrix.count >= wanted) return
    const room = Math.max(64, 2 ** Math.ceil(Math.log2(wanted)))
    if (contactShadows) {
      state.scene.remove(contactShadows)
      contactShadows.dispose()
    }
    contactStrengths = new THREE.InstancedBufferAttribute(new Float32Array(room), 1)
    SHADOW_QUAD.setAttribute('contactStrength', contactStrengths)
    contactShadows = new THREE.InstancedMesh(SHADOW_QUAD, contactShadowMaterial(), room)
    seedInstanceMatrices(contactShadows)
    // The matrices are rewritten every frame, so a bounding sphere computed
    // from them is a frame out of date and would cull live shadows.
    contactShadows.frustumCulled = false
    contactShadows.layers.set(DRAWN)
    state.scene.add(contactShadows)
  }

  /**
   * Note where one entity's shadow goes, and how hard it presses.
   *
   * It tightens and darkens as the thing nears the ground, which is what says
   * a bird is flying and a rat is walking.
   */
  function noteContactShadow(entity, declared, shape, moved, place) {
    const asked = declared.shadow ?? (moved && state.readability.shadow)
    if (!asked || !shape) return
    const scale = entity.scale ?? 1
    const across = Math.max(shape.w, shape.d) * scale
    const stated = typeof asked === 'number' ? asked : across * 0.55
    if (!(stated > 0)) return

    const lift = Math.min(1, Math.max(0, (entity.y - shape.h * scale / 2 - state.readability.groundY) / state.readability.shadowRange))
    const at = shadowCount++ * SHADOW_STRIDE
    shadowData[at] = place.x
    shadowData[at + 1] = place.z || 0
    shadowData[at + 2] = stated * (1 + lift * 0.7)
    // `(1 - lift) ** 1.5` is a `Math.pow` call per entity per frame. The
    // exponent is constant and the base is never negative, so the square root
    // is the same number for a hardware instruction.
    const fade = 1 - lift
    shadowData[at + 3] = (declared.shadowStrength ?? state.readability.shadowStrength) * fade * Math.sqrt(fade)
  }

  /**
   * Write the frame's shadows into the instanced mesh. Called once per sync.
   *
   * A shadow is a translation, a scale and one strength, so the instance matrix
   * is written entry by entry: `makeScale` and `setPosition` would build a whole
   * matrix per shadow to copy five numbers out of it.
   */
  function placeContactShadows() {
    if (!shadowCount) {
      if (contactShadows) contactShadows.count = 0
      return
    }
    growContactShadows(shadowCount)
    const matrix = contactShadows.instanceMatrix.array
    const strengths = contactStrengths.array
    // Just clear of the floor, or the two surfaces fight for the same pixels.
    const height = state.readability.groundY + 0.015
    for (let i = 0; i < shadowCount; i++) {
      const at = i * SHADOW_STRIDE
      const base = i * 16
      const wide = shadowData[at + 2] * 2
      matrix[base] = wide
      matrix[base + 10] = wide
      matrix[base + 12] = shadowData[at]
      matrix[base + 13] = height
      matrix[base + 14] = shadowData[at + 1]
      strengths[i] = shadowData[at + 3]
    }
    contactShadows.count = shadowCount
    contactShadows.instanceMatrix.needsUpdate = true
    contactStrengths.needsUpdate = true
  }

  /** Start a frame with no shadow noted yet. */
  function beginMarks() {
    shadowCount = 0
  }

  /** How many contact shadows this frame noted, for `stats`. */
  function count() {
    return shadowCount
  }

  return { growShadowData, noteContactShadow, placeContactShadows, beginMarks, count }
}
