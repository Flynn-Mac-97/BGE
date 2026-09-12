/**
 * See — frames and frame facts for an agent, from any camera.
 *
 * An agent working headless has no eyes, and an agent with a browser pays
 * vision tokens for every look. This plugin answers visual questions in the
 * cheapest form that answers them:
 *
 *   see.describe  computed facts, no pixels. Works everywhere, costs nothing.
 *   see.occlusion, see.isolate, see.find, see.diff, see.camera
 *                 query verbs over the same facts — see/queries.js.
 *   see.sketch    a flat-colour frame drawn from those facts. Works everywhere.
 *   see.capture   the real rendered frame. Browser only.
 *
 * Every image outlines each marked entity's screen hull in its type's
 * colour, and the JSON sidecar carries the legend — palette (type to hex),
 * marks (number to id), hull points. Everything computable is in the
 * sidecar, never asked of vision. A `__files` reply is written to disk by
 * the CLI. Frames are named by level name and a frame number, never by a
 * clock.
 */
import { sketchPixels, sketchOnCanvas, writeFrameFiles, composeSheet, browserFiles } from '../../engine/frame-sketch.js'
import { convexHull } from '../../engine/frame-facts.js'
import { describe, simplifyHull } from './see/describe.js'
import { resolveView, view } from './see/views.js'
import { occlusion, isolate, find, diff, camera, identify } from './see/queries.js'
import { ray } from './see/ray.js'

let frameNumber = 0

/**
 * Which client this page is: `?client=<name>` for a lane, else the random
 * session id the tab beacon wrote (`engine:tab-id`, set in vite.config.js).
 * The frame counter runs per page, so a name is what keeps two lanes counting
 * from one apart off the same path. Headless there is no page and no client.
 */
function clientName() {
  if (typeof location === 'undefined') return null
  const asked = new URLSearchParams(location.search).get('client')
  const name = asked || readSessionValue('engine:tab-id')
  return name ? String(name).replace(/[^a-z0-9_-]+/gi, '-') : null
}

function readSessionValue(key) {
  try { return sessionStorage.getItem(key) } catch { return null }
}

/**
 * Is a frame already written at this path? The dev server serves the checkout,
 * so one HEAD answers it — and Vite answers a missing path with the editor's
 * HTML, so the content type is the test and the status is not. A probe that
 * cannot run answers no; refusing on a failed check would block a capture for
 * nothing.
 */
async function frameWritten(path) {
  if (typeof fetch !== 'function' || typeof location === 'undefined') return false
  try {
    const answer = await fetch('/' + encodeURI(path), { method: 'HEAD', cache: 'no-store' })
    return (answer.headers.get('content-type') || '').startsWith('image/png')
  } catch {
    return false
  }
}

/**
 * A generated frame name no file on disk holds. `kind` separates the image
 * verbs; the counter steps past what is written, so nothing is replaced.
 */
async function freeFrameName(context, kind) {
  const stem = [context.editor.levelName, clientName(), kind].filter(Boolean).join('-')
  let name = `${stem}-${++frameNumber}`
  for (let tries = 0; tries < 50 && await frameWritten(`agent-runs/see/${name}.png`); tries++) {
    name = `${stem}-${++frameNumber}`
  }
  return name
}

/**
 * The screen the game declares in game.json, `[width, height]` in CSS pixels,
 * or null. A game is designed for a screen; the window an agent has is not it.
 */
function declaredShape(context) {
  const device = context.device
  return device?.width > 0 && device?.height > 0 ? [device.width, device.height] : null
}

/**
 * The world as the declared screen shows it. An ortho camera fits world units
 * to viewport pixels, so a wide agent window shows more of the level than a
 * player ever sees; describing at the declared shape puts every screen
 * position, and the frame drawn from it, at the shape the art is ruled against.
 *
 * `see.capture` does the same through `renderer.frameSize`. This path has no
 * renderer, so it moves the viewport both of them read. Nothing is awaited
 * between the swap and the restore: no draw may read a viewport the renderer
 * is not sized to.
 */
function describeAtDeclaredShape(context, options) {
  const shape = declaredShape(context)
  if (!shape) return describe(context, options)
  const kept = { width: context.viewport.width, height: context.viewport.height }
  Object.assign(context.viewport, { width: shape[0], height: shape[1] })
  try {
    return describe(context, options)
  } finally {
    Object.assign(context.viewport, kept)
  }
}

/**
 * Hide player-facing overlay objects for one draw. Anything a plugin marks
 * `userData.overlay = true` — damage numbers and their kin — is HUD in the
 * scene, not world, and `ui: false` leaves it out of the frame.
 */
function concealOverlays(context) {
  const hidden = []
  for (const child of context.renderer?.scene?.children || []) {
    if (child.userData?.overlay && child.visible) {
      child.visible = false
      hidden.push(child)
    }
  }
  return hidden
}

/** Give back what concealOverlays borrowed. Every hide is paired with a show. */
function revealOverlays(hidden) {
  for (const child of hidden) child.visible = true
}

