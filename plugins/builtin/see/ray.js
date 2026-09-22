/**
 * see.ray — what sits at a place on screen, or along a line from an entity.
 *
 * describe() says what is on screen; it cannot say what is AT one point of it.
 * A ray answers that: cast from the camera through a screen percent, over a
 * grid of screen points, or from an entity in a named direction, and name
 * every entity's box the line passes through, nearest first.
 *
 * Every ray is a box test (scene-query.js `rayBox`), so it answers
 * headless with no renderer. In the browser the ID buffer's pixel at that
 * screen point seeds the nearest hit with drawn truth — see `limits` below
 * for where a box and a drawn pixel can disagree.
 */
import { makeProjector } from '../../../engine/camera-project.js'
import { boundsOf } from './frame-facts.js'
import { rayBox } from './scene-query.js'

/**
 * The ID buffer is another lane's module and may still be under construction;
 * a static import of a missing file would take the whole plugin down with it.
 * Imported once, on first use — same pattern as see/queries.js.
 */
let idBufferModule
async function loadIdBuffer() {
  if (idBufferModule === undefined) {
    try { idBufferModule = await import(/* @vite-ignore */ './id-buffer.js') }
    catch { idBufferModule = null }
  }
  return idBufferModule
}

const RAY_LIMITS = 'rays test collider and mesh BOXES, not the drawn silhouette — a thin model can be '
  + 'missed, and a box can answer a hit where nothing is actually drawn. Particles, decals and HUD '
  + 'overlays are not entities; no ray can name them.'

/** Yaw 0 faces -Z (frame-facts.js facingOffset) — north keeps that bearing. */
const DIRECTIONS = {
  down: { x: 0, y: -1, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 }
}

const round = n => Math.round(n * 100) / 100
const roundPoint = point => ({ x: round(point.x), y: round(point.y), z: round(point.z || 0) })

function unit(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z || 0) || 1
  return { x: vector.x / length, y: vector.y / length, z: (vector.z || 0) / length }
}

/**
 * The world-space ray a camera casts through one screen point (percent, x
 * rightward, y downward) — the analytic inverse of camera-project.js
 * `makeProjector().place()`. If that projection changes, this must change
 * with it; there is nowhere to share the formula, since a screen-to-world
 * inverse belongs to the caller that needs it, not to the projector.
 *
 * Perspective: `place` turns a world point into camera space (yaw then
 * pitch) and divides by depth. Undone here in reverse — the vertical-fov
 * division first, then pitch, then yaw — because inverting a rotation means
 * undoing its steps backwards.
 *
 * Ortho: `place` maps world x/y straight to screen percent by pan and zoom,
 * with no facing at all. The ray keeps the same forward every unrotated
 * camera has (-Z) and starts at the eye's own height.
 */
function screenRay(view, projector, width, height, screenX, screenY) {
  const eye = { x: view.x, y: view.y, z: view.z || 0 }

  if (projector.mode === 'ortho') {
    const zoom = view.zoom || 48
    const worldX = view.x + (screenX / 100 * width - width / 2) / zoom
    const worldY = view.y - (screenY / 100 * height - height / 2) / zoom
    return { origin: { x: worldX, y: worldY, z: eye.z }, direction: { x: 0, y: 0, z: -1 } }
  }

  const yaw = view.yaw || 0
  const pitch = view.pitch || 0
  const fov = (view.fov || 90) * Math.PI / 180
  const focal = 1 / Math.tan(fov / 2)
  const aspect = width / height
  const ndcX = (screenX / 100) * 2 - 1
  const ndcY = 1 - (screenY / 100) * 2

  // Camera-space direction one unit into the screen: camZ = -1 is "forward".
  const camX = ndcX * aspect / focal
  const camY = ndcY / focal
  const camZ = -1
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch)

  // Undo pitch, then undo yaw — the reverse order `place` applied them in.
  const dy = cosPitch * camY - sinPitch * camZ
  const rz = sinPitch * camY + cosPitch * camZ
  const dx = cosYaw * camX + sinYaw * rz
  const dz = -sinYaw * camX + cosYaw * rz
  return { origin: eye, direction: { x: dx, y: dy, z: dz } }
}

/**
 * Every entity's box the ray meets, nearest first. `excludeId` drops the
 * ray's own source — a ray cast from an entity's own centre otherwise hits
 * its own box first, at the distance to its own far wall.
 */
function boxHits(context, origin, direction, excludeId) {
  const hits = []
  for (const entity of context.world.entities) {
    if (entity.hidden || entity.id === excludeId) continue
    const box = { x: entity.x, y: entity.y, z: entity.z || 0, ...boundsOf(entity) }
    const distance = rayBox(origin, direction, box)
    if (distance === null) continue
    hits.push({ id: entity.id, type: entity.type, distance: round(distance) })
  }
  return hits.sort((a, b) => a.distance - b.distance)
}

/** What the author wrote each hit's type IS, where one exists. Authored, not measured. */
function withAbout(context, hits) {
  return hits.map(hit => {
    const about = hit.type && context.world.types.get(hit.type)?.about
    return about ? { ...hit, about } : hit
  })
}

