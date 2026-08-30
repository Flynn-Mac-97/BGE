/**
 * Kernel: geometry queries over world and describe data — ray against box,
 * ray-grid occlusion, point-in-box membership, predicate filters over
 * describe entries, and the change between two describe results.
 *
 * Pure: entities and numbers in, numbers out. No renderer, no DOM, no files,
 * no clock. Whether the camera sits inside a model, or a subject is hidden
 * behind a wall, is answered here before anyone reads a pixel.
 */
import { boundsOf } from './frame-facts.js'

/**
 * Distance along `direction` from `origin` to the surface of `box`, or null
 * if the ray misses. `box` is {x, y, z, w, h, l}, centred on x/y/z — the same
 * reading of an entity box as frame-facts `boxesTouch`. The answer is in
 * world units whatever the length of `direction`. From inside the box the
 * answer is the exit wall: from inside, that wall still stands between the
 * origin and everything past it.
 */
export function rayBox(origin, direction, box) {
  const length = Math.hypot(direction.x, direction.y, direction.z || 0)
  if (!(length > 0)) return null
  const step = { x: direction.x / length, y: direction.y / length, z: (direction.z || 0) / length }
  let near = -Infinity
  let far = Infinity
  for (const [at, along, centre, extent] of [
    [origin.x, step.x, box.x, box.w / 2],
    [origin.y, step.y, box.y, box.h / 2],
    [origin.z || 0, step.z, box.z, (box.l || 0) / 2]
  ]) {
    if (along === 0) {
      // Parallel to this slab: outside it means outside forever.
      if (at < centre - extent || at > centre + extent) return null
      continue
    }
    const enter = (centre - extent - at) / along
    const exit = (centre + extent - at) / along
    near = Math.max(near, Math.min(enter, exit))
    far = Math.min(far, Math.max(enter, exit))
    if (near > far) return null
  }
  if (far < 0) return null
  return near >= 0 ? near : far
}

/**
 * How much of `subject` the eye can see past `others`, by casting a
 * rows-by-columns grid of rays from `eye` to cell centres on the subject's
 * box face toward the eye. Exact per ray, so exact for worlds made of boxes
 * at the grid's resolution — a blocker narrower than one grid cell can pass
 * between rays; raise rows and columns to catch it.
 *
 * Returns { visibleFraction, blockedBy: [{id, rays}] most-blocking first,
 * rays: [{to, hit, distance}] }.
 */
export function occlusionGrid(eye, subject, others, rows = 5, columns = 5) {
  const bounds = boundsOf(subject)
  const centre = { x: subject.x, y: subject.y, z: subject.z || 0 }
  const half = { x: bounds.w / 2, y: bounds.h / 2, z: (bounds.l || 0) / 2 }
  const toEye = { x: eye.x - centre.x, y: eye.y - centre.y, z: (eye.z || 0) - centre.z }
  const facing = ['x', 'y', 'z'].reduce((best, axis) =>
    Math.abs(toEye[axis]) > Math.abs(toEye[best]) ? axis : best)
  const side = Math.sign(toEye[facing]) || 1
  const [runs, rises] = facing === 'x' ? ['z', 'y'] : facing === 'y' ? ['x', 'z'] : ['x', 'y']

  const blockers = []
  for (const entity of others) {
    if (entity === subject || (entity.id != null && entity.id === subject.id)) continue
    blockers.push({ id: entity.id, box: { x: entity.x, y: entity.y, z: entity.z || 0, ...boundsOf(entity) } })
  }

  const rays = []
  const blockedRays = {}
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const point = { ...centre }
      point[facing] += side * half[facing]
      point[runs] += ((column + 0.5) / columns * 2 - 1) * half[runs]
      point[rises] += ((row + 0.5) / rows * 2 - 1) * half[rises]
      const direction = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - (eye.z || 0) }
      const span = Math.hypot(direction.x, direction.y, direction.z)
      let hit = null
      for (const blocker of blockers) {
        const distance = rayBox(eye, direction, blocker.box)
        // A surface at the sample point itself is the subject's own skin, not
        // a blocker — hence the margin under the full span.
        if (distance === null || distance >= span - 1e-6) continue
        if (!hit || distance < hit.distance) hit = { id: blocker.id, distance }
      }
      if (hit) blockedRays[hit.id] = (blockedRays[hit.id] || 0) + 1
      rays.push({ to: [point.x, point.y, point.z], hit: hit && hit.id, distance: hit && hit.distance })
    }
  }

  const blockedBy = Object.entries(blockedRays)
    .map(([id, count]) => ({ id, rays: count }))
    .sort((a, b) => b.rays - a.rays)
  const blocked = blockedBy.reduce((sum, entry) => sum + entry.rays, 0)
  return { visibleFraction: (rays.length - blocked) / rays.length, blockedBy, rays }
}

/**
 * Every entity whose box contains `point` — asked of a camera position to
 * learn what the eye is standing inside. Boxes are centred on the entity,
 * boundaries inclusive. `bounds` is swappable so a caller can test collider
 * boxes instead of drawn ones.
 */
export function insideOf(point, entities, bounds = boundsOf) {
  const containing = []
  for (const entity of entities) {
    const extent = bounds(entity)
    if (Math.abs(point.x - entity.x) <= extent.w / 2
      && Math.abs(point.y - entity.y) <= extent.h / 2
      && Math.abs((point.z || 0) - (entity.z || 0)) <= (extent.l || 0) / 2) containing.push(entity)
  }
  return containing
}