/**
 * What a drawing command needs and does not have, plus the headless verb that
 * answers the same question without it — never a bare "browser only".
 *
 * The test is the surface, not the DOM. A headless world started with
 * `renderer: 'null'` answers the same surface and draws nothing, so the whole
 * mutate-and-restore path below runs and every frame comes back blank. Without
 * that, a headless run has no renderer and this refuses.
 */
function needsRenderer(context, verb, instead) {
  const missing = []
  if (!context.renderer) missing.push('no context.renderer')
  if (!context.shell?.canvas) missing.push('no context.shell.canvas')
  if (!canMakeCanvas(context)) missing.push('no way to make a canvas — no DOM and no renderer.createCanvas')
  if (!missing.length) return null
  return { why: `${verb} draws through a renderer: ${missing.join(', ')}.`, missing, instead }
}

const canMakeCanvas = context =>
  typeof document !== 'undefined' || typeof context.renderer?.createCanvas === 'function'

/** A blank canvas of this size, from the DOM or from a renderer with no DOM. */
function makeCanvas(context, width, height) {
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : context.renderer.createCanvas(width, height)
  canvas.width = width
  canvas.height = height
  return canvas
}

/** True only of a real backgrounded tab. A headless world has no tab to hide. */
const tabHidden = () => typeof document !== 'undefined' && document.hidden === true

/**
 * Why a frame came back with nothing in it. A renderer that draws nothing is a
 * different fault from a tab that stopped drawing, and one fix does not answer
 * the other.
 */
const blankFrameReason = context => context.renderer?.blank
  ? 'this world has the renderer surface with nothing behind it, so every frame is blank. '
    + 'Use see.sketch for a frame headless, or capture through a browser.'
  : 'the answering tab is not drawing (hidden, throttled, or stale). Focus one editor tab and close the others.'

/** Below this share of the level in frame, a capture is measuring a view nobody plays. */
const REPRESENTATIVE_SHARE = 0.05

/** Under this many entities, a share says nothing — a small level has no crowd to miss. */
const ENOUGH_TO_JUDGE = 20

/**
 * Whether the frame holds enough of the level to be judged as the game's look.
 *
 * A camera override frames whatever it is pointed at, and a clear patch of
 * ground gives brightness and coverage numbers no art change can move. Says so
 * rather than leaving the reader to notice. A `subject` shot frames one thing on
 * purpose and is never measured.
 */
function unrepresentativeFrame(description, options) {
  if (options.subject || options.alone) return null
  const visible = description.counts?.visible || 0
  const total = visible + (description.counts?.offscreen || 0)
  if (total < ENOUGH_TO_JUDGE) return null
  const share = visible / total
  if (share >= REPRESENTATIVE_SHARE) return null
  return `this frame holds ${visible} of the level's ${total} entities, ${Math.round(share * 100)}% — `
    + 'the camera may be pointed where the game never looks, and numbers measured here say nothing '
    + 'about the art. see.view \'{"aim":"you","back":3}\' frames a position that is played.'
}

/**
 * The camera fields an image command may borrow.
 *
 * A look must hand the editor back the camera it took. Copied before the move
 * and restored in a `finally`, because the paths that do not finish — an empty
 * studio, a lost context, a model that never arrives — are exactly the ones
 * that would otherwise leave someone staring down a borrowed lens.
 */
const keepView = view => ({
  x: view.x, y: view.y, z: view.z, yaw: view.yaw, pitch: view.pitch,
  fov: view.fov, mode: view.mode, zoom: view.zoom
})

/**
 * Write the mark number to id map onto the description itself.
 *
 * The sidecar is what leaves the machine: a vision reader is handed the PNG
 * and the JSON, never the command's reply. So every binding the reply carries,
 * the file carries too. Mark numbers sit on each entry; this is the index that
 * reads the other way, from "outline 12" back to an id.
 */
function bindMarks(description) {
  description.marks = Object.fromEntries((description.visible || [])
    .filter(entry => entry.mark)
    .map(entry => [entry.mark, entry.id]))
  return description.marks
}

/**
 * A subject may be an entity id, or just a TYPE name. A live instance wins;
 * with none, the plugin previews the type itself — a temporary spawn, framed
 * alone, destroyed on the way out — because "show me the rat" should not
 * require the caller to invent a spawn-look-clean workflow. Two agents spent
 * fifty calls each building exactly that by hand. A name that is neither an
 * id nor a type answers early with what exists, instead of inviting a search.
 */
async function withSubject(context, options, run) {
  const wanted = options.subject
  if (!wanted || context.world.byId(wanted)) return run(options)

  if (!context.world.types.has(wanted)) {
    return {
      error: `no entity or type "${wanted}"`,
      types: [...context.world.types.keys()],
      hint: 'name a live entity id, or a type — a type is previewed without needing an instance'
    }
  }

  const instance = context.world.all(wanted)[0]
  if (instance) return run({ ...options, subject: instance.id })

  // The preview takes a name of its own rather than the world's id counter:
  // that counter decides what every later spawn is called, and looking at a
  // type must not rename the things a seeded run goes on to make.
  const previewId = `see-preview-${wanted}`
  const spawned = context.spawn(wanted,
    { at: [0, 2, 0], ...(context.world.byId(previewId) ? {} : { id: previewId }) })
  try {
    const result = await run({ ...options, subject: spawned.id, alone: options.alone ?? true })
    if (result && typeof result === 'object') result.preview = { type: wanted, spawnedAndRemoved: true }
    return result
  } finally {
    context.destroy(spawned)
  }
}