/**
 * The ID buffer's pixel at this hit list's screen point, made the nearest
 * hit. A drawn pixel is truth over a box: if it names an entity the box math
 * missed, that entity goes to the front with no distance rather than being
 * left out; if it names one the box math already found, that entry moves to
 * the front unchanged.
 */
function seedWithPixel(context, hits, seedId) {
  if (!seedId) return hits
  const already = hits.find(hit => hit.id === seedId)
  const rest = hits.filter(hit => hit.id !== seedId)
  if (already) return [already, ...rest]
  const seedEntity = context.world.byId(seedId)
  return [{
    id: seedId,
    type: seedEntity?.type,
    distance: null,
    note: 'the drawn pixel names this entity but its box does not reach the ray — see limits'
  }, ...rest]
}

/** The id-buffer's map, or null where no renderer answers — one full pass for many lookups. */
async function pixelMap(context) {
  const buffer = await loadIdBuffer()
  if (!buffer?.idMap) return null
  try {
    const map = await buffer.idMap(context)
    return map && typeof map.at === 'function' ? map : null
  } catch {
    return null
  }
}

async function rayAt(context, options) {
  if (!Array.isArray(options.at) || options.at.length !== 2 || !options.at.every(Number.isFinite)) {
    return { error: 'at needs two numbers: a screen point in percent, [x, y], x rightward, y downward' }
  }
  const [screenX, screenY] = options.at
  const view = context.view
  const projector = makeProjector(view, context.viewport)
  const width = Math.max(1, context.viewport.width)
  const height = Math.max(1, context.viewport.height)
  const { origin, direction } = screenRay(view, projector, width, height, screenX, screenY)
  let hits = boxHits(context, origin, direction)

  let method = 'box rays only — headless, or no renderer attached'
  const map = await pixelMap(context)
  if (map) {
    const seedId = map.at(screenX / 100 * width, screenY / 100 * height)
    hits = seedWithPixel(context, hits, seedId)
    method = seedId
      ? 'the id-buffer pixel names the nearest hit, box rays name the rest'
      : 'the id-buffer read background at this pixel; box rays list what geometry sits there anyway'
  }

  return {
    at: [screenX, screenY],
    origin: roundPoint(origin),
    direction: roundPoint(unit(direction)),
    hits: withAbout(context, hits),
    method,
    limits: RAY_LIMITS
  }
}

async function rayGrid(context, options) {
  if (!Array.isArray(options.grid) || options.grid.length !== 2
    || !(options.grid[0] > 0) || !(options.grid[1] > 0)) {
    return { error: 'grid needs two positive numbers: [columns, rows]' }
  }
  const [columns, rows] = options.grid
  const view = context.view
  const projector = makeProjector(view, context.viewport)
  const width = Math.max(1, context.viewport.width)
  const height = Math.max(1, context.viewport.height)
  const map = await pixelMap(context)

  const results = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = [round((column + 0.5) / columns * 100), round((row + 0.5) / rows * 100)]
      const { origin, direction } = screenRay(view, projector, width, height, at[0], at[1])
      let hits = boxHits(context, origin, direction)
      if (map) hits = seedWithPixel(context, hits, map.at(at[0] / 100 * width, at[1] / 100 * height))
      // Empty sky costs nothing to report — the reply is only what is really
      // in front of the camera, not one entry per ray cast.
      if (hits.length) results.push({ at, hits: withAbout(context, hits) })
    }
  }

  return {
    grid: [columns, rows],
    rays: columns * rows,
    hit: results.length,
    results,
    method: map
      ? 'the id-buffer pixel names each cell\'s nearest hit, box rays name the rest'
      : 'box rays only — headless, or no renderer attached',
    limits: RAY_LIMITS
  }
}

function rayFrom(context, options) {
  const entity = context.world.byId(options.from)
  if (!entity) return { error: `no entity "${options.from}"` }
  const direction = DIRECTIONS[options.direction]
  if (!direction) {
    return { error: `unknown direction "${options.direction}" — one of ${Object.keys(DIRECTIONS).join(', ')}` }
  }
  const origin = { x: entity.x, y: entity.y, z: entity.z || 0 }
  const hits = boxHits(context, origin, direction, entity.id)
  return {
    from: entity.id,
    direction: options.direction,
    origin: roundPoint(origin),
    hits: withAbout(context, hits),
    method: 'box rays from the entity\'s own position — headless-safe, no renderer needed',
    limits: RAY_LIMITS
  }
}

export async function ray(context, options = {}) {
  if (Array.isArray(options.at)) return rayAt(context, options)
  if (Array.isArray(options.grid)) return rayGrid(context, options)
  if (options.from) return rayFrom(context, options)
  return {
    error: 'see.ray needs one of: {"at":[x,y]} a screen point in percent, '
      + '{"grid":[columns,rows]} rays over the frame, or '
      + `{"from":"<id>","direction":"down"} — direction one of ${Object.keys(DIRECTIONS).join(', ')}`
  }
}
