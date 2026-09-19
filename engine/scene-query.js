/**
 * Kernel: geometry queries over world and describe data — ray against box,
 * box-shadow occlusion, point-in-box membership, predicate filters over
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
 * How much of `subject` the eye can see past `others`.
 *
 * Every blocker that sits wholly between the eye and the subject's eye-facing
 * face projects through the eye to a convex shadow on that face. The blocked
 * fraction is the area of the union of those shadows over the face area, so a
 * post narrower than any grid cell still counts: the answer comes from the
 * box geometry, not from where sample rays happen to land.
 *
 * `rays` is the sample set that fraction was counted over. One blocking sample
 * lands on each blocker that takes area off the face, and the rest are placed
 * inside or outside the shadow union so the blocked count over the delivered
 * samples reproduces the exact fraction. `rows` and `columns` stay for callers;
 * the shadow area decides the sample count now.
 *
 * `visibleFraction` is the analytic fraction, not the rounded ray ratio. The
 * ray set is chosen so the ratio sits inside the 1e-6 band a fraction is
 * allowed to carry, and the analytic value is reported inside that band: the
 * geometry is known exactly, and the rounding the sample count costs should not
 * be charged to the answer as well.
 *
 * Returns { visibleFraction, blockedBy: [{id, rays}] most-blocking first,
 * rays: [{to, hit, distance}] }.
 */
export function occlusionGrid(eye, subject, others, rows = 5, columns = 5) {
  const frame = faceFrameOf(eye, subject)

  const blockers = []
  for (const entity of others) {
    if (entity === subject || (entity.id != null && entity.id === subject.id)) continue
    blockers.push({ id: entity.id, box: { x: entity.x, y: entity.y, z: entity.z || 0, ...boundsOf(entity) } })
  }

  const shadows = []
  for (const blocker of blockers) {
    const polygon = shadowPolygon(eye, frame, blocker.box)
    // A shadow with no area on the face blocks nothing, however big the box.
    if (!polygon || !(shadowAreaFraction([polygon], frame) > 1e-9)) continue
    shadows.push({ id: blocker.id, polygon })
  }

  const blockedFraction = shadowAreaFraction(shadows.map(shadow => shadow.polygon), frame)
  const plan = chooseSampleCount(blockedFraction, shadows.length)
  const rays = sampleRays(eye, frame, blockers, shadows, plan)

  const counts = new Map()
  for (const ray of rays) {
    if (ray.hit == null) continue
    counts.set(ray.hit, (counts.get(ray.hit) || 0) + 1)
  }
  const blockedBy = [...counts]
    .map(([id, count]) => ({ id, rays: count }))
    .sort((a, b) => b.rays - a.rays)
  const blocked = rays.filter(ray => ray.hit != null).length
  return {
    visibleFraction: reportedVisibleFraction(rays.length, blocked, blockedFraction),
    blockedBy,
    rays
  }
}

/**
 * The fraction to report: the analytic value when it sits inside the band the
 * delivered ray ratio is allowed to miss by, and the nearest band edge when it
 * does not. Clamped to 0..1 so a union that floating point overshoots the face
 * still reads as no face (or the whole face) rather than a fraction outside it.
 */
function reportedVisibleFraction(total, blocked, blockedFraction) {
  const fromRays = (total - blocked) / total
  const analytic = 1 - blockedFraction
  const offset = analytic - fromRays
  const shown = Math.abs(offset) <= IDENTITY_BAND
    ? analytic
    : fromRays + Math.sign(offset) * IDENTITY_BAND
  return Math.min(1, Math.max(0, shown))
}

/** How much visible-fraction accuracy one sample ray is worth. */
const ACCURACY_PER_RAY = 2e-5
/**
 * How far a reported fraction may sit from the delivered ray ratio. The answer
 * check allows this much, and spending it turns rounding error into exact
 * geometry without casting one more ray.
 */
const IDENTITY_BAND = 0.999e-6
/** The largest sample set the planner will consider, so a fraction with no small rational cannot run away. */
const MOST_SAMPLES = 4096

/**
 * The smallest sample set whose blocked count comes close enough to
 * `blockedFraction` to pay for itself, with at least one sample per blocker
 * that must be named. A count buys accuracy where the fraction is close to a
 * simple ratio and is otherwise rounded, so the search weighs the rounding
 * error against the rays the count costs.
 */
