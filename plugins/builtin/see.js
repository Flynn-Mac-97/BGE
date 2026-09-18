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
import { describe } from './see/describe.js'
import { resolveView, view } from './see/views.js'
import { occlusion, isolate, find, diff, camera, identify } from './see/queries.js'
import { ray } from './see/ray.js'

import { capture } from './see/capture.js'
import { framesTaken, freeFrameName, describeAtDeclaredShape, concealOverlays, revealOverlays, needsRenderer, keepView, bindMarks, withSubject } from './see/frame-context.js'

/**
 * Every refusal a moment sheet can answer before it moves anything, or the
 * options it will run with.
 *
 * The order is the point: a command that cannot draw a sheet must not have
 * stepped the world by the time it says so, and `describe` is what tells a
 * subject that names nothing from one that names something.
 */
async function readyMoment(context, options) {
  const missing = needsRenderer(context, 'a moment sheet',
    'headless, step to each instant yourself (simulate, or script with ["simulate", n]) and call '
    + 'see.sketch there — the render-versus-scene comparison needs a renderer, but reading a stepped '
    + 'moment\'s computed facts does not.')
  if (missing) return { refusal: missing }

  const resolved = await resolveView(context, options)
  if (resolved.error) return { refusal: { error: resolved.error } }

  if (context.loop.paused) {
    return {
      refusal: {
        error: `the clock is held by ${JSON.stringify(context.loop.holds)}, so no step between cells can pass — the sheet would be one instant shown three times`,
        holds: context.loop.holds,
        hint: 'release the hold, or answer the waiting screen first — screen.read names it'
      }
    }
  }

  const named = describe(context, resolved)
  if (named.error) return { refusal: named }
  return { options: resolved }
}

/**
 * The overlays a frame lens concealed, or none for the type lens.
 *
 * A frame is drawn through the LIVE camera, so the overlay sprites are hidden
 * for the cell and put back by the caller: a step between cells would otherwise
 * let the overlay plugin turn them on again, mid-sheet.
 */
function frameForLens(context, lens, options) {
  if (lens === 'types') return []
  context.renderer.sync(context.world)
  const overlays = options.ui === false ? concealOverlays(context) : []
  context.renderer.draw()
  return overlays
}

/**
 * One cell of the sheet: the type layer where it can be drawn, the frame itself
 * otherwise, copied out of the shell canvas at half size.
 *
 * Returns the overlays still concealed afterwards. A frame cell copies the shell
 * canvas, which holds the concealed sprites, so they are revealed as the picture
 * is taken and must not be revealed a second time.
 */
function cellForLens(context, lens, description, options, overlays) {
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
  return { cell, overlays }
}

export default {
  name: 'See',
  category: 'agents',
  about: 'Frames and frame facts from any camera.',
  inspect: () => [{ title: 'See', rows: [['frames taken', framesTaken()]] }],

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
      label: 'What is on screen',
      run: async (context, options) => {
        const resolved = await resolveView(context, options || {})
        return resolved.error ? resolved : withSubject(context, resolved, opts => describe(context, opts))
      }
    },
    {
      id: 'see.view',
      label: 'Saved views',
      run: (context, options) => view(context, options || {})
    },
    {
      id: 'see.occlusion',
      label: 'How much is visible',
      run: (context, options) => occlusion(context, options || {})
    },
    {
      id: 'see.isolate',
      label: 'One entity in full',
      run: (context, options) => withSubject(context, options || {}, opts => isolate(context, opts))
    },
    {
      id: 'see.find',
      label: 'Matching entities',
      run: (context, options) => find(context, options || {})
    },
    {
      id: 'see.diff',
      label: 'Changes over steps',
      run: (context, options) => diff(context, options || {})
    },
    {
      id: 'see.camera',
      label: 'Frame faults',
      run: context => camera(context)
    },
    {
      id: 'see.ray',
      label: 'Screen point or ray',
      run: (context, options) => ray(context, options || {})
    },
    {
      id: 'see.identify',
      // The one question the plugin was built for: a player points at something
      // and asks what it is. `see.ray` answers the same point from geometry;
      // this answers it from the pixel the renderer actually drew.
      label: 'Pixel at a point',
      run: (context, options) => identify(context, options || {})
    },
    {
      id: 'see.sketch',
      label: 'Flat screen hulls',
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
      label: 'Moment, several lenses',
      /**
       * The same instant through each lens — the real frame, and the flat
       * type layer that is its answer key — then whole fixed steps forward
       * and both again. A lens disagreement locates a defect: in the pixels
       * but not the scene is a rendering artifact, in the scene but not the
       * pixels is an invisible entity. Advances the world; `stop` restores.
       */
      run: async (context, options = {}) => {
        const ready = await readyMoment(context, options)
        if (ready.refusal) return ready.refusal
        options = ready.options
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
            if (borrowsCamera) Object.assign(view, description.camera, { borrowedBy: 'see.moment' })
            bindMarks(description)
            moments.push({ afterSteps: step, counts: description.counts, palette: description.palette, marks: description.marks, marked: description.visible.filter(v => v.mark) })
            for (const lens of lenses) {
              overlays = frameForLens(context, lens, options)
              // The sheet is composed on DOM canvases, so without a DOM the
              // world is still stepped and the camera still borrowed and put
              // back — there is simply no picture at the end of it.
              if (!composes) { revealOverlays(overlays); overlays = []; continue }
              const cell = cellForLens(context, lens, description, options, overlays)
              overlays = cell.overlays
              cells.push({ label: `${lens} +${step} steps`, image: cell.cell })
            }
          }
        } finally {
          revealOverlays(overlays)
          if (borrowsCamera) Object.assign(view, kept)
          delete view.borrowedBy
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
      label: 'Frame and sidecar',
      run: (context, options = {}) => capture(context, options)
    }
  ]
}