export default {
  name: 'See',
  category: 'agents',
  about: 'Frames and frame facts from any camera — computed facts first, pixels only when pixels are the question.',
  inspect: () => [{ title: 'See', rows: [['frames taken', frameNumber]] }],

  onLoad(context) {
    context.see = {
      describe: options => describe(context, options),
      sketch: options => sketchPixels(describe(context, options), options),
      occlusion: options => occlusion(context, options),
      isolate: options => isolate(context, options),
      find: predicates => find(context, predicates),
      diff: options => diff(context, options),
      camera: () => camera(context),
      ray: options => ray(context, options),
      identify: options => identify(context, options)
    }
  },

  commands: [
    {
      id: 'see.describe',
      label: 'What is on screen, as computed facts — no pixels, no vision read',
      run: async (context, options) => {
        const resolved = await resolveView(context, options || {})
        return resolved.error ? resolved : withSubject(context, resolved, opts => describe(context, opts))
      }
    },
    {
      id: 'see.view',
      label: 'Save, list, drop, or aim the camera — a view worth returning to is a word',
      run: (context, options) => view(context, options || {})
    },
    {
      id: 'see.occlusion',
      label: 'How much of one entity the camera sees, and who blocks the rest',
      run: (context, options) => occlusion(context, options || {})
    },
    {
      id: 'see.isolate',
      label: 'One entity in full — world box, screen box, cover, velocity, camera relation',
      run: (context, options) => withSubject(context, options || {}, opts => isolate(context, opts))
    },
    {
      id: 'see.find',
      label: 'Every entity matching the given predicates, on screen or off',
      run: (context, options) => find(context, options || {})
    },
    {
      id: 'see.diff',
      label: 'What appeared, moved, or left over exact fixed steps',
      run: (context, options) => diff(context, options || {})
    },
    {
      id: 'see.camera',
      label: 'Why the frame looks wrong, asked of the camera itself',
      run: context => camera(context)
    },
    {
      id: 'see.ray',
      label: 'What sits at a screen point, a grid of them, or in a direction from an entity',
      run: (context, options) => ray(context, options || {})
    },
    {
      id: 'see.identify',
      // The one question the plugin was built for: a player points at something
      // and asks what it is. `see.ray` answers the same point from geometry;
      // this answers it from the pixel the renderer actually drew.
      label: 'What is drawn at this screen point, by the renderer that drew it',
      run: (context, options) => identify(context, options || {})
    },
    {
      id: 'see.sketch',
      label: 'A flat-colour frame of screen hulls, drawn without a renderer',
      run: async (context, options = {}) => {
        options = await resolveView(context, options)
        if (options.error) return { error: options.error }
        return withSubject(context, options, async options => {
        const name = options.name || await freeFrameName(context, 'sketch')
        const description = describeAtDeclaredShape(context, options)
        if (description.error) return description
        // An alone shot promises one thing in the frame, and none of it is not
        // a picture of that thing. Refusing names the subject, where a blank
        // PNG would be read as an answer about how the model looks.
        if (options.alone && options.subject && !description.visible.length) {
          return {
            error: 'the studio drew nothing — the subject is outside this camera\'s frame',
            subject: options.subject
          }
        }
        const marks = bindMarks(description)
        // In the browser a 2D canvas encodes the PNG itself — no zlib, and
        // the caller gets a dataUrl it can show without touching disk.
        if (typeof document !== 'undefined') {
          const drawn = sketchOnCanvas(description, options)
          if (drawn.error) return drawn
          return {
            dataUrl: drawn.dataUrl,
            __files: browserFiles(name, drawn.dataUrl.split(',')[1], drawn.description),
            marks,
            palette: description.palette,
            counts: drawn.description.counts
          }
        }
        const drawn = sketchPixels(description, options)
        if (drawn.error) return drawn
        const { encodePng } = await import(/* @vite-ignore */ '../../tools/lib/texture.mjs')
        const png = encodePng(drawn.width, drawn.height, drawn.pixels)
        return {
          ...(await writeFrameFiles(name, png, drawn.description)),
          marks,
          palette: description.palette,
          counts: drawn.description.counts
        }
        })
      }
    },
    {
      id: 'see.moment',
      label: 'One moment through several lenses, stepped forward, on one labelled sheet',
      /**
       * The same instant through each lens — the real frame, and the flat
       * type layer that is its answer key — then whole fixed steps forward
       * and both again. A lens disagreement locates a defect: in the pixels
       * but not the scene is a rendering artifact, in the scene but not the
       * pixels is an invisible entity. Advances the world; `stop` restores.
       */
      run: async (context, options = {}) => {
        const missing = needsRenderer(context, 'a moment sheet',
          'headless, step to each instant yourself (simulate, or script with ["simulate", n]) and call '
          + 'see.sketch there — the render-versus-scene comparison needs a renderer, but reading a stepped '
          + 'moment\'s computed facts does not.')
        if (missing) return missing
        options = await resolveView(context, options)
        if (options.error) return { error: options.error }
        // Every refusal is answered before a single mutation, so a command that
        // will not draw has not moved anything by the time it says so.
        if (context.loop.paused) {
          return {
            error: `the clock is held by ${JSON.stringify(context.loop.holds)}, so no step between cells can pass — the sheet would be one instant shown three times`,
            holds: context.loop.holds,
            hint: 'release the hold, or answer the waiting screen first — screen.read names it'
          }
        }
        // A subject naming nothing is a refusal, and a refusal has to arrive
        // before the world is stepped rather than after three cells of it.
        const named = describe(context, options)
        if (named.error) return named
        const steps = options.steps || [0, 6, 30]
        const lenses = options.lenses || ['render', 'types']

        const view = context.view
        const kept = keepView(view)
        // The render lens draws through the LIVE camera while the type lens
        // projects from the options, so a camera override has to reach both or
        // the two halves of a cell are two different views and every honest
        // disagreement is drowned in one manufactured one.
        const borrowsCamera = !!(options.camera || options.subject)
        // The sheet is drawn and joined on DOM canvases (frame-sketch.js), so a
        // world with no DOM steps and restores but produces no picture.
        const composes = typeof document !== 'undefined'
        let overlays = []
        const cells = []
        const moments = []
        let advanced = 0
        try {
          if (!context.loop.running && !context.world.simulated) {
            context.world.simulated = true
            for (const entity of [...context.world.entities]) context.world.hook(entity, 'start', context)
          }
          for (const step of [...steps].sort((a, b) => a - b)) {
            if (step > advanced) { context.loop.step(step - advanced); advanced = step }
            const description = describe(context, options)
            if (borrowsCamera) Object.assign(view, description.camera)
            bindMarks(description)
            moments.push({ afterSteps: step, counts: description.counts, palette: description.palette, marks: description.marks, marked: description.visible.filter(v => v.mark) })
            for (const lens of lenses) {
              if (lens !== 'types') {
                context.renderer.sync(context.world)
                // Hidden per cell: a step between cells lets the overlay's own
                // plugin turn its sprites back on.
                overlays = options.ui === false ? concealOverlays(context) : []
                context.renderer.draw()
              }
              // The sheet is composed on DOM canvases, so without a DOM the
              // world is still stepped and the camera still borrowed and put
              // back — there is simply no picture at the end of it.
              if (!composes) { revealOverlays(overlays); overlays = []; continue }
              const cell = document.createElement('canvas')
              const drawn = lens === 'types' && sketchOnCanvas(description, options)
              cell.width = drawn ? drawn.canvas.width : Math.round(context.viewport.width / 2)
              cell.height = drawn ? drawn.canvas.height : Math.round(context.viewport.height / 2)
              const pen = cell.getContext('2d')
              if (drawn) pen.drawImage(drawn.canvas, 0, 0)
              else {
                pen.drawImage(context.shell.canvas, 0, 0, cell.width, cell.height)
                revealOverlays(overlays)
                overlays = []
              }
              cells.push({ label: `${lens} +${step} steps`, image: cell })
            }
          }
        } finally {
          revealOverlays(overlays)
          if (borrowsCamera) Object.assign(view, kept)
          if (borrowsCamera || options.ui === false) {
            // The editor's own picture is stale after a borrowed camera or a
            // hidden overlay; a repaint that fails must not become the answer.
            try {
              context.renderer.sync(context.world)
              context.renderer.draw()
            } catch { /* the cells are already drawn */ }
          }
        }
        if (!composes) {
          return {
            error: 'no sheet — the cells are drawn and joined on DOM canvases, and this world has none. '
              + 'The world was stepped to each instant and the camera put back; see.sketch draws each one.',
            steps,
            moments: moments.map(moment => ({ afterSteps: moment.afterSteps, visible: moment.counts.visible }))
          }
        }
        const sheet = composeSheet(cells, { columns: lenses.length })
        const name = options.name || await freeFrameName(context, 'moment')
        return {
          __files: browserFiles(name, sheet.toDataURL('image/png').split(',')[1], moments),
          dataUrl: sheet.toDataURL('image/png'),
          steps, lenses, moments: moments.map(moment => ({ afterSteps: moment.afterSteps, visible: moment.counts.visible }))
        }
      }
    },
    {
      id: 'see.capture',
      label: 'The real rendered frame, hulls outlined, with a JSON sidecar',
      run: async (context, options = {}) => {
        const missing = needsRenderer(context, 'a capture',
          'headless, see.sketch takes the same options and draws a flat-colour frame from the same '
          + 'computed facts, with no renderer — real art and lighting need the browser.')
        if (missing) return missing
        options = await resolveView(context, options)
        if (options.error) return { error: options.error }
        return withSubject(context, options, async options => {
        let description = describe(context, options)
        if (description.error) return description
        // `size` states the shape to judge — [width, height] in pixels. With
        // nothing stated the game's declared device decides it, so every frame
        // of a game comes out at the screen its art is ruled against.
        const stated = Array.isArray(options.size) && options.size.length === 2
          ? options.size.map(Number).filter(side => Number.isFinite(side) && side > 0)
          : null
        if (options.size && stated?.length !== 2) {
          return { error: `size is [width, height] in pixels, for example {"size":[540,960]}` }
        }
        const sized = stated || declaredShape(context)
        // The window's own shape, read before the frame size replaces it. The
        // HUD is laid out for the window, so it can be composited honestly only
        // when the frame is that shape.
        const windowShape = context.renderer.size
        const stretched = !!sized
          && (sized[0] !== Math.round(windowShape.w) || sized[1] !== Math.round(windowShape.h))

        const view = context.view
        const kept = keepView(view)
        const wants = { ...(options.camera || {}) }
        if (options.subject) Object.assign(wants, description.camera, options.camera || {})
        const moved = Object.keys(wants).length > 0
        const subjectEntity = options.subject && context.world.byId(options.subject)

        // `alone` must be true of the pixels, not only of the description:
        // everything but the subject is hidden, and the scene's own grade —
        // its lights, fog, sky — is swapped for a neutral studio, because a
        // model judged under a dusk key is a judgement of the dusk. Restored
        // below, whole.
        const concealed = []
        let studio = null
        let overlays = []
        let copy, pen, crop = null, silhouette = null
        // The camera moves inside this try, not before it: everything from
        // here on mutates live render state, and the finally is the ONE way
        // out. An empty studio, a lost context, a model that never arrives and
        // a throw mid-draw all hand the editor back the world it lent.
        try {
        if (moved) Object.assign(view, wants, wants.mode ? {} : { mode: 'perspective' })
        // Before every measurement below, so screen positions belong to the
        // frame delivered rather than to the window.
        if (sized) {
          context.renderer.frameSize(sized[0], sized[1])
          description = describe(context, options)
        }

        // A declared model may still be downloading — a preview spawned a
        // moment ago always is — and drawing now captures the placeholder box.
        // A renderer that draws nothing loads nothing, so there is no arrival
        // to wait for and waiting would only cost two seconds.
        const declaredModel = !context.renderer.blank
          && subjectEntity && (subjectEntity.mesh || subjectEntity._definition?.mesh)?.model
        for (let waited = 0; waited < 40 && declaredModel
          && context.renderer.modelState?.(declaredModel) !== 'ready'
          && context.renderer.modelState?.(declaredModel) !== 'failed'; waited++) {
          context.renderer.sync(context.world)
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        if (options.alone && subjectEntity) {
          for (const other of context.world.entities) {
            if (other === subjectEntity || other.hidden) continue
            other.hidden = true
            concealed.push(other)
          }
          const THREE = await import('three/webgpu')
          const scene = context.renderer.scene
          studio = { THREE, scene, background: scene.background, fog: scene.fog, dimmed: [], passes: context.renderer.passes?.list || [] }
          scene.fog = null
          // No backdrop at all: the studio pass renders into an RGBA target,
          // and empty stays empty — true alpha from the engine, nothing to key.
          scene.background = null
          // Post effects are a grade too — a vignette shades the backdrop and
          // bloom lifts the colours — so a neutral draw runs with none.
          context.renderer.passes?.set([])
          for (const child of scene.children) {
            if (child.isLight && child.visible) { child.visible = false; studio.dimmed.push(child) }
          }
          studio.rig = new THREE.Group()
          studio.rig.add(new THREE.AmbientLight('#ffffff', 0.9))
          const key = new THREE.DirectionalLight('#ffffff', 1.7)
          key.position.set(2, 4, 3)
          studio.rig.add(key)
          scene.add(studio.rig)
        }

        // Always drawn fresh, never copied as-is: a hidden or throttled tab
        // stops painting, and its stale canvas reads back as nothing.
        context.renderer.sync(context.world)
        if (options.ui === false) overlays = concealOverlays(context)
        // The sky is a sphere riding the camera and effects are scene
        // children, not entities — in the studio, everything that is not the
        // subject or the rig goes dark for the one draw.
        if (studio) {
          for (const child of studio.scene.children) {
            if (!child.visible || child === studio.rig) continue
            if (child.userData?.entity === subjectEntity.id) continue
            child.visible = false
            studio.dimmed.push(child)
          }
        }
        context.renderer.draw()

        // An alone frame is rendered by the engine straight into an RGBA
        // target with NO background — real per-pixel alpha from the draw, so
        // there is nothing to key and no fringe to leave. Cropped to the
        // pixels that carry coverage: no declared box can cut geometry off,
        // and every delivered pixel IS the subject.
        const canvas = context.shell.canvas
        if (studio) {
          const target = new studio.THREE.WebGLRenderTarget(canvas.width, canvas.height)
          const raw = new Uint8Array(canvas.width * canvas.height * 4)
          context.renderer.drawInto(target, raw)
          target.dispose()

          // One scan answers both questions the readback holds: where the drawn
          // pixels end, and what shape they make. Only a row's first and last
          // drawn pixel can sit on the outline, so the spans are the whole
          // input a hull needs.
          let left = canvas.width, right = 0, top = canvas.height, bottom = 0
          const spans = new Map()
          for (let y = 0; y < canvas.height; y++) {
            const row = (canvas.height - 1 - y) * canvas.width
            let first = -1, last = -1
            for (let x = 0; x < canvas.width; x++) {
              if (raw[(row + x) * 4 + 3] < 8) continue
              if (first < 0) first = x
              last = x
            }
            if (first < 0) continue
            spans.set(y, [first, last])
            if (first < left) left = first
            if (last > right) right = last
            if (y < top) top = y
            bottom = y
          }
          if (right <= left || bottom <= top) {
            return {
              error: 'the studio drew nothing — the subject rendered no pixels',
              why: blankFrameReason(context),
              subject: subjectEntity.id
            }
          }
          const pad = Math.max(12, Math.round((right - left) * 0.08))
          crop = { x: Math.max(0, left - pad), y: Math.max(0, top - pad) }
          crop.w = Math.min(canvas.width - crop.x, right - left + pad * 2)
          crop.h = Math.min(canvas.height - crop.y, bottom - top + pad * 2)

          // The crop reframes the picture, so describe's projected box hull now
          // points at nothing. Traced from the alpha the draw actually laid
          // down, in the delivered image's own percent coordinates, the hull is
          // true of the file that ships rather than of the frame it came from.
          const points = []
          for (const [y, [first, last]] of spans) {
            for (const x of [first, last + 1]) {
              points.push([(x - crop.x) / crop.w * 100, (y - crop.y) / crop.h * 100])
              points.push([(x - crop.x) / crop.w * 100, (y + 1 - crop.y) / crop.h * 100])
            }
          }
          const traced = convexHull(points)
          if (traced.length >= 3) silhouette = traced.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])

          copy = makeCanvas(context, crop.w, crop.h)
          pen = copy.getContext('2d')
          const image = pen.createImageData(crop.w, crop.h)
          for (let y = 0; y < crop.h; y++) {
            const from = ((canvas.height - 1 - (crop.y + y)) * canvas.width + crop.x) * 4
            image.data.set(raw.subarray(from, from + crop.w * 4), y * crop.w * 4)
          }
          // The target reads back linear; the screen the colours were authored
          // against is sRGB. Encoded here, or every preview ships too dark.
          const bits = image.data
          for (let at = 0; at < bits.length; at += 4) {
            for (let channel = 0; channel < 3; channel++) {
              const linear = bits[at + channel] / 255
              bits[at + channel] = Math.round(255 * (linear <= 0.0031308
                ? linear * 12.92
                : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055))
            }
          }
          // Transparent unless the caller asks for a colour — a test may need
          // a known backdrop to assert against, or a mid-tone to judge under.
          if (options.background && options.background !== 'alpha') {
            const flat = makeCanvas(context, crop.w, crop.h)
            flat.getContext('2d').putImageData(image, 0, 0)
            pen.fillStyle = options.background
            pen.fillRect(0, 0, crop.w, crop.h)
            pen.drawImage(flat, 0, 0)
          } else {
            pen.putImageData(image, 0, 0)
          }
        } else {
          copy = makeCanvas(context, canvas.width, canvas.height)
          pen = copy.getContext('2d')
          pen.drawImage(canvas, 0, 0)
          // The HUD and every game screen draw on their own 2D canvases over
          // the GL one, so a frame taken from GL alone shows a game with no
          // interface. They are stretched to the GL canvas because a layer is
          // sized in CSS pixels and the GL canvas in device pixels.
          // A layer is laid out for the window, so at any other shape it can
          // only be stretched. Left out unless the caller asked for it by name.
          // No DOM, no layers: the HUD and the game screens are drawn by the
          // browser shell, and a world without one has no interface to composite.
          if (options.ui !== false && (!stretched || options.ui === true) && typeof document !== 'undefined') {
            // A hidden tab runs no frames, so the layers hold whatever was
            // painted last. The world is drawn fresh above and is fine; the
            // interface would be a picture of an older screen.
            if (document.hidden) {
              throw new Error(
                'this tab is hidden, so the HUD and screen layers hold a stale picture. '
                + 'Bring the tab to the front, or pass {"ui":false} to capture the world alone.')
            }
            for (const layer of document.querySelectorAll('canvas.hud-layer, canvas.screen-layer')) {
              if (layer.width && layer.height) pen.drawImage(layer, 0, 0, copy.width, copy.height)
            }
          }
        }

        // Where the renderer can say, a marked hull is upgraded from box
        // corners to the entity's drawn silhouette — one ID pass, before the
        // camera is put back, so the trace matches the frame just taken. The
        // box hull stands where an entity drew nothing.
        if (options.marks !== false && !crop && !studio) {
          try {
            const { silhouettes } = await import(/* @vite-ignore */ './see/id-buffer.js')
            const traced = await silhouettes(context, description.visible.filter(v => v.mark).map(v => v.id))
            for (const entry of description.visible) {
              if (!entry.mark || !(traced?.[entry.id]?.length >= 3)) continue
              // A traced silhouette follows every pixel of an edge, so a rat one
              // percent of the frame wide arrives with fourteen points and
              // repeats. The sidecar is what reaches a reader, and its budget is
              // spent on outlines nobody can see at that size.
              const simplified = simplifyHull(traced[entry.id], Math.max(entry.size[0], entry.size[1]))
              if (simplified) entry.hull = simplified
            }
          } catch {
            // No ID pass, no upgrade — the box hulls already drawn are honest.
          }
        }

        } finally {
          if (sized) context.renderer.resize()
          for (const other of concealed) other.hidden = false
          revealOverlays(overlays)
          if (studio) {
            studio.scene.remove(studio.rig)
            studio.scene.background = studio.background
            studio.scene.fog = studio.fog
            for (const child of studio.dimmed) child.visible = true
            context.renderer.passes?.set(studio.passes)
          }
          if (moved) Object.assign(view, kept)
          if (sized || moved || studio || concealed.length || overlays.length) {
            // The editor's own picture is stale after a borrowed camera or a
            // dimmed scene; a repaint that fails must not become the answer.
            try {
              context.renderer.sync(context.world)
              context.renderer.draw()
            } catch { /* the frame is already taken */ }
          }
        }

        // A frame of nothing must never come back labelled as a frame. Sample
        // a grid of pixels; if every one is fully transparent the readback
        // failed, and the honest answer says so instead of shipping marks
        // floating on a blank.
        // Measured from the description, not from pixels, so a blank frame that
        // is blank BECAUSE the camera points at nothing says both.
        const framing = unrepresentativeFrame(description, options)

        const pixels = pen.getImageData(0, 0, copy.width, copy.height).data
        let anything = false
        const stride = Math.max(4, Math.floor(pixels.length / 4 / 400) * 4)
        for (let at = 3; at < pixels.length; at += stride) {
          if (pixels[at] > 0) { anything = true; break }
        }
        if (!anything) {
          return {
            error: `the canvas read back empty — ${blankFrameReason(context)}`,
            blank: true,
            hidden: tabHidden(),
            ...(framing ? { framing } : {})
          }
        }

        // Exposure is arithmetic, not judgement: mean brightness of a 4x4 grid
        // of the frame, 0-100, so "too dark to read" is a number in the sidecar
        // before anyone spends a vision read on it.
        //
        // Only pixels the draw put down are measured. A cropped studio frame is
        // mostly transparent background, and averaging emptiness in reports a
        // well-lit model as nearly black — the one reading this field exists to
        // prevent. A cell with nothing drawn in it has no brightness and says
        // `null`; `over` names which pixels answered, so the number's meaning
        // is never a guess.
        const cells = []
        let litSum = 0, litSeen = 0, looked = 0
        const cellW = Math.floor(copy.width / 4), cellH = Math.floor(copy.height / 4)
        for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
          let sum = 0, seen = 0
          for (let y = gy * cellH; y < (gy + 1) * cellH; y += 8) {
            for (let x = gx * cellW; x < (gx + 1) * cellW; x += 8) {
              const at = (y * copy.width + x) * 4
              looked++
              if (pixels[at + 3] < 8) continue
              sum += 0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2]
              seen++
            }
          }
          litSum += sum
          litSeen += seen
          cells.push(seen ? Math.round(sum / seen / 2.55) : null)
        }
        const drawnCells = cells.filter(cell => cell !== null)
        description.light = {
          mean: litSeen ? Math.round(litSum / litSeen / 2.55) : 0,
          darkestCell: drawnCells.length ? Math.min(...drawnCells) : null,
          brightestCell: drawnCells.length ? Math.max(...drawnCells) : null,
          grid: cells,
          over: litSeen === looked
            ? 'every pixel of the frame'
            : 'the pixels the draw put down — a transparent background is not darkness',
          measuredFraction: Math.round(litSeen / Math.max(1, looked) * 100) / 100
        }

        // Which screen this frame was taken at, so a set of frames can be
        // checked for mixed shapes after the fact instead of trusting a reply
        // nobody kept. `frame` is the PNG's own pixels; `pixelRatio` is what
        // the canvas actually drew at, not what the game asked for.
        const shape = sized || [Math.round(windowShape.w), Math.round(windowShape.h)]
        description.profile = {
          width: shape[0],
          height: shape[1],
          orientation: shape[1] > shape[0] ? 'portrait' : 'landscape',
          from: stated ? 'the size given' : sized ? 'game.json device' : 'the window',
          frame: [copy.width, copy.height],
          // A studio frame is cropped to the drawn pixels, so its PNG is
          // smaller than the screen it was drawn on and no ratio relates them.
          ...(crop
            ? { cropped: true }
            : { pixelRatio: Math.round(copy.width / Math.max(1, shape[0]) * 100) / 100 })
        }
        if (framing) description.framing = framing

        // Marks are hulls: each marked entity outlined in its TYPE's colour,
        // right on its own pixels — a numbered tag floats above the thing it
        // tags, where game text (damage numbers) also lives, and a reader
        // cannot tell tag from HUD or bind a floating number to the body
        // below it. `palette` in the reply maps colour to type; the subject
        // is white and wider. `marks: "tags"` keeps the numbered stamps.
        if (options.marks !== false && !crop) {
          if (options.marks === 'tags') {
            const tag = Math.max(14, Math.round(copy.height / 45))
            pen.font = `bold ${tag}px system-ui, sans-serif`
            pen.textAlign = 'center'
            pen.textBaseline = 'middle'
            for (const entry of description.visible) {
              if (!entry.mark) continue
              const x = entry.at[0] / 100 * copy.width
              const y = Math.max(tag, (entry.at[1] - entry.size[1] / 2) / 100 * copy.height - tag * 0.8)
              const text = String(entry.mark)
              const w = pen.measureText(text).width + tag * 0.6
              pen.fillStyle = 'rgba(0, 0, 0, 0.82)'
              pen.fillRect(x - w / 2, y - tag * 0.62, w, tag * 1.24)
              pen.fillStyle = '#ffffff'
              pen.fillText(text, x, y)
            }
          } else {
            const line = Math.max(2, copy.height / 320)
            for (const entry of [...description.visible].reverse()) {
              if (!entry.mark || !entry.hull) continue
              const subject = entry.id === options.subject
              pen.beginPath()
              for (const [x, y] of entry.hull) pen.lineTo(x / 100 * copy.width, y / 100 * copy.height)
              pen.closePath()
              pen.strokeStyle = subject ? '#ffffff' : description.palette?.[entry.type] || '#ffffff'
              pen.lineWidth = subject ? line * 2 : line
              pen.stroke()
            }
          }
        }

        // A studio frame is the one frame nothing may be drawn on.
        //
        // It exists to judge how a model looks, and an outline drawn over a
        // frame measurably inflates a vision model's aesthetic score — the bias
        // survives pairwise comparison and survives warning the reader about
        // it, so a mark here would corrupt the only question the frame is ever
        // asked. The legend goes with it: `palette` names OUTLINE colours and
        // never a material, and a legend beside an unstroked picture invites a
        // reader to call a legend entry the animal's own fur, which is what
        // happened. Silence about either is the bug, so the reply says both.
        if (crop) {
          delete description.palette
          // The description goes for the same reason the palette does: a reader
          // handed "a low, long, dull-brown quadruped" reports seeing one.
          delete description.about
          delete description.undescribed
          for (const entry of description.visible) {
            delete entry.mark
            delete entry.hull
            if (silhouette) entry.silhouette = silhouette
          }
          description.unmarked = 'Nothing is drawn on this frame. It is a judgement frame, and an outline drawn '
            + 'on a frame inflates a vision model\'s score of it, so marking it would corrupt the question. '
            + 'There is no palette either: `palette` names OUTLINE colours and never a thing\'s own material, '
            + 'so no colour named anywhere binds to what you see here — read the colours off the pixels. '
            + '`silhouette` is the subject\'s traced outline in this image\'s percent coordinates, measured, not drawn. '
            + 'There is no description either — nothing here tells you what anything is, so read the picture.'
        }

        // `file` names the whole path, `name` names one inside the run
        // directory. Both stay under agent-runs/, so a frame never lands in the
        // project or at the root.
        const callerNamed = Boolean(options.file || options.name)
        const target = options.file
          ? String(options.file).replace(/^\.\//, '')
          : `agent-runs/see/${options.name || await freeFrameName(context, '')}.png`
        if (!target.startsWith('agent-runs/') || !target.endsWith('.png')) {
          throw new Error(`file must be a .png path under agent-runs/, not "${target}"`)
        }
        // A generated path never replaces a frame — `freeFrameName` stepped
        // past what is written. A path the caller stated is theirs to reuse,
        // and the reply names what it replaced. No frame goes silently.
        const replaced = callerNamed && await frameWritten(target) ? target : null
        const sidecarFile = target.replace(/\.png$/, '.json')
        const base64 = copy.toDataURL('image/png').split(',')[1]
        // The sidecar carries every binding the reply carries. A vision reader
        // is handed the PNG and the JSON and never sees the reply, so a map
        // kept only in the reply is a map kept from the one who needs it.
        const marks = bindMarks(description)
        const sidecar = typeof Buffer !== 'undefined'
          ? Buffer.from(JSON.stringify(description)).toString('base64')
          : btoa(unescape(encodeURIComponent(JSON.stringify(description))))
        return {
          __files: [
            { path: target, base64 },
            { path: sidecarFile, base64: sidecar }
          ],
          marks,
          ...(crop
            ? { subject: subjectEntity.id, unmarked: description.unmarked }
            : { palette: description.palette }),
          size: [copy.width, copy.height],
          profile: description.profile,
          ...(framing ? { framing } : {}),
          ...(replaced ? { replaced } : {}),
          ...(stretched
            ? {
              interface: options.ui === true
                ? 'stretched from the window layout — judge the world here, the interface at window size'
                : 'left out: a HUD is laid out for the window and can only be stretched to this shape. '
                  + 'Pass {"ui":true} to have it stretched in, or resize the window to this shape.'
            }
            : {}),
          counts: description.counts
        }
        })
      }
    }
  ]
}

