/**
 * Kernel: what one thing is — how it turns, where its origin is, which cell of
 * a sheet it shows, and the colour it falls back to with no texture.
 */
import * as THREE from 'three/webgpu'
import { meshOf, totalScale, turnRadians } from '../frame-plan.js'

/**
 * Turn one object to match its entity.
 *
 * YXZ, the order the camera and every attachment group in the renderer use: yaw,
 * then pitch, then roll. In XYZ a body that leans and then turns rolls its own
 * horizon. The order is passed to `set` rather than assigned separately so the
 * angles and the order reach the quaternion in one write.
 */
export function turnObject(object, entity) {
  const turn = turnRadians(entity)
  object.rotation.set(turn.x, turn.y, turn.z, 'YXZ')
}

/** The anchors a model may declare. Anything else is treated as the centre. */
const ANCHORS = new Set(['centre', 'center', 'feet'])

/**
 * How far to drop a model whose origin is not its middle.
 *
 * An entity's `y` is its CENTRE. That is what a box geometry wants and what
 * every brush in a level depends on, so it is not negotiable. But a character
 * model is authored standing on the floor with its origin between its feet,
 * because the floor is the only place an artist can put an origin repeatably —
 * and a weapon's origin is its grip for the same reason. Planting a
 * feet-origin model at the centre leaves it floating by half its own height,
 * with its head outside its own collider. The symptom is a player hovering a
 * metre off the ground, which reads as a scale bug and is not one.
 *
 * So the model says where its origin is, once, in the type file:
 *
 *   mesh: { model: 'terrorist.glb', anchor: 'feet' }
 *
 * Height comes from the declared box, then the collider — the same order the
 * rest of the renderer trusts, because a thing that has said how big it hits has
 * already said how tall it is.
 */
export function anchorOffset(entity) {
  const declared = meshOf(entity)
  const anchor = declared?.anchor
  if (anchor == null) return 0
  if (!ANCHORS.has(anchor)) {
    // Silence is the enemy: a misspelt anchor would otherwise be a model that
    // is subtly in the wrong place, which nobody ever traces back to a typo.
    console.error(`[render] ${entity.type}.mesh.anchor is "${anchor}" — expected one of ${[...ANCHORS].join(', ')}. Treating it as centre.`)
    return 0
  }
  if (anchor !== 'feet') return 0
  const height = declared.box?.[1] ?? entity.collider?.box?.[1] ?? 0
  return -(height / 2) * totalScale(entity)
}

/**
 * Where frame N sits in a sheet, as a UV window.
 *
 * Frames run left to right then top to bottom, and the column count comes from
 * the image once it has loaded — declaring it as well would be a second source
 * of truth that could disagree with the file.
 */
export function frameWindow(sprite, frame, image) {
  const [cw, ch] = sprite.size || [image.width, image.height]
  const cols = Math.max(1, Math.floor(image.width / cw))
  const rows = Math.max(1, Math.floor(image.height / ch))
  const n = Math.max(0, Math.floor(frame || 0)) % (cols * rows)
  return {
    repeat: [cw / image.width, ch / image.height],
    // Three's V axis runs bottom-up while a sheet reads top-down.
    offset: [(n % cols) * cw / image.width, 1 - ch / image.height - Math.floor(n / cols) * ch / image.height]
  }
}

/** Stable colour per type so untextured entities are still distinguishable. */
export function entityTint(type) {
  let hash = 0
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) | 0
  const c = new THREE.Color()
  c.setHSL(((hash >>> 0) % 360) / 360, 0.32, 0.55)
  return c
}
