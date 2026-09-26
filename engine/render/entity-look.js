/**
 * Kernel: what one thing is — how it turns, where its origin is, which cell of
 * a sheet it shows, and the colour it falls back to with no texture.
 */
import * as THREE from 'three/webgpu'
import { turnRadians } from '../frame-plan.js'

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

/**
 * Where frame N is in a sheet, as a UV window.
 *
 * Frames run left to right then top to bottom, and the column count comes from
 * the image once it has loaded — declaring it as well would be a second source
 * of truth that could disagree with the file.
 */
export function frameWindow(sprite, frame, image) {
  const [cellWidth, cellHeight] = sprite.size || [image.width, image.height]
  const cols = Math.max(1, Math.floor(image.width / cellWidth))
  const rows = Math.max(1, Math.floor(image.height / cellHeight))
  const frameIndex = Math.max(0, Math.floor(frame || 0)) % (cols * rows)
  return {
    repeat: [cellWidth / image.width, cellHeight / image.height],
    // Three's V axis runs bottom-up while a sheet reads top-down.
    offset: [
      ((frameIndex % cols) * cellWidth) / image.width,
      1 - cellHeight / image.height - (Math.floor(frameIndex / cols) * cellHeight) / image.height
    ]
  }
}

/** Stable colour per type so untextured entities are still distinguishable. */
export function entityTint(type) {
  let hash = 0
  for (let index = 0; index < type.length; index++) hash = (hash * 31 + type.charCodeAt(index)) | 0
  const color = new THREE.Color()
  color.setHSL(((hash >>> 0) % 360) / 360, 0.32, 0.55)
  return color
}
