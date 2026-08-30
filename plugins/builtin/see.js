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
 * What a browser-only command needs and does not have, plus the headless verb
 * that answers the same question without it — never a bare "browser only".
 *
 * `see.capture` and `see.moment` hold the plugin's only state-changing code:
 * camera borrow and restore, overlay conceal and reveal, waiting for a model
 * to finish loading. A refusal that stops before naming what is missing
 * leaves that code with no automated test any lane can run, so this names
 * every missing piece instead of the first one found.
 */
function needsRenderer(context, verb, instead) {
  const missing = []
  if (typeof document === 'undefined') missing.push('no DOM — this is a headless run')
  if (!context.renderer) missing.push('no context.renderer')
  if (!context.shell?.canvas) missing.push('no context.shell.canvas')
  if (!missing.length) return null
  return { why: `${verb} draws through the browser renderer: ${missing.join(', ')}.`, missing, instead }
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
        const name = options.name || `${context.editor.levelName}-sketch-${++frameNumber}`
        const description = describe(context, options)
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
              const cell = document.createElement('canvas')
              const drawn = lens === 'types' && sketchOnCanvas(description, options)
              cell.width = drawn ? drawn.canvas.width : Math.round(context.viewport.width / 2)
              cell.height = drawn ? drawn.canvas.height : Math.round(context.viewport.height / 2)
              const pen = cell.getContext('2d')
              if (drawn) pen.drawImage(drawn.canvas, 0, 0)
              else {
                context.renderer.sync(context.world)
                // Hidden per cell: a step between cells lets the overlay's own
                // plugin turn its sprites back on.
                overlays = options.ui === false ? concealOverlays(context) : []
                context.renderer.draw()
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
        const sheet = composeSheet(cells, { columns: lenses.length })
        const name = options.name || `${context.editor.levelName}-moment-${++frameNumber}`
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
        const description = describe(context, options)
        if (description.error) return description

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

        // A declared model may still be downloading — a preview spawned a
        // moment ago always is — and drawing now captures the placeholder box.
        const declaredModel = subjectEntity && (subjectEntity.mesh || subjectEntity._definition?.mesh)?.model
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
          const THREE = await import('three')
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
            return { error: 'the studio drew nothing — the subject rendered no pixels', subject: subjectEntity.id }
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

          copy = document.createElement('canvas')
          copy.width = crop.w
          copy.height = crop.h
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
            const flat = document.createElement('canvas')
            flat.width = crop.w
            flat.height = crop.h
            flat.getContext('2d').putImageData(image, 0, 0)
            pen.fillStyle = options.background
            pen.fillRect(0, 0, crop.w, crop.h)
            pen.drawImage(flat, 0, 0)
          } else {
            pen.putImageData(image, 0, 0)
          }
        } else {
          copy = document.createElement('canvas')
          copy.width = canvas.width
          copy.height = canvas.height
          pen = copy.getContext('2d')
          pen.drawImage(canvas, 0, 0)
          // The HUD and every game screen draw on their own 2D canvases over
          // the GL one, so a frame taken from GL alone shows a game with no
          // interface. They are stretched to the GL canvas because a layer is
          // sized in CSS pixels and the GL canvas in device pixels.
          if (options.ui !== false) {
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
          if (moved || studio || concealed.length || overlays.length) {
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
        const pixels = pen.getImageData(0, 0, copy.width, copy.height).data
        let anything = false
        const stride = Math.max(4, Math.floor(pixels.length / 4 / 400) * 4)
        for (let at = 3; at < pixels.length; at += stride) {
          if (pixels[at] > 0) { anything = true; break }
        }
        if (!anything) {
          return {
            error: 'the canvas read back empty — the answering tab is not drawing (hidden, throttled, or stale). Focus one editor tab and close the others.',
            hidden: document.hidden === true
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

        const name = options.name || `${context.editor.levelName}-${++frameNumber}`
        // `file` names the whole path, `name` names one inside the run
        // directory. Both stay under agent-runs/, so a frame never lands in the
        // project or at the root.
        const target = options.file ? String(options.file).replace(/^\.\//, '') : `agent-runs/see/${name}.png`
        if (!target.startsWith('agent-runs/') || !target.endsWith('.png')) {
          throw new Error(`file must be a .png path under agent-runs/, not "${target}"`)
        }
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
          counts: description.counts
        }
        })
      }
    }
  ]
}

