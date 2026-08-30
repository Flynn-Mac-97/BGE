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
 * Every image carries numbered marks and a JSON sidecar mapping mark to
 * entity id — a vision model grounds reliably against marks, and everything
 * computable is in the sidecar, never asked of vision. A `__files` reply is
 * written to disk by the CLI. Frames are named by level name and a frame
 * number, never by a clock.
 */
import { sketchPixels, sketchOnCanvas, writeFrameFiles, composeSheet, browserFiles } from '../../engine/frame-sketch.js'
import { describe } from './see/describe.js'
import { resolveView, view } from './see/views.js'
import { occlusion, isolate, find, diff, camera } from './see/queries.js'

let frameNumber = 0

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

  const spawned = context.spawn(wanted, { at: [0, 2, 0] })
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
      camera: () => camera(context)
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
      label: 'Save, list, or drop a named camera — a view worth returning to is a word',
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
      id: 'see.sketch',
      label: 'A flat-colour frame with numbered marks, drawn without a renderer',
      run: async (context, options = {}) => {
        options = await resolveView(context, options)
        if (options.error) return { error: options.error }
        return withSubject(context, options, async options => {
        const name = options.name || `${context.editor.levelName}-sketch-${++frameNumber}`
        // In the browser a 2D canvas encodes the PNG itself — no zlib, and
        // the caller gets a dataUrl it can show without touching disk.
        if (typeof document !== 'undefined') {
          const drawn = sketchOnCanvas(describe(context, options), options)
          if (drawn.error) return drawn
          return {
            dataUrl: drawn.dataUrl,
            __files: browserFiles(name, drawn.dataUrl.split(',')[1], drawn.description),
            marks: Object.fromEntries(drawn.description.visible.filter(v => v.mark).map(v => [v.mark, v.id])),
            counts: drawn.description.counts
          }
        }
        const drawn = sketchPixels(describe(context, options), options)
        if (drawn.error) return drawn
        const { encodePng } = await import(/* @vite-ignore */ '../../tools/lib/texture.mjs')
        const png = encodePng(drawn.width, drawn.height, drawn.pixels)
        return { ...(await writeFrameFiles(name, png, drawn.description)), counts: drawn.description.counts }
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
        if (typeof document === 'undefined' || !context.renderer || !context.shell?.canvas) {
          return { why: 'a moment sheet needs the browser renderer — headless, use script with simulate and see.sketch' }
        }
        options = await resolveView(context, options)
        if (options.error) return { error: options.error }
        const steps = options.steps || [0, 6, 30]
        const lenses = options.lenses || ['render', 'types']
        if (!context.loop.running && !context.world.simulated) {
          context.world.simulated = true
          for (const entity of [...context.world.entities]) context.world.hook(entity, 'start', context)
        }
        const cells = []
        const moments = []
        let advanced = 0
        for (const step of [...steps].sort((a, b) => a - b)) {
          if (step > advanced) { context.loop.step(step - advanced); advanced = step }
          const description = describe(context, options)
          moments.push({ afterSteps: step, counts: description.counts, marked: description.visible.filter(v => v.mark) })
          for (const lens of lenses) {
            const cell = document.createElement('canvas')
            const drawn = lens === 'types' && sketchOnCanvas(description, options)
            cell.width = drawn ? drawn.canvas.width : Math.round(context.viewport.width / 2)
            cell.height = drawn ? drawn.canvas.height : Math.round(context.viewport.height / 2)
            const pen = cell.getContext('2d')
            if (drawn) pen.drawImage(drawn.canvas, 0, 0)
            else {
              context.renderer.sync(context.world)
              context.renderer.draw()
              pen.drawImage(context.shell.canvas, 0, 0, cell.width, cell.height)
            }
            cells.push({ label: `${lens} +${step} steps`, image: cell })
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
      label: 'The real rendered frame, with numbered marks and a JSON sidecar',
      run: async (context, options = {}) => {
        if (typeof document === 'undefined' || !context.renderer || !context.shell?.canvas) {
          return { why: 'a capture needs the browser renderer — use see.sketch headless, or open the editor' }
        }
        options = await resolveView(context, options)
        if (options.error) return { error: options.error }
        return withSubject(context, options, async options => {
        const description = describe(context, options)
        if (description.error) return description

        const view = context.view
        const kept = { x: view.x, y: view.y, z: view.z, yaw: view.yaw, pitch: view.pitch, fov: view.fov, mode: view.mode, zoom: view.zoom }
        const wants = { ...(options.camera || {}) }
        if (options.subject) Object.assign(wants, description.camera, options.camera || {})
        const moved = Object.keys(wants).length > 0
        if (moved) Object.assign(view, wants, wants.mode ? {} : { mode: 'perspective' })

        // A declared model may still be downloading — a preview spawned a
        // moment ago always is — and drawing now captures the placeholder box.
        const subjectEntity = options.subject && context.world.byId(options.subject)
        const declaredModel = subjectEntity && (subjectEntity.mesh || subjectEntity._definition?.mesh)?.model
        for (let waited = 0; waited < 40 && declaredModel
          && context.renderer.modelState?.(declaredModel) !== 'ready'
          && context.renderer.modelState?.(declaredModel) !== 'failed'; waited++) {
          context.renderer.sync(context.world)
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        // `alone` must be true of the pixels, not only of the description:
        // everything but the subject is hidden, and the scene's own grade —
        // its lights, fog, sky — is swapped for a neutral studio, because a
        // model judged under a dusk key is a judgement of the dusk. Restored
        // below, whole.
        const concealed = []
        let studio = null
        if (options.alone && subjectEntity) {
          for (const other of context.world.entities) {
            if (other === subjectEntity || other.hidden) continue
            other.hidden = true
            concealed.push(other)
          }
          const THREE = await import('three')
          const scene = context.renderer.scene
          studio = { scene, background: scene.background, fog: scene.fog, dimmed: [] }
          scene.fog = null
          scene.background = new THREE.Color('#8b8f96')
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

        // An alone frame crops to the subject plus a margin: the point of the
        // image is the model, and every empty pixel costs the reader tokens.
        const canvas = context.shell.canvas
        let crop = null
        const entry = studio && description.visible.find(seen => seen.id === subjectEntity.id)
        if (entry) {
          const margin = 0.35
          const w = Math.min(canvas.width, entry.size[0] / 100 * canvas.width * (1 + margin * 2))
          const h = Math.min(canvas.height, entry.size[1] / 100 * canvas.height * (1 + margin * 2))
          crop = {
            w: Math.max(64, Math.round(w)),
            h: Math.max(64, Math.round(h))
          }
          crop.x = Math.max(0, Math.min(canvas.width - crop.w, Math.round(entry.at[0] / 100 * canvas.width - crop.w / 2)))
          crop.y = Math.max(0, Math.min(canvas.height - crop.h, Math.round(entry.at[1] / 100 * canvas.height - crop.h / 2)))
        }
        const copy = document.createElement('canvas')
        copy.width = crop ? crop.w : canvas.width
        copy.height = crop ? crop.h : canvas.height
        const pen = copy.getContext('2d')
        if (crop) pen.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)
        else pen.drawImage(canvas, 0, 0)

        for (const other of concealed) other.hidden = false
        if (studio) {
          studio.scene.remove(studio.rig)
          studio.scene.background = studio.background
          studio.scene.fog = studio.fog
          for (const child of studio.dimmed) child.visible = true
        }
        if (moved) Object.assign(view, kept)
        if (moved || concealed.length) {
          context.renderer.sync(context.world)
          context.renderer.draw()
        }

        // A frame of nothing must never come back labelled as a frame. Sample
        // a grid of pixels; if every one is fully transparent the readback
        // failed, and the honest answer says so instead of shipping marks
        // floating on a blank.
        const sampled = pen.getImageData(0, 0, copy.width, copy.height).data
        let anything = false
        const stride = Math.max(4, Math.floor(sampled.length / 4 / 400) * 4)
        for (let at = 3; at < sampled.length; at += stride) {
          if (sampled[at] > 0) { anything = true; break }
        }
        if (!anything) {
          return {
            error: 'the canvas read back empty — the answering tab is not drawing (hidden, throttled, or stale). Focus one editor tab and close the others.',
            hidden: document.hidden === true
          }
        }

        // Exposure is arithmetic, not judgement: mean brightness of a 4x4
        // grid of the frame, 0-100, so "too dark to read" is a number in the
        // sidecar before anyone spends a vision read on it.
        const cells = []
        const cellW = Math.floor(copy.width / 4), cellH = Math.floor(copy.height / 4)
        for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
          let sum = 0, seen = 0
          for (let y = gy * cellH; y < (gy + 1) * cellH; y += 8) {
            for (let x = gx * cellW; x < (gx + 1) * cellW; x += 8) {
              const at = (y * copy.width + x) * 4
              sum += 0.2126 * sampled[at] + 0.7152 * sampled[at + 1] + 0.0722 * sampled[at + 2]
              seen++
            }
          }
          cells.push(Math.round(sum / Math.max(1, seen) / 2.55))
        }
        description.light = {
          mean: Math.round(cells.reduce((total, cell) => total + cell, 0) / cells.length),
          darkestCell: Math.min(...cells),
          brightestCell: Math.max(...cells),
          grid: cells
        }

        if (options.marks !== false && !crop) {
          const tag = Math.max(14, Math.round(copy.height / 45))
          pen.font = `bold ${tag}px system-ui, sans-serif`
          pen.textAlign = 'center'
          pen.textBaseline = 'middle'
          for (const entry of description.visible) {
            if (!entry.mark) continue
            const x = entry.at[0] / 100 * copy.width
            // Above the entity's top edge, in clear space, off the geometry.
            const y = Math.max(tag, (entry.at[1] - entry.size[1] / 2) / 100 * copy.height - tag * 0.8)
            const text = String(entry.mark)
            const w = pen.measureText(text).width + tag * 0.6
            pen.fillStyle = 'rgba(0, 0, 0, 0.82)'
            pen.fillRect(x - w / 2, y - tag * 0.62, w, tag * 1.24)
            pen.fillStyle = '#ffffff'
            pen.fillText(text, x, y)
          }
        }

        const name = options.name || `${context.editor.levelName}-${++frameNumber}`
        const base64 = copy.toDataURL('image/png').split(',')[1]
        const sidecar = typeof Buffer !== 'undefined'
          ? Buffer.from(JSON.stringify(description)).toString('base64')
          : btoa(unescape(encodeURIComponent(JSON.stringify(description))))
        return {
          __files: [
            { path: `agent-runs/see/${name}.png`, base64 },
            { path: `agent-runs/see/${name}.json`, base64: sidecar }
          ],
          marks: Object.fromEntries(description.visible.filter(v => v.mark).map(v => [v.mark, v.id])),
          counts: description.counts
        }
        })
      }
    }
  ]
}

