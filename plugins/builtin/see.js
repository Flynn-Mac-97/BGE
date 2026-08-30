/**
 * See — frames and frame facts for an agent, from any camera.
 *
 * An agent working headless has no eyes, and an agent with a browser pays
 * vision tokens for every look. This plugin answers visual questions in the
 * cheapest form that answers them:
 *
 *   see.describe  computed facts, no pixels. Works everywhere, costs nothing.
 *   see.sketch    a flat-colour frame drawn from those facts. Works everywhere.
 *   see.capture   the real rendered frame. Browser only.
 *
 * Every image carries numbered marks and a JSON sidecar mapping mark to
 * entity id — a vision model grounds reliably against marks, and everything
 * computable is in the sidecar, never asked of vision. A `__files` reply is
 * written to disk by the CLI. Frames are named by level name and a frame
 * number, never by a clock.
 */
import { makeProjector } from '../../engine/camera-project.js'
import { boundsOf, frameSubject, facingOffset, boxesTouch } from '../../engine/frame-facts.js'
import { sketchPixels, sketchOnCanvas, writeFrameFiles, composeSheet, browserFiles } from '../../engine/frame-sketch.js'

/** Marks past this are noise: tags start overlapping and reads degrade. */
const MOST_MARKS = 40

let frameNumber = 0

function describe(context, options = {}) {
  const view = { ...context.view, ...(options.camera || {}) }
  let subject = null
  if (options.subject) {
    subject = context.world.byId(options.subject)
    if (!subject) return { error: `no entity "${options.subject}"` }
    Object.assign(view, frameSubject(subject, boundsOf(subject)), options.camera || {})
    if (view.mode === 'third-person-still') view.mode = 'perspective'
  }
  const projector = makeProjector(view, context.viewport)

  const visible = []
  const offscreenByType = {}
  for (const entity of context.world.entities) {
    if (entity.hidden && !options.includeHidden) continue
    if (subject && options.alone && entity.id !== subject.id) continue
    const point = projector.place(entity.x, entity.y, entity.z || 0)
    const bounds = boundsOf(entity)
    // A tilted camera sees a mix of an entity's height and its footprint: at
    // straight-down pitch the length IS the on-screen height.
    const tilt = projector.mode === 'ortho' ? 0 : Math.abs(view.pitch || 0)
    const seenHeight = bounds.h * Math.cos(tilt) + bounds.l * Math.sin(tilt)
    const size = projector.sizeAt(point.depth, bounds.w, seenHeight)
    const onScreen = point.inFront
      && point.x > -size.w / 2 && point.x < 100 + size.w / 2
      && point.y > -size.h / 2 && point.y < 100 + size.h / 2
    if (!onScreen) {
      offscreenByType[entity.type] = (offscreenByType[entity.type] || 0) + 1
      continue
    }
    visible.push({
      id: entity.id, type: entity.type,
      at: [round(point.x), round(point.y)],
      size: [round(size.w), round(size.h)],
      depth: round(point.depth),
      _world: { x: entity.x, y: entity.y, z: entity.z || 0, ...bounds }
    })
  }

  // Marks go to the largest on screen first — the ones a vision read is about.
  // In a subject shot the question is about the subject, so nearer wins over
  // larger and the horizon does not spend the tags. A thing wider than half
  // the frame is a backdrop, not a subject: it gets no mark. Two tags closer
  // than a tag's own width just cover each other, so a mark also needs clear
  // screen distance from every mark already given.
  visible.sort(subject
    ? (a, b) => a.depth - b.depth
    : (a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1])
  const subjectEntry = subject && visible.find(entry => entry.id === subject.id)
  const subjectDepth = subjectEntry?.depth
  const marked = []
  // The subject of a subject shot is always mark 1 — the question is about it.
  if (subjectEntry) { subjectEntry.mark = marked.push(subjectEntry) }
  for (const entry of visible) {
    if (entry === subjectEntry) continue
    if (entry.size[0] > 50 || entry.size[1] > 50) continue
    // In a subject shot the horizon is context, not content — no tags out there.
    if (subjectDepth && entry.depth > subjectDepth * 8) continue
    if (marked.length >= MOST_MARKS) break
    if (marked.some(other =>
      Math.abs(other.at[0] - entry.at[0]) < 4 && Math.abs(other.at[1] - entry.at[1]) < 5)) continue
    entry.mark = marked.push(entry)
  }

  const coverage = {}
  for (const entry of visible) {
    coverage[entry.type] = round((coverage[entry.type] || 0)
      + Math.min(100, entry.size[0]) * Math.min(100, entry.size[1]) / 100)
  }

  // Whether two bodies interpenetrate is a fact about world boxes, not a
  // judgement — answered here so nobody asks a vision model to eyeball it.
  // Marked entities only: that is what a question names, and it bounds the
  // pair count. `occlusions` is the screen version: whose tag sits on a thing
  // that is actually behind another — [nearer, farther] pairs.
  const overlaps = []
  const occlusions = []
  for (let a = 0; a < marked.length; a++) {
    for (let b = a + 1; b < marked.length; b++) {
      if (boxesTouch(marked[a]._world, marked[b]._world)) {
        overlaps.push([marked[a].id, marked[b].id])
      }
      const near = marked[a].depth <= marked[b].depth ? marked[a] : marked[b]
      const far = near === marked[a] ? marked[b] : marked[a]
      if (far.depth - near.depth > 0.5
        && Math.abs(near.at[0] - far.at[0]) < (near.size[0] + far.size[0]) / 2
        && Math.abs(near.at[1] - far.at[1]) < (near.size[1] + far.size[1]) / 2) {
        occlusions.push([near.id, far.id])
      }
    }
  }

  // Where things are, in the words a question uses: a 3x3 grid of counts by
  // type, so "the enemies are all top-left" is read, not judged.
  const regions = {}
  for (const entry of visible) {
    const column = entry.at[0] < 33.3 ? 'left' : entry.at[0] < 66.6 ? 'centre' : 'right'
    const row = entry.at[1] < 33.3 ? 'top' : entry.at[1] < 66.6 ? 'middle' : 'bottom'
    const cell = row === 'middle' && column === 'centre' ? 'centre' : `${row}-${column}`
    regions[cell] = regions[cell] || {}
    regions[cell][entry.type] = (regions[cell][entry.type] || 0) + 1
  }

  // How much of a marked thing is actually inside the frame. Only said when
  // it is cut, so an uncut frame costs nothing extra to read.
  for (const entry of marked) {
    const clippedW = Math.min(100, entry.at[0] + entry.size[0] / 2) - Math.max(0, entry.at[0] - entry.size[0] / 2)
    const clippedH = Math.min(100, entry.at[1] + entry.size[1] / 2) - Math.max(0, entry.at[1] - entry.size[1] / 2)
    const shown = Math.max(0, clippedW) * Math.max(0, clippedH) / (entry.size[0] * entry.size[1] || 1)
    if (shown < 0.999) entry.cut = round(shown * 100)
  }

  // The other computable pair questions: how far apart two named things are,
  // where each sits on screen relative to the other, and whether either is
  // facing the other — every one a relation vision models measurably get
  // wrong, and every one arithmetic.
  let between = null
  if (Array.isArray(options.between) && options.between.length === 2) {
    const [first, second] = options.between.map(id => context.world.byId(id))
    if (first && second) {
      const pointA = projector.place(first.x, first.y, first.z || 0)
      const pointB = projector.place(second.x, second.y, second.z || 0)
      between = {
        ids: options.between,
        distance: round(Math.hypot(first.x - second.x, first.y - second.y, (first.z || 0) - (second.z || 0))),
        touching: boxesTouch(
          { x: first.x, y: first.y, z: first.z || 0, ...boundsOf(first) },
          { x: second.x, y: second.y, z: second.z || 0, ...boundsOf(second) }),
        onScreen: `${options.between[0]} is `
          + `${pointA.x < pointB.x ? 'left of' : 'right of'} and `
          + `${pointA.y < pointB.y ? 'above' : 'below'} ${options.between[1]}`
          + `, ${round(Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y))}% apart`,
        facing: {
          [options.between[0]]: facingOffset(first, second),
          [options.between[1]]: facingOffset(second, first)
        }
      }
    } else between = { ids: options.between, error: 'one of the two ids does not exist' }
  }

  for (const entry of visible) delete entry._world

  return {
    camera: {
      mode: projector.mode, x: round(view.x), y: round(view.y), z: round(view.z || 0),
      yaw: round(view.yaw || 0), pitch: round(view.pitch || 0),
      ...(projector.mode === 'ortho' ? { zoom: view.zoom } : { fov: view.fov || 90 })
    },
    viewport: { ...context.viewport },
    visible,
    counts: {
      visible: visible.length,
      offscreen: Object.values(offscreenByType).reduce((sum, n) => sum + n, 0),
      offscreenByType
    },
    /** Percent of the screen each type's boxes cover, before overlap. */
    coverage,
    /** Marked pairs whose world boxes interpenetrate — computed, not seen. */
    overlaps,
    /** [nearer, farther] marked pairs whose screen boxes cross — who hides whom. */
    occlusions,
    /** Counts by type in a 3x3 screen grid, named in words. */
    regions,
    ...(between ? { between } : {})
  }
}