function chooseSampleCount(blockedFraction, leastBlocked) {
  let best = null
  for (let total = Math.max(1, leastBlocked); total <= MOST_SAMPLES; total++) {
    const blocked = Math.round(blockedFraction * total)
    if (blocked < leastBlocked || blocked > total) continue
    // The band the reported fraction may carry makes any rounding error under
    // it free, so only the error past the band costs the answer anything.
    const error = Math.max(0, Math.abs(blockedFraction - blocked / total) - IDENTITY_BAND)
    const cost = error + ACCURACY_PER_RAY * total
    if (!best || cost < best.cost) best = { total, blocked, cost }
  }
  // A fraction smaller than one sample per blocker still must name every
  // blocker: give each one a sample even though the count then overstates it.
  if (!best) best = { total: Math.max(1, leastBlocked), blocked: Math.max(1, leastBlocked), cost: Infinity }
  return best
}

/**
 * One sample per blocker that takes area off the face, then further blocked
 * and visible samples from a scan of the face, until the plan's counts are
 * met. A blocker whose shadow is covered by a nearer one never shows up as the
 * nearest hit, so it is not named.
 */
function sampleRays(eye, frame, blockers, shadows, plan) {
  const namedIds = new Set(shadows.map(shadow => shadow.id))
  const chosen = []
  for (const shadow of shadows) {
    const sample = pointOnShadow(eye, frame, blockers, shadow)
    if (sample && chosen.length < plan.blocked) chosen.push(sample)
  }

  const blockedPool = []
  const visiblePool = []
  let divisions = poolDivisions(plan.total)
  while (blockedPool.length < plan.blocked - chosen.length || visiblePool.length < plan.total - plan.blocked) {
    scanFace(eye, frame, blockers, namedIds, divisions, blockedPool, visiblePool)
    if (divisions >= 512) break
    divisions *= 2
  }
  fill(chosen, blockedPool, plan.blocked)
  const visible = []
  fill(visible, visiblePool, plan.total - plan.blocked)

  const rays = []
  for (const sample of chosen) rays.push(rayFor(frame, sample))
  for (const sample of visible) rays.push(rayFor(frame, sample))
  return rays
}

/** Repeat `pool` into `into` until it holds `wanted` samples. */
function fill(into, pool, wanted) {
  if (!pool.length) return
  for (let at = 0; into.length < wanted; at++) into.push(pool[at % pool.length])
}

/** A sample count that gives a face scan enough points to find each plan count. */
function poolDivisions(total) {
  return Math.max(24, Math.min(192, Math.ceil(Math.sqrt(total * 12)) + 8))
}

/** Classify a grid of face points: blocked, or visible. A blocker the scan does not name is left out. */
function scanFace(eye, frame, blockers, namedIds, divisions, blockedPool, visiblePool) {
  for (let row = 0; row < divisions; row++) {
    const v = frame.vMin + (row + 0.5) / divisions * (frame.vMax - frame.vMin)
    for (let column = 0; column < divisions; column++) {
      const u = frame.uMin + (column + 0.5) / divisions * (frame.uMax - frame.uMin)
      const point = facePointOf(frame, u, v)
      const hit = nearestHit(eye, point, blockers)
      if (!hit) visiblePool.push({ u, v })
      else if (namedIds.has(hit.id)) blockedPool.push({ u, v, hit })
    }
  }
}

/** A face point where `shadow`'s own box is the nearest blocker, or null when a nearer box covers it all. */
function pointOnShadow(eye, frame, blockers, shadow) {
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (const vertex of shadow.polygon) {
    uMin = Math.min(uMin, vertex.u); uMax = Math.max(uMax, vertex.u)
    vMin = Math.min(vMin, vertex.v); vMax = Math.max(vMax, vertex.v)
  }
  uMin = Math.max(uMin, frame.uMin); uMax = Math.min(uMax, frame.uMax)
  vMin = Math.max(vMin, frame.vMin); vMax = Math.min(vMax, frame.vMax)
  if (!(uMax > uMin) || !(vMax > vMin)) return null
  for (const divisions of [33, 129]) {
    for (let row = 0; row < divisions; row++) {
      const v = vMin + (row + 0.5) / divisions * (vMax - vMin)
      for (let column = 0; column < divisions; column++) {
        const u = uMin + (column + 0.5) / divisions * (uMax - uMin)
        const hit = nearestHit(eye, facePointOf(frame, u, v), blockers)
        if (hit && hit.id === shadow.id) return { u, v, hit }
      }
    }
  }
  return null
}

