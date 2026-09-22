/**
 * The three things that make a moving thing readable, and who gets them.
 *
 * A keyline is a dark line of CONSTANT SCREEN WIDTH round a silhouette; a
 * contact shadow is a soft ellipse under it; a ground ring is a coloured band
 * on the floor round its feet. The first two belong on the things a player
 * tracks — the characters, the enemies, the pickups — and on nothing else: a
 * line round every tuft of grass is edge detail, not readability. "Has moved
 * since it appeared" is the renderer's own answer to which is which, read off
 * the record merging already keeps, and any mesh overrides it by declaring
 * `keyline` in pixels or `shadow` in metres. A `parts` body and a model both
 * work; a GLB's own materials are never touched, so a model gets its keyline
 * even though it cannot be given a material at all.
 *
 * The ring is handed out differently: it names ONE actor. It answers "which
 * one is mine" in a crowd where a silhouette cannot, and a hundred of them
 * mark nothing.
 *
 * All three are drawn in the scene, so a frame taken without the interface
 * layer, at a stated size, or by a tab in the background still carries them.
 *
 * Kept apart from the object builder because a mark is drawn beside an entity
 * rather than by it: a keyline and a floor mark are geometry the renderer builds,
 * and a model's own materials are never touched to make room for them.
 */
import * as THREE from 'three/webgpu'
import { attribute, oneMinus, smoothstep } from 'three/tsl'
import { number, partsOf } from '../frame-plan.js'
import { readColour } from './read-value.js'
import { hullGeometry, hullCache, keylineGrowth } from './keyline-hull.js'
import { groundReach, groundRingBand } from './ground-band.js'
import { namedNodes } from './model-nodes.js'
import { DRAWN } from './scene-layers.js'

/**
 * Kernel: the defaults and the rule for who gets a readability mark.
 *
 * Every number here is a default a game may set through `renderer.readability`.
 */
export function makeReadability() {
  return {
    keyline: 2.2,               // screen pixels
    keylineColour: '#1d1418',
    shadow: true,
    shadowColour: '#0d1409',
    shadowStrength: 0.44,
    /**
     * Who gets a ground ring: `'followed'` — the entity the camera follows —
     * or `false`, or an entity id or type name. There is deliberately no
     * setting for every actor; `mesh.ring` names any extras one at a time.
     */
    ring: 'followed',
    ringColour: '#4fd8ff',
    ringStrength: 0.85,
    /** Where the floor is. The same y `toWorld` drops an unhit ray onto. */
    groundY: 0,
    /** Metres of lift over which a shadow spreads out and fades to nothing. */
    shadowRange: 1.6
  }
}

