/**
 * See query verbs: exact answers about the frame, computed before any pixel
 * is read. Every verb takes (context, options) and returns plain JSON with a
 * `method` field naming how the answer was computed. Occlusion and identify
 * prefer the renderer's ID buffer when one can answer; everything else is
 * geometry from scene-query.js over the same describe index every See
 * command uses.
 */
import { makeProjector } from '../../../engine/camera-project.js'
import { boundsOf, facingOffset } from './frame-facts.js'
import { occlusionGrid, insideOf, matches, diffMoments } from './scene-query.js'
import { FIXED_STEP } from '../../../engine/loop.js'
import { describe, aboutTypes } from './describe.js'
import { clippedShare } from './describe-marks.js'

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

  // Off frame is not occluded — zero visible pixels would read as "something
  // blocks it" when the truth is the camera does not point at it.
  const framed = describe(context, {})
  if (!framed.visible.some(entry => entry.id === entity.id)) {
    return { id: entity.id, offscreen: true, why: 'outside the frame of the current camera — nothing occludes it, nothing shows it' }
  }

  const buffer = await loadIdBuffer()
  if (buffer?.visibility) {
    try {
      // visibility takes a list of ids and answers a measure per id.
      const read = (await buffer.visibility(context, [entity.id]))?.[0]
      if (Number.isFinite(read?.visibleFraction)) {
        return {
          id: entity.id,
          visibleFraction: round(read.visibleFraction),
          blockedBy: read.occludedBy || read.blockedBy || [],
          visiblePixels: read.visiblePixels,
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

/**
 * `at`, checked once: exactly two finite numbers, both within the visible
 * frame. Returns a problem string, or null when it is fine — never throws,
 * so a bad position is a named answer, not a crash.
 */
function invalidAt(at) {
  if (!Array.isArray(at) || at.length !== 2) return 'an "at": [xPercent, yPercent]'
  const [x, y] = at
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '"at" as two finite numbers'
  if (x < 0 || x > 100 || y < 0 || y > 100) return `"at" within the visible frame, 0-100 — got [${x}, ${y}]`
  return null
}

/** What the author wrote about one entity, the same block isolate() carries. */
function describeEntity(entity) {
  const definition = entity._definition || {}
  const authored = {
    ...(definition.about ? { about: definition.about } : {}),
    ...(definition.appearance ? { appearance: definition.appearance } : {}),
    ...(definition.looksWrongWhen ? { looksWrongWhen: definition.looksWrongWhen } : {}),
    ...(entity.note ? { note: entity.note } : {})
  }
  return {
    id: entity.id,
    type: entity.type,
    ...(entity.hidden ? { hidden: true } : {}),
    ...(Object.keys(authored).length ? { description: authored } : {})
  }
}

/**
 * Turn an id-buffer answer into the identify reply. `id` is null for
 * background — a real answer, not an absence. An id the world no longer
 * knows is named rather than dropped: the buffer is a snapshot, and the
 * entity behind an id can be destroyed between the draw and this read.
 */
function resolveHit(context, id, at, method) {
  if (id === null) return { at, id: null, type: null, hitBackground: true, method }
  const entity = context.world.byId(id)
  if (!entity) {
    return {
      at, id, type: null,
      why: `"${id}" was drawn at this pixel but no longer exists in the world — a stale render, or the entity was destroyed since the frame was drawn`,
      method
    }
  }
  return { at, ...describeEntity(entity), method }
}

/**
 * Geometry answer for one screen point: the nearest on-screen entity whose
 * projected box covers it. A box is not a drawn silhouette, so a point near
 * a corner can name an entity that drew nothing there — the caller is told
 * this is the fallback, not the renderer, through `method`.
 */
function boxHit(context, at) {
  const [xPercent, yPercent] = at
  const description = describe(context, {})
  let winner = null
  for (const entry of description.visible || []) {
    const withinX = Math.abs(entry.at[0] - xPercent) <= entry.size[0] / 2
    const withinY = Math.abs(entry.at[1] - yPercent) <= entry.size[1] / 2
    if (withinX && withinY && (!winner || entry.depth < winner.depth)) winner = entry
  }
  const method = 'boxes: nearest on-screen entity whose projected box covers the point (approximate — no drawn silhouette)'
  if (!winner) return { at, id: null, type: null, hitBackground: true, method }
  return { at, ...describeEntity(context.world.byId(winner.id)), method }
}

/**
 * What is drawn at one screen position — the pixel-identity answer a player
 * pointing at the screen needs. `at` is percent, 0-100, x rightward and y
 * downward, matching every other screen field in this plugin, so the caller
 * never converts against a canvas's backing-buffer size and never has to
 * know the device pixel ratio.
 *
 * The ID buffer answers first when a renderer is attached and actually drew
 * this frame; a hidden or backgrounded tab is refused rather than trusted,
 * because its buffer reads as background everywhere and that is a fact
 * about the tab, not the scene. Geometry answers otherwise, and `rendererWhy`
 * says why the renderer did not — never silence, never a guess dressed as
 * a renderer-true answer.
 */
export async function identify(context, options = {}) {
  const problem = invalidAt(options.at)
  if (problem) return { error: `identify needs ${problem}` }
  const at = options.at

  let rendererWhy
  const buffer = await loadIdBuffer()
  if (!buffer?.idMap) {
    rendererWhy = 'the ID buffer module did not load'
  } else {
    try {
      const map = await buffer.idMap(context)
      if (map?.hidden) {
        rendererWhy = 'this tab is hidden — its draw cannot be trusted, and a blank buffer from a hidden tab is not "nothing is there". Focus this tab, or ask one that is on screen.'
      } else if (typeof map?.at === 'function') {
        // Percent to pixel against the ID buffer's OWN width and height — the
        // exact size mount() built the target at, in CSS pixels — never the
        // visible canvas's backing-buffer size, which is that times the
        // device pixel ratio. Clamped at the far edge: percent 100 floors to
        // one pixel past the last column, and that column is still on screen.
        const x = Math.min(map.width - 1, Math.max(0, Math.floor(at[0] / 100 * map.width)))
        const y = Math.min(map.height - 1, Math.max(0, Math.floor(at[1] / 100 * map.height)))
        return resolveHit(context, map.at(x, y), at, 'id-buffer: exact drawn pixel')
      } else {
        rendererWhy = map?.why || 'the renderer did not answer'
      }
    } catch (error) {
      rendererWhy = `the ID buffer threw: ${error.message}`
    }
  }

  return { ...boxHit(context, at), rendererWhy }
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

  const screen = entry ? screenBoxOf(entry) : null

  const cover = await occlusion(context, { of: entity.id })

  const { velocity, velocityWhy } = measureVelocity(context, entity)

  // One subject, so the whole authored block rides along: what it is, how a
  // correct one reads, how a broken one reads, and why this one is placed here.
  // `appearance` is safe in a dossier and never in an image sidecar, because
  // nothing here is handed to a vision model beside a picture.
  const authored = authoredBlock(entity)

  return {
    id: entity.id,
    type: entity.type,
    ...(entity.hidden ? { hidden: true } : {}),
    ...(Object.keys(authored).length ? { description: authored } : {}),
    world: { x: round(entity.x), y: round(entity.y), z: round(entity.z || 0), ...bounds },
    screen,
    onScreen: !!entry,
    visibleFraction: cover.visibleFraction,
    blockedBy: cover.blockedBy,
    velocity,
    ...(velocityWhy ? { velocityWhy } : {}),
    followed: followedBy(context, entity),
    method: `describe for the screen box, ${cover.method} for cover, ${velocity ? 'one fixed step for velocity' : 'no step taken'}`
  }
}

/**
 * Where one described entry landed on screen, as a fraction of its own box.
 *
 * `describe` writes `cut` on marked entries, and a dossier has exactly one
 * subject, so it asks for the same share directly.
 */
function screenBoxOf(entry) {
  const shown = clippedShare(entry)
  return {
    at: entry.at,
    size: entry.size,
    depth: entry.depth,
    ...(entry.mark ? { mark: entry.mark } : {}),
    cut: round(Math.min(100, shown * 100)),
    region: REGIONS.find(name => matches(entry, { region: name }))
  }
}

/**
 * How fast the subject is moving, in world units a second, or why that cannot
 * be said.
 *
 * Measured by stepping the loop one fixed step and reading the position change,
 * so asking advances the world. Two cases answer with a reason instead: stepping
 * an unsimulated world would run start hooks and move entities off their edited
 * places, and a step under a held clock moves nothing and would report a
 * sprinting rat as standing still.
 */
function measureVelocity(context, entity) {
  if (!context.loop.running && !context.world.simulated) {
    return { velocity: null, velocityWhy: 'not measured: the loop is stopped and the world is unsimulated — play or simulate first' }
  }
  if (context.loop.paused) {
    return { velocity: null, velocityWhy: `not measured: the clock is held by ${JSON.stringify(context.loop.holds)} — a step would move nothing and read as a standstill` }
  }
  const before = { x: entity.x, y: entity.y, z: entity.z || 0 }
  context.loop.step(1)
  return {
    velocity: [
      round((entity.x - before.x) / FIXED_STEP),
      round((entity.y - before.y) / FIXED_STEP),
      round(((entity.z || 0) - before.z) / FIXED_STEP)
    ],
    velocityWhy: undefined
  }
}

/** What the author wrote about this entity, and only what is written. */
function authoredBlock(entity) {
  const definition = entity._definition || {}
  return {
    ...(definition.about ? { about: definition.about } : {}),
    ...(definition.appearance ? { appearance: definition.appearance } : {}),
    ...(definition.looksWrongWhen ? { looksWrongWhen: definition.looksWrongWhen } : {}),
    ...(entity.note ? { note: entity.note } : {})
  }
}

/** The entity the camera follows, when it is another one, and where it stands. */
function followedBy(context, entity) {
  const target = context.camera?.target
  const followed = target && target.id !== entity.id && context.world.entities.includes(target) ? target : null
  if (!followed) return null
  return {
    id: followed.id,
    distance: round(Math.hypot(entity.x - followed.x, entity.y - followed.y, (entity.z || 0) - (followed.z || 0))),
    facing: {
      [entity.id]: facingOffset(entity, followed),
      [followed.id]: facingOffset(followed, entity)
    }
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
    // What each type found IS, once per type. A list of a hundred ids says
    // nothing about what was found until this says what they are.
    ...aboutTypes(context, found.map(entry => entry.type)),
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
  // A held clock measures as stillness, and "nothing changed" is the one
  // answer this verb must never give by accident. Said before the world is
  // touched: starting a level's hooks to then step nothing would leave the
  // entities off their edited places for an answer that was never coming.
  if (context.loop.paused) {
    return {
      error: `the clock is held by ${JSON.stringify(context.loop.holds)}, so no step can pass and everything would read as still`,
      holds: context.loop.holds,
      steps,
      hint: 'release the hold, or answer the waiting screen first — screen.read names it'
    }
  }
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
  // Nothing changed is only a finding when time actually passed. A hold taken
  // mid-run, or hit stop swallowing a few steps, makes stillness a fact about
  // the clock rather than about the game.
  if (advanced < steps / 60 - 0.001) {
    out.warning = context.loop.paused
      ? `the clock was taken mid-diff by ${JSON.stringify(context.loop.holds)} — only ${Math.round(advanced * 60)} of ${steps} steps passed`
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
