/**
 * See query verbs: exact answers about the frame, computed before any pixel
 * is read. Every verb takes (context, options) and returns plain JSON with a
 * `method` field naming how the answer was computed. Occlusion prefers the
 * renderer's ID buffer when one can answer; everything else is geometry from
 * engine/scene-query.js over the same describe index every See command uses.
 */
import { makeProjector } from '../../../engine/camera-project.js'
import { boundsOf, facingOffset } from '../../../engine/frame-facts.js'
import { occlusionGrid, insideOf, matches, diffMoments } from '../../../engine/scene-query.js'
import { FIXED_STEP } from '../../../engine/loop.js'
import { describe } from './describe.js'

/**
 * The ID buffer is another lane's module and may not exist yet, and a static
 * import of a missing file would take the whole plugin down with it. Imported
 * once, on first use; `@vite-ignore` keeps the bundler from failing the build
 * while the file is absent.
 */
let idBufferModule
async function loadIdBuffer() {
  if (idBufferModule === undefined) {
    try { idBufferModule = await import(/* @vite-ignore */ './id-buffer.js') }
    catch { idBufferModule = null }
  }
  return idBufferModule
}

/**
 * How much of one entity the camera can see, and who blocks the rest.
 * The ID buffer counts real rendered pixels, so it wins when a renderer is
 * attached; headless, rays from the eye answer — exact for box worlds at the
 * grid's resolution. `method` says which one answered.
 */
export async function occlusion(context, options = {}) {
  const entity = context.world.byId(options.of)
  if (!entity) return { error: `no entity "${options.of}"` }
  const rows = options.rows || 5
  const columns = options.columns || 5

  const buffer = await loadIdBuffer()
  if (buffer?.visibility) {
    try {
      const read = await buffer.visibility(context, { of: entity.id, rows, columns })
      if (Number.isFinite(read?.visibleFraction)) {
        return {
          id: entity.id,
          visibleFraction: round(read.visibleFraction),
          blockedBy: read.blockedBy || [],
          method: 'id-buffer'
        }
      }
    } catch {
      // The buffer needs a renderer; without one the rays below still answer.
    }
  }

  const view = context.view
  const eye = { x: view.x, y: view.y, z: view.z || 0 }
  // Hidden entities are not drawn, so they cannot block sight.
  const others = context.world.entities.filter(other => !other.hidden)
  const grid = occlusionGrid(eye, entity, others, rows, columns)
  return {
    id: entity.id,
    visibleFraction: round(grid.visibleFraction),
    blockedBy: grid.blockedBy,
    method: 'rays'
  }
}

/** scene-query owns the region thresholds; probing its names keeps one source of truth. */
const REGIONS = ['top-left', 'top-centre', 'top-right', 'middle-left', 'centre',
  'middle-right', 'bottom-left', 'bottom-centre', 'bottom-right']

/**
 * Everything computable about one entity, in one answer: world box, screen
 * box, cover, cut, region, velocity, and its relation to whatever the camera
 * follows. Velocity is measured by stepping the loop one fixed step and
 * reading the position change — world units per second — so asking for it
 * advances the world by one step, the same way see.moment advances it.
 */