export function makeReadabilityMarks(state) {
  const keylineMaterials = new Map()

  /**
   * A back-faced copy grown in screen space: the inverted hull, in pixels.
   *
   * Basic rather than a shader of its own so three still owns fog, tone mapping
   * and the output colour space — a keyline is a flat colour and needs nothing
   * else from a material. Only the vertex position is replaced.
   */
  function keylineMaterial(width, colour, flat) {
    const key = `${width}|${colour}|${flat ? 'flat' : 'solid'}`
    const cached = keylineMaterials.get(key)
    if (cached) return cached

    const material = new THREE.MeshBasicNodeMaterial({
      color: readColour(colour, 'mesh.keylineColour') || new THREE.Color('#000000'),
      // Back faces only for a solid: the body's own front faces then cover the
      // middle and leave the grown rim showing. A flat shape has no back face
      // to show, so it draws both sides and leans on the depth nudge instead.
      side: flat ? THREE.DoubleSide : THREE.BackSide, depthTest: true, depthWrite: true
    })
    material.vertexNode = keylineGrowth(width, flat)
    keylineMaterials.set(key, material)
    return material
  }

  /** The hull this entity's keyline is drawn from, built once per shape. */
  function hullFor(entity, object, declared, shape) {
    let key
    if (declared.model) {
      // Built from the loaded file, so it is the rest pose: a limb `pose`
      // swings moves inside its own outline. That is a pixel or two on a leg at
      // play distance, and it buys one draw call per character instead of one
      // per limb.
      if (!namedNodes.has(object)) return null
      key = `model:${declared.model}`
    } else if (shape?.kind === 'parts') {
      key = `parts:${partsOf(declared, `${entity.type}.mesh`).signature}`
    } else {
      key = `${shape?.kind}:${shape?.w},${shape?.h},${shape?.d}`
    }
    if (!hullCache.has(key)) hullCache.set(key, hullGeometry(object))
    return hullCache.get(key)
  }

  /** How wide this entity's keyline is, in screen pixels. Zero is none. */
  function keylineWidth(declared, moved) {
    if (declared.keyline === undefined) return moved ? state.readability.keyline : 0
    return Math.max(0, number(declared.keyline, 0, 'mesh.keyline'))
  }

  /** Add, resize or remove an entity's keyline so it matches the width it now declares. */
  function updateKeyline(entity, object, declared, shape, moved, record) {
    const width = keylineWidth(declared, moved)
    const colour = declared.keylineColour ?? state.readability.keylineColour
    // Almost every moving entity keeps the outline it already has, so the answer
    // is kept on the record. Reading it off `userData` meant a property whose
    // shape grows with every feature the renderer gains, once per entity per frame.
    if (record.keylineWidth === width && record.keylineColour === colour
        && (width <= 0 || record.keylineMesh !== null)) { record.keylineReady = true; return }

    const drawn = record.keylineMesh ?? object.userData.keylineMesh
    if (width <= 0) {
      if (drawn) { object.remove(drawn); state.release(drawn) }
      record.keylineMesh = null
      record.keylineWidth = 0
      record.keylineColour = colour
      record.keylineReady = true
      object.userData.keylineMesh = null
      return
    }
    if (drawn) { object.remove(drawn); state.release(drawn) }

    const geometry = hullFor(entity, object, declared, shape)
    // A model still loading. The next frame builds it, and there is no state
    // to keep.
    if (!geometry) { record.keylineReady = false; return }

    const hull = new THREE.Mesh(geometry, keylineMaterial(width, colour, shape?.kind === 'quad'))
    // Read by hullGeometry, and by the batcher deciding what to hide.
    hull.userData.keyline = true
    hull.userData.width = width
    hull.userData.colour = colour
    object.add(hull)
    object.userData.keylineMesh = hull
    record.keylineMesh = hull
    record.keylineWidth = width
    record.keylineColour = colour
    record.keylineReady = true
  }

  /**
   * Every contact shadow in the frame, in one draw call.
   *
   * The art budget allows one shadow-casting light, so this is a projected
   * ellipse and not a second shadow map. Capacity grows and is never given
   * back: a horde that peaked at three hundred will peak again.
   */
  const SHADOW_QUAD = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

  /**
   * One frame's floor marks, as parallel numeric arrays.
   *
   * A growing array of `{x, z, radius, strength}` objects meant fifty thousand
   * short-lived objects a frame on a moving level, and the collector paid for
   * every one. The fields are written by index instead, so nothing is allocated
   * once the arrays have reached their high-water mark.
   */
  function placeList() {
    return { count: 0, x: [], z: [], radius: [], colour: [], strength: [] }
  }

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
   * Give one entity its keyline and note its shadow and ring. True if it has a
   * keyline.
   *
   * Scenery leaves in the first three lines. Several hundred props that never
   * move must not pay to read their own shape again on every frame.
   */
  function updateReadability(entity, object, declared, shape, moved, place, record) {
    const asks = declared.keyline !== undefined || declared.shadow !== undefined
      || declared.ring !== undefined
    // The ringed actor is named, so it is entitled to a ring on the frame it
    // appears, before it has moved. An object already drawing a keyline is not
    // scenery either: leaving early would strand the hull when the declaration
    // that asked for it is taken away.
    if (!moved && !asks && !ringNames(entity) && record.keylineMesh === null) return false

    updateKeyline(entity, object, declared, shape, moved, record)
    if (!entity.hidden) {
      noteContactShadow(entity, declared, shape, moved, place)
      noteGroundRing(entity, declared, shape, place)
    }
    return record.keylineMesh !== null

  }

  /**
   * Write this frame's marks into an instanced quad mesh: a disc of the mark's
   * own radius, lifted to `height` above the floor, then whatever per-instance
   * values the mark carries.
   *
   * Both floor marks are the same kind of thing — a flat disc occluded by
   * whatever stands in front of it — and each keeps its own geometry, because an
   * instanced attribute belongs to the geometry.
   *
   * The instance matrix is written element by element. `Matrix4.makeScale` and
   * `setPosition` build one matrix and `setMatrixAt` copies it, which is three
   * calls and a copy per mark where the mark is only a scale and a translation.
   * Only the five entries a mark can change are written; the rest are seeded
   * once, when the room is built, by `seedInstanceMatrices`.
   */
  function placeMarks(places, { meshOf, height, grow, write, attributesOf = () => [] }) {
    if (!places.count) {
      const mesh = meshOf()
      if (mesh) mesh.count = 0
      return
    }
    grow(places.count)
    // `grow` may have built the mesh and its instanced attributes on this very
    // call, so both are read after it rather than before.
    const mesh = meshOf()
    const matrix = mesh.instanceMatrix
    const array = matrix.array
    for (let i = 0; i < places.count; i++) {
      const at = i * 16
      const wide = places.radius[i] * 2
      array[at] = wide
      array[at + 10] = wide
      array[at + 12] = places.x[i]
      array[at + 13] = height
      array[at + 14] = places.z[i]
      if (write) write(places, i)
    }
    mesh.count = places.count
    matrix.needsUpdate = true
    for (const attribute of attributesOf()) attribute.needsUpdate = true
  }

  /**
   * Seed the constant entries of an instanced quad's matrices, once per room.
   *
   * A floor mark is an axis-aligned scale and a translation, so of the sixteen
   * entries nine are always zero and two are always one. Writing the two ones
   * when the room is built leaves five to rewrite per mark per frame instead of
   * sixteen.
   */
  function seedInstanceMatrices(mesh) {
    const array = mesh.instanceMatrix.array
    for (let at = 5; at < array.length; at += 16) {
      array[at] = 1
      array[at + 10] = 1
    }
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
      state.scene.remove(groundRings)
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
    state.scene.add(groundRings)
  }

  /** True when the ring rule names this entity. */
  function ringNames(entity) {
    const rule = state.readability.ring
    if (rule === 'followed') {
      // A first-person body wears the camera, so its ring would be drawn under
      // the eye and mark nothing.
      if (state.view.mode === 'first-person') return false
      return state.view.follows != null && entity.id === state.view.follows
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
    ringPlaces.colour[at] = declared.ringColour ?? state.readability.ringColour
    ringPlaces.strength[at] = declared.ringStrength ?? state.readability.ringStrength
  }

  /** Write the frame's rings into the instanced mesh. Called once per sync. */
  function placeGroundRings() {
    placeMarks(ringPlaces, {
      meshOf: () => groundRings,
      // Above the contact shadow's 0.015, so the colour wins where they meet.
      height: state.readability.groundY + 0.02,
      grow: growGroundRings,
      attributesOf: () => [ringTints, ringStrengths],
      write: (places, i) => {
        const colour = ringColour(places.colour[i])
        ringTints.setXYZ(i, colour.r, colour.g, colour.b)
        ringStrengths.setX(i, places.strength[i])
      }
    })
  }

  /** Start a frame's marks: no shadow and no ring noted yet. */
  function beginMarks() {
    shadowCount = 0
    ringPlaces.count = 0
  }

  /** How many marks this frame noted, for `stats`. */
  function markCounts() {
    return { contactShadows: shadowCount, groundRings: ringPlaces.count }
  }

  state.updateReadability = updateReadability
  state.noteContactShadow = noteContactShadow
  state.placeContactShadows = placeContactShadows
  state.placeGroundRings = placeGroundRings
  state.growShadowData = growShadowData
  state.beginMarks = beginMarks
  state.markCounts = markCounts
}
