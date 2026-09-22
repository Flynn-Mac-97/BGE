/**
 * Named cameras, so a view worth returning to is a word, not six numbers.
 *
 * Stored in `<project>/views.json` — a project file, committed with the game,
 * because "the arena from the south gate" is authored knowledge every later
 * agent should inherit. A view is the camera fields exactly as `context.view`
 * holds them; saving without a camera keeps the view being looked through
 * right now.
 */
import { boundsOf, frameSubject } from './frame-facts.js'

const FILE = 'views.json'

async function readViews(context) {
  try { return JSON.parse(await context.files.read(FILE)) } catch { return {} }
}

/** Replace `options.view` (a saved name) with the camera it names. */
export async function resolveView(context, options = {}) {
  if (typeof options.view !== 'string') return options
  const views = await readViews(context)
  const camera = views[options.view]
  if (!camera) {
    return { ...options, error: `no saved view "${options.view}". Saved: ${Object.keys(views).join(', ') || 'none'} — save one with see.view` }
  }
  return { ...options, view: undefined, camera: { ...camera, ...(options.camera || {}) } }
}

export async function view(context, options = {}) {
  const views = await readViews(context)

  // Aim the live camera at an entity or a type's first live instance: the
  // same framing subject shots use, pulled `back` times further out (default
  // 3) so the surroundings stay in frame. With `save`, the camera is also
  // kept under that name.
  if (typeof options.aim === 'string') {
    const entity = context.world.byId(options.aim)
      || (context.world.types.has(options.aim) && context.world.all(options.aim)[0])
    if (!entity) {
      return { error: `no entity or live instance of type "${options.aim}" to aim at` }
    }
    // What the camera was, so the reply can name the way back. Aiming writes
    // the live camera and the game's own rule does not always take it again.
    const was = { x: context.view.x, y: context.view.y, z: context.view.z, zoom: context.view.zoom, mode: context.view.mode, yaw: context.view.yaw, pitch: context.view.pitch, fov: context.view.fov }
    const camera = frameSubject(entity, boundsOf(entity), options.shot)
    camera.mode = 'perspective'
    const back = options.back ?? 3
    camera.x = entity.x + (camera.x - entity.x) * back
    camera.y = entity.y + (camera.y - entity.y) * back
    camera.z = (entity.z || 0) + (camera.z - (entity.z || 0)) * back
    for (const [key, value] of Object.entries(camera)) {
      if (value !== undefined) context.view[key] = value
    }
    const named = Object.keys(views)
    const reply = {
      aimed: entity.id,
      camera,
      was,
      restore: named.length
        ? `the live camera is now aimed and stays aimed — put it back with see.view '{"go":"${named[0]}"}'`
        : 'the live camera is now aimed and stays aimed — save a view first if you need it back'
    }
    if (typeof options.save === 'string') {
      views[options.save] = camera
      await context.files.write(FILE, JSON.stringify(views, null, 2) + '\n')
      reply.saved = options.save
    }
    return reply
  }

  if (typeof options.save === 'string') {
    const current = context.view
    views[options.save] = options.camera
      || { x: current.x, y: current.y, z: current.z || 0, yaw: current.yaw || 0, pitch: current.pitch || 0, fov: current.fov, zoom: current.zoom, mode: current.mode }
    await context.files.write(FILE, JSON.stringify(views, null, 2) + '\n')
    return { saved: options.save, camera: views[options.save], views: Object.keys(views) }
  }

  // Aim the live camera at a saved view. Queries read the live camera, so an
  // agent needs this to ask occlusion or isolate from a view it can name —
  // there is no other hand on the camera but the mouse.
  if (typeof options.go === 'string') {
    const camera = views[options.go]
    if (!camera) return { error: `no saved view "${options.go}"`, views: Object.keys(views) }
    for (const [key, value] of Object.entries(camera)) {
      if (value !== undefined) context.view[key] = value
    }
    return { went: options.go, camera }
  }

  if (typeof options.drop === 'string') {
    if (!views[options.drop]) return { error: `no saved view "${options.drop}"`, views: Object.keys(views) }
    delete views[options.drop]
    await context.files.write(FILE, JSON.stringify(views, null, 2) + '\n')
    return { dropped: options.drop, views: Object.keys(views) }
  }

  return { views, use: 'any see command takes {"view":"<name>"}; {"save":"<name>"} keeps a camera, {"go":"<name>"} aims the live camera at a saved view, {"aim":"<id or type>"} aims it at an entity' }
}
