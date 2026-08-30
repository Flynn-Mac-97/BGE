/**
 * Named cameras, so a view worth returning to is a word, not six numbers.
 *
 * Stored in `<project>/views.json` — a project file, committed with the game,
 * because "the arena from the south gate" is authored knowledge every later
 * agent should inherit. A view is the camera fields exactly as `context.view`
 * holds them; saving without a camera keeps the view being looked through
 * right now.
 */
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

  if (typeof options.save === 'string') {
    const current = context.view
    views[options.save] = options.camera
      || { x: current.x, y: current.y, z: current.z || 0, yaw: current.yaw || 0, pitch: current.pitch || 0, fov: current.fov, zoom: current.zoom, mode: current.mode }
    await context.files.write(FILE, JSON.stringify(views, null, 2) + '\n')
    return { saved: options.save, camera: views[options.save], views: Object.keys(views) }
  }

  if (typeof options.drop === 'string') {
    if (!views[options.drop]) return { error: `no saved view "${options.drop}"`, views: Object.keys(views) }
    delete views[options.drop]
    await context.files.write(FILE, JSON.stringify(views, null, 2) + '\n')
    return { dropped: options.drop, views: Object.keys(views) }
  }

  return { views, use: 'any see command takes {"view":"<name>"}; save with {"save":"<name>"} or {"save":"<name>","camera":{...}}' }
}
