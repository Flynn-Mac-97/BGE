/**
 * Kernel: the keyline — a dark line of constant screen width round a moving
 * thing's silhouette.
 *
 * A keyline belongs on the things a player tracks — the characters, the
 * enemies, the pickups — and on nothing else: a line round every tuft of grass
 * is edge detail, not readability. "Has moved since it appeared" is the
 * renderer's own answer to which is which, and any mesh overrides it by
 * declaring `keyline` in pixels. A `parts` body and a model both work; a GLB's
 * own materials are never touched, so a model gets its keyline even though it
 * cannot be given a material at all.
 *
 * The line is drawn beside an entity rather than by it: the hull is geometry
 * the renderer builds, so a model's own materials are never touched to make room
 * for it.
 */
import * as THREE from 'three/webgpu'
import { declaredNumber, meshParts } from '../frame-plan.js'
import { readColour } from './read-value.js'
import { hullGeometry, hullCache, keylineGrowth } from './keyline-hull.js'
import { namedNodes } from './model-nodes.js'

export function makeKeylineMarks(state) {
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
      key = `parts:${meshParts(declared, `${entity.type}.mesh`).signature}`
    } else {
      key = `${shape?.kind}:${shape?.w},${shape?.h},${shape?.d}`
    }
    if (!hullCache.has(key)) hullCache.set(key, hullGeometry(object))
    return hullCache.get(key)
  }

  /** How wide this entity's keyline is, in screen pixels. Zero is none. */
  function keylineWidth(declared, moved) {
    if (declared.keyline === undefined) return moved ? state.readability.keyline : 0
    return Math.max(0, declaredNumber(declared.keyline, 0, 'mesh.keyline'))
  }

  /** Whether the outline already drawn matches the width and colour this frame wants. */
  function keylineAlreadyRight(record, width, colour) {
    if (record.keylineWidth !== width || record.keylineColour !== colour) return false
    return width <= 0 || record.keylineMesh !== null
  }

  /** Take the outline off the object and forget it. */
  function clearKeyline(object, record, drawn, colour) {
    if (drawn) { object.remove(drawn); state.release(drawn) }
    record.keylineMesh = null
    record.keylineWidth = 0
    record.keylineColour = colour
    record.keylineReady = true
    object.userData.keylineMesh = null
  }

  /** Build the outline mesh and hang it on the object, or leave it for the next frame. */
  function addKeyline(entity, object, declared, shape, record, width, colour) {
    const geometry = hullFor(entity, object, declared, shape)
    // A model still loading. The next frame builds it, and there is no state to keep.
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

  /** Add, resize or remove an entity's keyline so it matches the width it now declares. */
  function updateKeyline(entity, object, declared, shape, moved, record) {
    const width = keylineWidth(declared, moved)
    const colour = declared.keylineColour ?? state.readability.keylineColour
    // Almost every moving entity keeps the outline it already has, so the answer
    // is kept on the record. Reading it off `userData` meant a property whose
    // shape grows with every feature the renderer gains, once per entity per frame.
    if (keylineAlreadyRight(record, width, colour)) { record.keylineReady = true; return }

    const drawn = record.keylineMesh ?? object.userData.keylineMesh
    if (width <= 0) { clearKeyline(object, record, drawn, colour); return }
    if (drawn) { object.remove(drawn); state.release(drawn) }
    addKeyline(entity, object, declared, shape, record, width, colour)
  }

  return { updateKeyline }
}