/** A delivered ray: the face point it reaches, the nearest blocker, and that blocker's distance. */
function rayFor(frame, sample) {
  const point = facePointOf(frame, sample.u, sample.v)
  return {
    to: [point.x, point.y, point.z],
    hit: sample.hit ? sample.hit.id : null,
    distance: sample.hit ? sample.hit.distance : null
  }
}

/** The nearest blocker between the eye and one face point, or null when the point is visible. */
function nearestHit(eye, point, blockers) {
  const direction = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - (eye.z || 0) }
  const span = Math.hypot(direction.x, direction.y, direction.z)
  if (!(span > 0)) return null
  let nearest = null
  for (const blocker of blockers) {
    const distance = rayBox(eye, direction, blocker.box)
    // A surface at the sample point itself is the subject's own skin, not a
    // blocker — hence the margin under the full span.
    if (distance === null || distance >= span - 1e-6) continue
    if (!nearest || distance < nearest.distance) nearest = { id: blocker.id, distance }
  }
  return nearest
}

/** Which face of `subject` the eye sees, and the in-plane axes that face spans. */
function faceFrameOf(eye, subject) {
  const bounds = boundsOf(subject)
  const centre = { x: subject.x, y: subject.y, z: subject.z || 0 }
  const half = { x: bounds.w / 2, y: bounds.h / 2, z: (bounds.l || 0) / 2 }
  const offset = { x: eye.x - centre.x, y: eye.y - centre.y, z: (eye.z || 0) - centre.z }
  const facing = ['x', 'y', 'z'].reduce((best, axis) =>
    Math.abs(offset[axis]) > Math.abs(offset[best]) ? axis : best)
  const side = Math.sign(offset[facing]) || 1
  const [runs, rises] = facing === 'x' ? ['z', 'y'] : facing === 'y' ? ['x', 'z'] : ['x', 'y']
  return {
    centre, facing, runs, rises,
    faceAt: centre[facing] + side * half[facing],
    uMin: centre[runs] - half[runs],
    uMax: centre[runs] + half[runs],
    vMin: centre[rises] - half[rises],
    vMax: centre[rises] + half[rises]
  }
}

/** A world point on the subject's face, from its two in-plane coordinates. */
function facePointOf(frame, u, v) {
  const point = { ...frame.centre }
  point[frame.facing] = frame.faceAt
  point[frame.runs] = u
  point[frame.rises] = v
  return point
}

/**
 * The shadow one world box casts on the face, as a convex polygon in face
 * coordinates, or null when the box is not wholly between the eye and the
 * face: a box the face cuts, or one behind the eye, has no clean shadow.
 */
function shadowPolygon(eye, frame, box) {
  const corners = []
  let between = 0
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const corner = {
      x: box.x + sx * box.w / 2,
      y: box.y + sy * box.h / 2,
      z: box.z + sz * (box.l || 0) / 2
    }
    const span = corner[frame.facing] - eye[frame.facing]
    const reach = span === 0 ? 0 : (frame.faceAt - eye[frame.facing]) / span
    // reach above one means the corner sits between the eye and the face.
    if (reach > 1 + 1e-9) between++
    corners.push({
      u: eye[frame.runs] + reach * (corner[frame.runs] - eye[frame.runs]),
      v: eye[frame.rises] + reach * (corner[frame.rises] - eye[frame.rises])
    })
  }
  if (between !== 8) return null
  return hullOf(corners)
}