export default {
  name: 'See',
  about: 'Frames and frame facts from any camera — computed facts first, pixels only when pixels are the question.',
  inspect: () => [{ title: 'See', rows: [['frames taken', frameNumber]] }],

  onLoad(context) {
    context.see = {
      describe: options => describe(context, options),
      sketch: options => sketchPixels(describe(context, options), options)
    }
  },

  commands: [
    {
      id: 'see.describe',
      label: 'What is on screen, as computed facts — no pixels, no vision read',
      run: (context, options) => describe(context, options || {})
    },
    {
      id: 'see.sketch',
      label: 'A flat-colour frame with numbered marks, drawn without a renderer',
      run: async (context, options = {}) => {
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
      run: (context, options = {}) => {
        if (typeof document === 'undefined' || !context.renderer || !context.shell?.canvas) {
          return { why: 'a capture needs the browser renderer — use see.sketch headless, or open the editor' }
        }
        const description = describe(context, options)
        if (description.error) return description

        const view = context.view
        const kept = { x: view.x, y: view.y, z: view.z, yaw: view.yaw, pitch: view.pitch, fov: view.fov, mode: view.mode, zoom: view.zoom }
        const wants = { ...(options.camera || {}) }
        if (options.subject) Object.assign(wants, description.camera, options.camera || {})
        const moved = Object.keys(wants).length > 0
        if (moved) Object.assign(view, wants, wants.mode ? {} : { mode: 'perspective' })
        // Always drawn fresh, never copied as-is: a hidden or throttled tab
        // stops painting, and its stale canvas reads back as nothing.
        context.renderer.sync(context.world)
        context.renderer.draw()

        const canvas = context.shell.canvas
        const copy = document.createElement('canvas')
        copy.width = canvas.width
        copy.height = canvas.height
        const pen = copy.getContext('2d')
        pen.drawImage(canvas, 0, 0)

        if (moved) {
          Object.assign(view, kept)
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

        if (options.marks !== false) {
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
      }
    }
  ]
}

const round = n => Math.round(n * 100) / 100