/** Same cell names and thresholds as describe.js `regions` — change both together. */
function regionOf(entry) {
  const column = entry.at[0] < 33.3 ? 'left' : entry.at[0] < 66.6 ? 'centre' : 'right'
  const row = entry.at[1] < 33.3 ? 'top' : entry.at[1] < 66.6 ? 'middle' : 'bottom'
  return row === 'middle' && column === 'centre' ? 'centre' : `${row}-${column}`
}

/** {x, y, z} out of an entity, a describe entry with extras attached, or a bare point. */
function worldPointOf(thing) {
  const source = (thing && (thing.world || thing._world)) || thing
  if (!Number.isFinite(source?.x) || !Number.isFinite(source?.y)) return null
  return { x: source.x, y: source.y, z: source.z || 0 }
}

/**
 * Each predicate reads a describe entry, sometimes with a computed extra the
 * caller attached first: `occluded` is a blocked fraction 0-1 (from
 * occlusionGrid, 1 - visibleFraction), `world`/`_world` is a world position.
 * An absent `occluded` reads as 0; an absent `cut` reads as fully shown —
 * describe only writes `cut` when something is clipped.
 */
const PREDICATES = {
  type: (entry, wanted) => entry.type === wanted,
  idPrefix: (entry, wanted) => String(entry.id).startsWith(wanted),
  occludedOver: (entry, wanted) => (entry.occluded || 0) > wanted,
  occludedUnder: (entry, wanted) => (entry.occluded || 0) < wanted,
  cutUnder: (entry, wanted) => (entry.cut ?? 100) < wanted,
  // Size is the larger screen dimension in percent — the reading describe
  // uses to call a thing a backdrop.
  sizeOver: (entry, wanted) => Math.max(entry.size[0], entry.size[1]) > wanted,
  sizeUnder: (entry, wanted) => Math.max(entry.size[0], entry.size[1]) < wanted,
  depthOver: (entry, wanted) => entry.depth > wanted,
  depthUnder: (entry, wanted) => entry.depth < wanted,
  region: (entry, wanted) => regionOf(entry) === wanted,
  within: (entry, [metres, target]) => {
    const here = worldPointOf(entry)
    const there = worldPointOf(target)
    // Refused rather than false: describe entries carry no world position,
    // and a silent false would read as "far away" instead of "unknown".
    if (!here || !there) throw new Error('within needs world positions — attach entry.world, or pass entities or points')
    return Math.hypot(here.x - there.x, here.y - there.y, here.z - there.z) <= metres
  }
}

/**
 * True when `entry` satisfies every predicate in `predicates`. A predicate
 * name this module does not know throws — a misspelling must not filter as
 * "matches nothing" and pass for an answer.
 */
export function matches(entry, predicates) {
  for (const [name, wanted] of Object.entries(predicates)) {
    const predicate = PREDICATES[name]
    if (!predicate) throw new Error(`unknown predicate "${name}" — one of ${Object.keys(PREDICATES).join(', ')}`)
    if (!predicate(entry, wanted)) return false
  }
  return true
}

/** Under this, a change in screen percent or depth is rounding noise, not motion. */
const MOVED_LEAST = 0.5

/**
 * What changed between two describe results of one world. Ids visible in one
 * and not the other split by the offscreen counts: a type whose offscreen
 * count fell accounts for entries that entered the frame, a rise for entries
 * that left it; the rest appeared in or left the world. describe keeps
 * offscreen counts per type, not per id, so the split is exact only while at
 * most one entity of a type crosses the frame edge between the two moments.
 */
export function diffMoments(before, after) {
  const beforeById = new Map((before.visible || []).map(entry => [entry.id, entry]))
  const afterById = new Map((after.visible || []).map(entry => [entry.id, entry]))
  const offBefore = before.counts?.offscreenByType || {}
  const offAfter = after.counts?.offscreenByType || {}

  const enteredBudget = {}
  const leftBudget = {}
  for (const type of new Set([...Object.keys(offBefore), ...Object.keys(offAfter)])) {
    const change = (offAfter[type] || 0) - (offBefore[type] || 0)
    if (change < 0) enteredBudget[type] = -change
    if (change > 0) leftBudget[type] = change
  }

  const appeared = []
  const enteredFrame = []
  for (const entry of afterById.values()) {
    if (beforeById.has(entry.id)) continue
    if ((enteredBudget[entry.type] || 0) > 0) { enteredBudget[entry.type]--; enteredFrame.push(entry.id) }
    else appeared.push(entry.id)
  }

  const gone = []
  const leftFrame = []
  for (const entry of beforeById.values()) {
    if (afterById.has(entry.id)) continue
    if ((leftBudget[entry.type] || 0) > 0) { leftBudget[entry.type]--; leftFrame.push(entry.id) }
    else gone.push(entry.id)
  }

  const moved = []
  for (const entry of afterById.values()) {
    const was = beforeById.get(entry.id)
    if (!was) continue
    const by = [entry.at[0] - was.at[0], entry.at[1] - was.at[1], entry.depth - was.depth]
    if (by.some(delta => Math.abs(delta) > MOVED_LEAST)) moved.push({ id: entry.id, by: by.map(round) })
  }

  return { appeared, gone, moved, enteredFrame, leftFrame }
}

const round = n => Math.round(n * 100) / 100
