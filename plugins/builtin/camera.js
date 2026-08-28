/**
 * Game Camera — the game camera.
 *
 * Until now the only camera was the editor's viewport: where *you* are looking
 * while building. A game needs a second one — where the *player* is looking
 * while playing — and they must not fight each other.
 *
 * So the editor's view is saved when play starts and put back when it stops.
 * Panning and zooming while editing is never overwritten by a level's rules.
 *
 * Declared in the level, because following the player is a property of the
 * level rather than of the player:
 *
 *   "camera": {
 *     "at": [7, 3], "zoom": 48,
 *     "follow": "player",          // a type name, or an entity id
 *     "lerp": 0.12,                // 1 = snap, lower = softer
 *     "bounds": [0, 0, 30, 12],    // never show outside this box
 *     "lookAhead": 0.35            // lead the direction of travel
 *   }
 *
 * And drivable for the moments a rule cannot express:
 *
 *   context.camera.follow(entity)   context.camera.moveTo(x, y)   context.camera.shake(0.4)
 */
export default {
  name: 'Game Camera',

  onLoad(context) {
    // All camera state lives on context.camera, so the system below and game code
    // are reading and writing the same one place.
    const cam = {
      target: null,
      rule: {},
      amount: 0,        // current shake, decaying
      editorView: null,

      follow(entityOrId) {
        cam.target = typeof entityOrId === 'string'
          ? (context.world.byId(entityOrId) || context.world.find(entityOrId))
          : entityOrId
        return cam.target
      },
      moveTo(x, y) {
        context.view.x = x
        context.view.y = y
      },
      zoomTo(z) { context.view.zoom = z },

      /** Decays on the fixed clock, so it is the same length on every replay. */
      shake(amount = 0.3) { cam.amount = Math.max(cam.amount, amount) }
    }
    context.camera = cam

    // The level's camera block is the rule; re-read it whenever a level loads.
    context.bus.on('level:loaded', async name => {
      try {
        const raw = JSON.parse(await context.files.read(`levels/${name}.json`))
        cam.rule = raw.camera || {}
      } catch { cam.rule = {} }
      cam.target = null
      cam.amount = 0
    })

    context.bus.on('play:started', () => {
      const v = context.view
      cam.editorView = { x: v.x, y: v.y, zoom: v.zoom }
      if (cam.rule.follow) cam.follow(cam.rule.follow)
      if (cam.rule.zoom) v.zoom = cam.rule.zoom
    })

    context.bus.on('play:stopped', () => {
      // Put the editor back exactly where it was looking. Losing your place in
      // the level every time you press play is a small theft that makes an
      // editor tiring to use.
      if (cam.editorView) Object.assign(context.view, cam.editorView)
      cam.editorView = null
      cam.target = null
      cam.amount = 0
    })
  },

  systems: [{
    phase: 'fixed',
    run(world, seconds, context) {
      const cam = context.camera
      // Fixed systems only run while playing or simulating, so there is no
      // "am I in edit mode" check here. But a camera with nothing to follow
      // must not touch the view — an agent calling simulate() while editing
      // should not find its viewport moved.
      if (!cam.target) return
      if (!world.entities.includes(cam.target)) { cam.target = null; return }

      const view = context.view
      const rule = cam.rule

      const lead = (rule.lookAhead ?? 0) * (cam.target.velocityX ?? 0)
      const k = clamp(rule.lerp ?? 0.12, 0, 1)
      view.x += (cam.target.x + lead - view.x) * k
      view.y += (cam.target.y + (rule.offsetY ?? 0) - view.y) * k

      if (rule.bounds) clampToBounds(view, rule.bounds, context.viewport)

      if (cam.amount > 0) {
        // context.random, not Math.random: a replay has to shake identically.
        view.x += context.random.range(-cam.amount, cam.amount)
        view.y += context.random.range(-cam.amount, cam.amount)
        cam.amount = Math.max(0, cam.amount - seconds * 2)
      }
    }
  }],

  commands: [{
    id: 'camera.state',
    label: 'Camera state',
    run: context => ({
      view: {
        x: round(context.view.x),
        y: round(context.view.y),
        zoom: round(context.view.zoom)
      },
      following: context.camera.target?.id ?? null,
      rule: context.camera.rule
    })
  }]
}

/**
 * Keep the visible rectangle inside the level's box.
 *
 * Measured in world units from the viewport size and zoom, so the same bounds
 * behave the same in a small panel and on a full screen. If the level is
 * narrower than the screen, centre on it rather than jam against one edge.
 */
function clampToBounds(view, [x0, y0, x1, y1], viewport) {
  const halfW = viewport.width / 2 / view.zoom
  const halfH = viewport.height / 2 / view.zoom

  view.x = (x1 - x0) <= halfW * 2 ? (x0 + x1) / 2 : clamp(view.x, x0 + halfW, x1 - halfW)
  view.y = (y1 - y0) <= halfH * 2 ? (y0 + y1) / 2 : clamp(view.y, y0 + halfH, y1 - halfH)
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = n => Math.round(n * 1000) / 1000
