/**
 * Kernel: computable facts about what a camera would show.
 *
 * The See plugin asks these; they are kernel because every one is pure —
 * entity in, numbers out — and pure geometry is what an agent reasons about
 * best. Nothing here reads a renderer, a clock, or a file.
 */

/**
 * Which way an entity points, in radians about Y.
 *
 * `yaw` is what game code sets while running. `rotation` is what the level
 * declares: a bare number is degrees of yaw, `[x, y, z]` is pitch, yaw and roll
 * in degrees, the two forms `engine/render.js` reads. Reading an array as a
 * number gives NaN, which spreads into every bearing computed from it.
 */
export function yawOf(entity) {
  if (Number.isFinite(entity.yaw)) return entity.yaw
  const declared = Array.isArray(entity.rotation) ? entity.rotation[1] : entity.rotation
  return (Number(declared) || 0) * Math.PI / 180
}

/** The drawn extents of an entity, in world units: width, height, length. */
export function boundsOf(entity) {
  const mesh = entity.mesh || entity._definition?.mesh
  if (mesh?.box) {
    // A model's box is in model units; the renderer multiplies it by `mesh.scale`.
    const scale = (entity.scale ?? 1) * (mesh.model ? Number(mesh.scale) || 1 : 1)
    return { w: mesh.box[0] * scale, h: mesh.box[1] * scale, l: (mesh.box[2] || 0) * scale }
  }
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

/** The type's hash-derived hue and brightness — the raw material of its colour. */
export function typeHue(name) {
  let hash = 0
  for (const character of String(name)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return { hue: hash % 360, bright: 0.45 + ((hash >>> 9) % 40) / 100 }
}

/** A stable colour per type name, so two sketches of one world agree. */
export function typeColour(name) {
  const { hue, bright } = typeHue(name)
  const [r, g, b] = hueToRgb(hue, 0.65, bright)
  return [r, g, b, 255]
}

/** A hue and brightness as a hex string, for legends and stroke styles. */
export function hueHex(hue, bright) {
  return '#' + hueToRgb(hue, 0.65, bright).map(v => v.toString(16).padStart(2, '0')).join('')
}

/** A hue and brightness as an RGB triple, the form both colour helpers return. */
function hueToRgb(hue, saturation, lightness) {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const at = n => {
    const k = (n + hue / 30) % 12
    return Math.round((lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [at(0), at(8), at(4)]
}

/**
 * The named shots a subject can be framed with. `azimuth` is measured from
 * the subject's own facing — front means its face, whichever way it points —
 * and `distance` scales its largest extent. Absent a name, three-quarter:
 * the view a model is judged by, face and silhouette at once.
 */
export const SHOTS = {
  'three-quarter': { azimuth: Math.PI - 0.6, pitch: -0.35, distance: 2.5 },
  front: { azimuth: Math.PI, pitch: -0.2, distance: 2.5 },
  back: { azimuth: 0, pitch: -0.2, distance: 2.5 },
  'side-left': { azimuth: -Math.PI / 2, pitch: -0.12, distance: 2.5 },
  'side-right': { azimuth: Math.PI / 2, pitch: -0.12, distance: 2.5 },
  top: { azimuth: Math.PI, pitch: -1.35, distance: 2.2 },
  low: { azimuth: Math.PI - 0.6, pitch: -0.05, distance: 2.2 }
}

/**
 * A camera to look at one entity: a three-quarter front view, because a model
 * is judged by its face and silhouette and a straight-behind view shows
 * neither. The subject's own facing decides where "front" is.
 */
export function frameSubject(entity, bounds, shotName) {
  const shot = SHOTS[shotName] || SHOTS['three-quarter']
  const distance = Math.max(2, Math.max(bounds.w, bounds.h, bounds.l || 0) * shot.distance)
  const facing = yawOf(entity)
  // The eye is placed out along the shot's bearing; its yaw looks back.
  const azimuth = facing + shot.azimuth
  const flat = distance * Math.cos(-shot.pitch)
  return {
    mode: 'third-person-still',
    x: entity.x + Math.sin(azimuth) * flat,
    y: entity.y + distance * Math.sin(-shot.pitch),
    z: (entity.z || 0) + Math.cos(azimuth) * flat,
    yaw: azimuth, pitch: shot.pitch, fov: 50
  }
}

/**
 * Degrees between where `entity` points and where `other` stands, 0 meaning
 * dead-on. A nose points at -Z at yaw 0, the same convention the renderer
 * turns bodies by.
 */
export function facingOffset(entity, other) {
  const wanted = Math.atan2(-(other.x - entity.x), -((other.z || 0) - (entity.z || 0)))
  const yaw = yawOf(entity)
  const off = Math.abs(((wanted - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
  return { degreesOff: Math.round(off * 180 / Math.PI), facingIt: off < Math.PI / 6 }
}

/** Contact tolerance in world units — a tenth of a millimetre, below anything a level measures. */
const CONTACT = 0.0001

/**
 * Axis-aligned world boxes, centred on the entity, feet at the centre's base.
 *
 * Touching includes exact contact, so a thing standing on a floor touches it.
 * Float arithmetic never lands on the boundary exactly, so the comparison
 * carries a tolerance of a tenth of a millimetre — below anything a level
 * measures in, and wide enough for the error in a sum of positions and sizes.
 */
export function boxesTouch(a, b) {
  return Math.abs(a.x - b.x) <= (a.w + b.w) / 2 + CONTACT
    && Math.abs(a.y - b.y) <= (a.h + b.h) / 2 + CONTACT
    && Math.abs(a.z - b.z) <= ((a.l || 0) + (b.l || 0)) / 2 + CONTACT
}

/**
 * The convex hull of screen points, in draw order — Andrew's monotone chain.
 * Fewer than three points come back as given.
 */
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper = []
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * Where an entity's world box lands on screen: the hull of its eight
 * projected corners, [x, y] percent pairs. Every corner must sit clearly in
 * front of a perspective eye: a corner behind it would silently vanish and
 * the hull would collapse to the far face, and a corner grazing the eye
 * plane projects thousands of percent off screen and the hull floods the
 * frame. One unsafe corner answers null, and the caller falls back to the
 * screen rectangle.
 */
export function screenHull(box, projector) {
  const corners = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const point = projector.place(box.x + sx * box.w / 2, box.y + sy * box.h / 2, (box.z || 0) + sz * (box.l || 0) / 2)
    if (!point.inFront || (projector.mode !== 'ortho' && point.depth < 0.2)) return null
    corners.push([Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10])
  }
  return convexHull(corners)
}

/** 3x5 digit stamps for marks in a sketch, where there is no font. */
export const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111',
  '101101111001001', '111100111001111', '111100111101111', '111001010010010',
  '111101111101111', '111101111001111']
