/**
 * Kernel: computable facts about what a camera would show.
 *
 * The See plugin asks these; they are kernel because every one is pure —
 * entity in, numbers out — and pure geometry is what an agent reasons about
 * best. Nothing here reads a renderer, a clock, or a file.
 */

/** The drawn extents of an entity, in world units: width, height, length. */
export function boundsOf(entity) {
  const mesh = entity.mesh || entity._definition?.mesh
  if (mesh?.box) return { w: mesh.box[0], h: mesh.box[1], l: mesh.box[2] || 0 }
  if (Array.isArray(mesh?.parts)) {
    let w = 0, h = 0, l = 0
    for (const part of mesh.parts) {
      if (!part.box) continue
      w = Math.max(w, Math.abs(part.at?.[0] || 0) * 2 + part.box[0])
      h = Math.max(h, (part.at?.[1] || 0) + part.box[1])
      l = Math.max(l, Math.abs(part.at?.[2] || 0) * 2 + (part.box[2] || 0))
    }
    if (w || h) return { w, h, l }
  }
  const sprite = entity.sprite || entity._definition?.sprite
  if (sprite?.width || sprite?.height) return { w: sprite.width || 1, h: sprite.height || 1, l: 0 }
  const collider = entity.collider || entity._definition?.collider
  if (collider?.box) return { w: collider.box[0], h: collider.box[1], l: collider.box[2] || 0 }
  if (collider?.circle) return { w: collider.circle * 2, h: collider.circle * 2, l: collider.circle * 2 }
  return { w: 1, h: 1, l: 1 }
}

/** A stable colour per type name, so two sketches of one world agree. */
export function typeColour(name) {
  let hash = 0
  for (const character of String(name)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const bright = 0.45 + ((hash >>> 9) % 40) / 100
  const [r, g, b] = hueToRgb(hue, 0.65, bright)
  return [r, g, b, 255]
}

function hueToRgb(hue, saturation, lightness) {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const at = n => {
    const k = (n + hue / 30) % 12
    return Math.round((lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [at(0), at(8), at(4)]
}

/**
 * A camera to look at one entity: a three-quarter front view, because a model
 * is judged by its face and silhouette and a straight-behind view shows
 * neither. The subject's own facing decides where "front" is.
 */
export function frameSubject(entity, bounds) {
  const distance = Math.max(2, Math.max(bounds.w, bounds.h, bounds.l || 0) * 2.5)
  const pitch = -0.35
  const facing = Number.isFinite(entity.yaw) ? entity.yaw : (entity.rotation || 0) * Math.PI / 180
  // The eye is placed past the nose and off to one side; its yaw looks back.
  const azimuth = facing + Math.PI - 0.6
  const flat = distance * Math.cos(-pitch)
  return {
    mode: 'third-person-still',
    x: entity.x + Math.sin(azimuth) * flat,
    y: entity.y + distance * Math.sin(-pitch),
    z: (entity.z || 0) + Math.cos(azimuth) * flat,
    yaw: azimuth, pitch, fov: 50
  }
}

/**
 * Degrees between where `entity` points and where `other` stands, 0 meaning
 * dead-on. A nose points at -Z at yaw 0, the same convention the renderer
 * turns bodies by.
 */
export function facingOffset(entity, other) {
  const wanted = Math.atan2(-(other.x - entity.x), -((other.z || 0) - (entity.z || 0)))
  const yaw = Number.isFinite(entity.yaw) ? entity.yaw : (entity.rotation || 0) * Math.PI / 180
  const off = Math.abs(((wanted - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
  return { degreesOff: Math.round(off * 180 / Math.PI), facingIt: off < Math.PI / 6 }
}

/** Axis-aligned world boxes, centred on the entity, feet at the centre's base. */
export function boxesTouch(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2
    && Math.abs(a.y - b.y) < (a.h + b.h) / 2
    && Math.abs(a.z - b.z) < ((a.l || 0) + (b.l || 0)) / 2
}

/** 3x5 digit stamps for marks in a sketch, where there is no font. */
export const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111',
  '101101111001001', '111100111001111', '111100111101111', '111001010010010',
  '111101111101111', '111101111001111']