export async function isolate(context, options = {}) {
  const entity = context.world.byId(options.subject)
  if (!entity) return { error: `no entity "${options.subject}"` }
  const bounds = boundsOf(entity)

  const description = describe(context, {})
  const entry = (description.visible || []).find(seen => seen.id === entity.id) || null

  let screen = null
  if (entry) {
    // describe only writes `cut` on marked entries; the dossier has exactly
    // one subject, so it computes the same clip arithmetic for it directly.
    const shownWidth = Math.min(100, entry.at[0] + entry.size[0] / 2) - Math.max(0, entry.at[0] - entry.size[0] / 2)
    const shownHeight = Math.min(100, entry.at[1] + entry.size[1] / 2) - Math.max(0, entry.at[1] - entry.size[1] / 2)
    const shown = Math.max(0, shownWidth) * Math.max(0, shownHeight) / (entry.size[0] * entry.size[1] || 1)
    screen = {
      at: entry.at,
      size: entry.size,
      depth: entry.depth,
      ...(entry.mark ? { mark: entry.mark } : {}),
      cut: round(Math.min(100, shown * 100)),
      region: REGIONS.find(name => matches(entry, { region: name }))
    }
  }

  const cover = await occlusion(context, { of: entity.id })

  let velocity = null
  let velocityWhy
  if (!context.loop.running && !context.world.simulated) {
    // Stepping an unsimulated world runs start hooks and moves entities off
    // their edited places — the dossier must not change the level it reads.
    velocityWhy = 'not measured: the loop is stopped and the world is unsimulated — play or simulate first'
  } else {
    const before = { x: entity.x, y: entity.y, z: entity.z || 0 }
    context.loop.step(1)
    velocity = [
      round((entity.x - before.x) / FIXED_STEP),
      round((entity.y - before.y) / FIXED_STEP),
      round(((entity.z || 0) - before.z) / FIXED_STEP)
    ]
  }

  const target = context.camera?.target
  const followed = target && target.id !== entity.id && context.world.entities.includes(target) ? target : null

  return {
    id: entity.id,
    type: entity.type,
    ...(entity.hidden ? { hidden: true } : {}),
    world: { x: round(entity.x), y: round(entity.y), z: round(entity.z || 0), ...bounds },
    screen,
    onScreen: !!entry,
    visibleFraction: cover.visibleFraction,
    blockedBy: cover.blockedBy,
    velocity,
    ...(velocityWhy ? { velocityWhy } : {}),
    followed: followed
      ? {
          id: followed.id,
          distance: round(Math.hypot(entity.x - followed.x, entity.y - followed.y, (entity.z || 0) - (followed.z || 0))),
          facing: {
            [entity.id]: facingOffset(entity, followed),
            [followed.id]: facingOffset(followed, entity)
          }
        }
      : null,
    method: `describe for the screen box, ${cover.method} for cover, ${velocity ? 'one fixed step for velocity' : 'no step taken'}`
  }
}

/**
 * Every entity satisfying all the given predicates — the names scene-query
 * `matches` knows: type, idPrefix, occludedOver/Under, cutUnder, sizeOver/
 * Under, depthOver/Under, region, within. One describe answers for on-screen
 * entities; off-screen ones get the same projection so screen predicates
 * still read. `within` accepts an entity id and resolves it here. Occlusion
 * rays are only cast when a predicate asks about occlusion.
 */
export function find(context, options = {}) {
  const description = describe(context, {})
  const predicates = { ...options }
  if (Array.isArray(predicates.within) && typeof predicates.within[1] === 'string') {
    const target = context.world.byId(predicates.within[1])
    if (!target) return { error: `no entity "${predicates.within[1]}" to measure within from` }
    predicates.within = [predicates.within[0], target]
  }
  const wantsOcclusion = 'occludedOver' in predicates || 'occludedUnder' in predicates

  const view = context.view
  const eye = { x: view.x, y: view.y, z: view.z || 0 }
  const projector = makeProjector(view, context.viewport)
  const blockers = context.world.entities.filter(other => !other.hidden)
  const seenById = new Map((description.visible || []).map(seen => [seen.id, seen]))

  const found = []
  for (const entity of context.world.entities) {
    if (entity.hidden) continue
    let entry = seenById.get(entity.id)
    if (!entry) {
      const point = projector.place(entity.x, entity.y, entity.z || 0)
      const bounds = boundsOf(entity)
      // The same height reading describe uses, so crossing the frame edge
      // does not change an entity's reported size.
      const tilt = projector.mode === 'ortho' ? 0 : Math.abs(view.pitch || 0)
      const size = projector.sizeAt(point.depth, bounds.w, bounds.h * Math.cos(tilt) + bounds.l * Math.sin(tilt))
      entry = {
        id: entity.id, type: entity.type,
        at: [round(point.x), round(point.y)],
        size: [round(size.w), round(size.h)],
        depth: round(point.depth),
        offscreen: true
      }
    }
    entry.world = { x: entity.x, y: entity.y, z: entity.z || 0 }
    if (wantsOcclusion) {
      entry.occluded = round(1 - occlusionGrid(eye, entity, blockers).visibleFraction)
    }
    if (matches(entry, predicates)) found.push(entry)
  }

  return {
    count: found.length,
    found,
    method: `one describe, scene-query matches over every entity${wantsOcclusion ? ', occlusion by rays' : ''}`
  }
}