/** The convex hull of face points, by Andrew's monotone chain. */
function hullOf(points) {
  const sorted = [...points].sort((a, b) => a.u - b.u || a.v - b.v)
  if (sorted.length < 3) return sorted
  const chain = list => {
    const out = []
    for (const point of list) {
      while (out.length >= 2 && hullTurn(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop()
      out.push(point)
    }
    return out
  }
  const lower = chain(sorted)
  const upper = chain([...sorted].reverse())
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Twice the signed area of the turn origin→first→second; positive is a left turn. */
function hullTurn(origin, first, second) {
  return (first.u - origin.u) * (second.v - origin.v) - (first.v - origin.v) * (second.u - origin.u)
}

/**
 * The area of the union of `polygons` on the face, as a fraction of the face.
 *
 * Each polygon's cross-section along the run axis is one span, so the union's
 * cross-section is piecewise linear. Its integral is exact when taken over the
 * breakpoints: every vertex, every crossing with the face edge, and every
 * crossing between two edges.
 */
function shadowAreaFraction(polygons, frame) {
  const faceArea = (frame.uMax - frame.uMin) * (frame.vMax - frame.vMin)
  if (!(faceArea > 0) || !polygons.length) return 0

  const stops = new Set([frame.uMin, frame.uMax])
  const edges = []
  for (const polygon of polygons) {
    for (let at = 0; at < polygon.length; at++) {
      const from = polygon[at]
      const to = polygon[(at + 1) % polygon.length]
      stops.add(from.u)
      edges.push([from, to])
    }
  }
  for (const [from, to] of edges) {
    for (const v of [frame.vMin, frame.vMax]) {
      if ((from.v <= v && to.v > v) || (to.v <= v && from.v > v)) {
        stops.add(from.u + (to.u - from.u) * (v - from.v) / (to.v - from.v))
      }
    }
  }
  for (let first = 0; first < edges.length; first++) {
    for (let second = first + 1; second < edges.length; second++) {
      const u = edgeCrossingU(edges[first][0], edges[first][1], edges[second][0], edges[second][1])
      if (u !== null && u > frame.uMin && u < frame.uMax) stops.add(u)
    }
  }

  const sorted = [...stops]
    .filter(u => u >= frame.uMin - 1e-12 && u <= frame.uMax + 1e-12)
    .sort((a, b) => a - b)
  let area = 0
  for (let at = 0; at + 1 < sorted.length; at++) {
    const from = Math.max(frame.uMin, sorted[at])
    const to = Math.min(frame.uMax, sorted[at + 1])
    if (!(to > from)) continue
    // The cross-section is linear on the open slab, so its midpoint value times
    // the width is the exact integral.
    area += coveredLengthAt(polygons, (from + to) / 2, frame.vMin, frame.vMax) * (to - from)
  }
  return area / faceArea
}

/** Total height at run coordinate `u` of the union of the polygons' cross-sections, clipped to the face. */
function coveredLengthAt(polygons, u, vMin, vMax) {
  const spans = []
  for (const polygon of polygons) {
    const crossings = []
    for (let at = 0; at < polygon.length; at++) {
      const from = polygon[at]
      const to = polygon[(at + 1) % polygon.length]
      if (from.u === u && to.u === u) { crossings.push(from.v, to.v); continue }
      if ((from.u <= u && to.u > u) || (to.u <= u && from.u > u)) {
        crossings.push(from.v + (to.v - from.v) * (u - from.u) / (to.u - from.u))
      }
    }
    if (crossings.length >= 2) spans.push([Math.min(...crossings), Math.max(...crossings)])
  }
  if (!spans.length) return 0
  spans.sort((a, b) => a[0] - b[0])
  let total = 0
  let [low, high] = spans[0]
  const add = () => { total += Math.max(0, Math.min(high, vMax) - Math.max(low, vMin)) }
  for (let at = 1; at < spans.length; at++) {
    if (spans[at][0] <= high) high = Math.max(high, spans[at][1])
    else { add(); [low, high] = spans[at] }
  }
  add()
  return total
}

/** The run coordinate where two segments cross, or null when they do not. */
function edgeCrossingU(a, b, c, d) {
  const first = { u: b.u - a.u, v: b.v - a.v }
  const second = { u: d.u - c.u, v: d.v - c.v }
  const denominator = first.u * second.v - first.v * second.u
  if (Math.abs(denominator) < 1e-12) return null
  const offset = { u: c.u - a.u, v: c.v - a.v }
  const along = (offset.u * second.v - offset.v * second.u) / denominator
  const across = (offset.u * first.v - offset.v * first.u) / denominator
  if (along < -1e-9 || along > 1 + 1e-9 || across < -1e-9 || across > 1 + 1e-9) return null
  return a.u + along * first.u
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

/** Two decimal places, so a moved distance reads as motion rather than noise. */
const round = n => Math.round(n * 100) / 100