/**
 * What changes over exact fixed steps: describe, advance, describe again,
 * diff. Advancing an unsimulated world first runs every start hook — the same
 * guard see.moment uses — so behaviours move instead of nothing happening.
 * Advances the world; `stop` restores the level.
 */
export function diff(context, options = {}) {
  const steps = Math.max(1, Math.round(options.steps ?? 30))
  if (!context.loop.running && !context.world.simulated) {
    context.world.simulated = true
    for (const entity of [...context.world.entities]) context.world.hook(entity, 'start', context)
  }
  const before = describe(context, options)
  const timeBefore = context.loop.time
  context.loop.step(steps)
  const advanced = context.loop.time - timeBefore
  const out = {
    steps,
    ...diffMoments(before, describe(context, options)),
    counts: { before: before.counts, after: describe(context, options).counts },
    method: `describe, ${steps} fixed steps, describe again — changes by diffMoments`
  }
  // A held clock measures as stillness. Nothing changed is only a finding
  // when time actually passed; otherwise the holder is the finding.
  if (advanced < steps / 60 - 0.001) {
    out.warning = context.loop.paused
      ? `the clock is held by ${JSON.stringify(context.loop.holds)} — nothing can move; release it or pick the waiting screen first`
      : `only ${Math.round(advanced * 60)} of ${steps} steps advanced the clock`
  }
  return out
}

/**
 * Why the frame looks wrong, asked of the camera itself: whose box the eye is
 * inside, what sits closer than half a metre in front of the lens, and
 * whether the followed entity is behind the camera. A screen full of two huge
 * colour blocks is one of these three answers.
 */
export function camera(context) {
  const view = context.view
  const eye = { x: view.x, y: view.y, z: view.z || 0 }
  const projector = makeProjector(view, context.viewport)

  const inside = insideOf(eye, context.world.entities)
    .map(entity => ({ id: entity.id, type: entity.type, ...(entity.hidden ? { hidden: true } : {}) }))

  // Under an orthographic view every depth reads 0, so a near-plane test
  // would name the whole level; it only means anything through a lens.
  const nearerThanHalfAMetre = []
  if (projector.mode === 'perspective') {
    for (const entity of context.world.entities) {
      if (entity.hidden) continue
      const point = projector.place(entity.x, entity.y, entity.z || 0)
      if (point.inFront && point.depth < 0.5) {
        nearerThanHalfAMetre.push({ id: entity.id, type: entity.type, depth: round(point.depth) })
      }
    }
    nearerThanHalfAMetre.sort((a, b) => a.depth - b.depth)
  }

  const target = context.camera?.target
  const followed = target && context.world.entities.includes(target) ? target : null
  let followedReport = null
  if (followed) {
    const point = projector.place(followed.x, followed.y, followed.z || 0)
    followedReport = {
      id: followed.id,
      behindCamera: projector.mode === 'perspective' && !point.inFront,
      depth: point.inFront ? round(point.depth) : null,
      containsEye: inside.some(entity => entity.id === followed.id)
    }
  }

  return {
    view: {
      mode: projector.mode,
      x: round(view.x), y: round(view.y), z: round(view.z || 0),
      yaw: round(view.yaw || 0), pitch: round(view.pitch || 0),
      ...(projector.mode === 'ortho' ? { zoom: view.zoom } : { fov: view.fov || 90 })
    },
    eye: { x: round(eye.x), y: round(eye.y), z: round(eye.z) },
    insideOf: inside,
    nearerThanHalfAMetre,
    followed: followedReport,
    method: projector.mode === 'ortho'
      ? 'eye tested against entity boxes; an orthographic view has no depth, so the near test is skipped'
      : 'eye tested against entity boxes; near and behind read from the same projection describe uses'
  }
}

const round = n => Math.round(n * 100) / 100
