/**
 * See — frames and frame facts for an agent, from any camera.
 *
 * An agent working headless has no eyes, and an agent with a browser pays
 * vision tokens for every look. This plugin answers visual questions in the
 * cheapest form that answers them:
 *
 *   see.describe  computed facts, no pixels. Works everywhere, costs nothing.
 *   see.sketch    a flat-colour frame drawn from those facts. Node only.
 *   see.capture   the real rendered frame. Browser only.
 *
 * Both image forms carry numbered marks and a JSON sidecar mapping mark
 * number to entity id, because a vision model grounds far better against
 * marks than against descriptions, and its answer comes back in numbers the
 * engine can map to entities. Counts, positions, sizes and coverage are
 * always in the sidecar — computed, never asked of vision.
 *
 * A returned `__files` list is written to disk by the CLI, so one command
 * answers with file paths from either world. Deterministic: frames are named
 * by level name and a frame number, never by a clock.
 */
import { makeProjector } from '../../engine/camera-project.js'

/** Marks past this are noise: tags start overlapping and reads degrade. */
const MOST_MARKS = 40

let frameNumber = 0

/** The drawn extents of an entity, in world units: width, height, length. */
function boundsOf(entity) {
  const mesh = entity.mesh || entity._definition?.mesh
  if (mesh?.box) return { w: mesh.box[0], h: mesh.box[1], l: mesh.box[2] || 0 }
  if (Array.isArray(mesh?.parts)) {
    let w = 0, h = 0, l = 0
    for (const part of mesh.parts) {
      if (!part.box) continue
      w = Math.max(w, Math.abs(part.at?.[0] || 0) * 2 + part.box[0])
      h = Math.max(h, (part.at?.[1] || 0) + part.box[1])
      l = Math.max(l, Math.abs(part.at?.[2] || 0) * 2 + (part.box[2] || 0))
    }
    if (w || h) return { w, h, l }
  }
  const sprite = entity.sprite || entity._definition?.sprite
  if (sprite?.width || sprite?.height) return { w: sprite.width || 1, h: sprite.height || 1, l: 0 }
  const collider = entity.collider || entity._definition?.collider
  if (collider?.box) return { w: collider.box[0], h: collider.box[1], l: collider.box[2] || 0 }
  if (collider?.circle) return { w: collider.circle * 2, h: collider.circle * 2, l: collider.circle * 2 }
  return { w: 1, h: 1, l: 1 }
}

/** A stable colour per type name, so two sketches of one world agree. */
function typeColour(name) {
  let hash = 0
  for (const character of String(name)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const bright = 0.45 + ((hash >>> 9) % 40) / 100
  const [r, g, b] = hueToRgb(hue, 0.65, bright)
  return [r, g, b, 255]
}

function hueToRgb(hue, saturation, lightness) {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const at = n => {
    const k = (n + hue / 30) % 12
    return Math.round((lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [at(0), at(8), at(4)]
}

/** A camera to look at one entity: pulled back along -Z, tipped down a third. */
function frameSubject(entity, bounds) {
  const distance = Math.max(2, Math.max(bounds.w, bounds.h) * 2.5)
  const pitch = -0.35
  return {
    mode: 'third-person-still',
    x: entity.x,
    y: entity.y + distance * Math.sin(-pitch),
    z: (entity.z || 0) + distance * Math.cos(-pitch),
    yaw: 0, pitch, fov: 50
  }
}

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
      && point.x > -size.w && point.x < 100 + size.w
      && point.y > -size.h && point.y < 100 + size.h
    if (!onScreen) {
      offscreenByType[entity.type] = (offscreenByType[entity.type] || 0) + 1
      continue
    }
    visible.push({
      id: entity.id, type: entity.type,
      at: [round(point.x), round(point.y)],
      size: [round(size.w), round(size.h)],
      depth: round(point.depth)
    })
  }

  // Marks go to the largest on screen first — the ones a vision read is about.
  // A thing wider than half the frame is a backdrop, not a subject: it gets no
  // mark, so tags stay on what a question would name.
  visible.sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1])
  let nextMark = 0
  for (const entry of visible) {
    if (entry.size[0] > 50 || entry.size[1] > 50) continue
    if (nextMark >= MOST_MARKS) break
    entry.mark = ++nextMark
  }

  const coverage = {}
  for (const entry of visible) {
    coverage[entry.type] = round((coverage[entry.type] || 0)
      + Math.min(100, entry.size[0]) * Math.min(100, entry.size[1]) / 100)
  }

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
    coverage
  }
}

/** 3x5 digit stamps for marks in a sketch, where there is no font. */
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111',
  '101101111001001', '111100111001111', '111100111101111', '111001010010010',
  '111101111101111', '111101111001111']

function sketch(context, options = {}) {
  const description = describe(context, options)
  if (description.error) return description
  const scale = 4
  const width = Math.round(description.viewport.width / scale)
  const height = Math.round(description.viewport.height / scale)
  const pixels = Buffer.alloc(width * height * 4)
  for (let at = 0; at < pixels.length; at += 4) pixels.set([32, 40, 48, 255], at)

  const paint = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    pixels.set(colour, (y * width + x) * 4)
  }

  // Painter's order: far first, so near covers far the way the renderer would.
  for (const entry of [...description.visible].sort((a, b) => b.depth - a.depth)) {
    const colour = typeColour(entry.type)
    const w = Math.max(1, Math.round(entry.size[0] / 100 * width))
    const h = Math.max(1, Math.round(entry.size[1] / 100 * height))
    const left = Math.round(entry.at[0] / 100 * width - w / 2)
    const top = Math.round(entry.at[1] / 100 * height - h / 2)
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) paint(x, y, colour)
  }

  if (options.marks !== false) {
    for (const entry of description.visible) {
      if (!entry.mark) continue
      const text = String(entry.mark)
      let left = Math.round(entry.at[0] / 100 * width - text.length * 2)
      const top = Math.round(entry.at[1] / 100 * height - 3)
      for (const digit of text) {
        const stamp = DIGITS[+digit]
        for (let y = -1; y < 6; y++) for (let x = -1; x < 4; x++) {
          const on = y >= 0 && y < 5 && x >= 0 && x < 3 && stamp[y * 3 + x] === '1'
          paint(left + x, top + y, on ? [255, 255, 255, 255] : [0, 0, 0, 255])
        }
        left += 4
      }
    }
  }
  return { description, width, height, pixels }
}

const asFiles = (name, pngBase64, description) => ({
  __files: [
    { path: `agent-runs/see/${name}.png`, base64: pngBase64 },
    { path: `agent-runs/see/${name}.json`, base64: Buffer.from(JSON.stringify(description)).toString('base64') }
  ],
  marks: Object.fromEntries((description.visible || []).filter(v => v.mark).map(v => [v.mark, v.id]))
})

export default {
  name: 'See',
  about: 'Frames and frame facts from any camera — computed facts first, pixels only when pixels are the question.',
  inspect: () => [{ title: 'See', rows: [['frames taken', frameNumber]] }],

  onLoad(context) {
    context.see = {
      describe: options => describe(context, options),
      sketch: options => sketch(context, options)
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
        if (typeof process === 'undefined' || !process.versions?.node) {
          return { why: 'a sketch is encoded with node zlib — run this headless, or use see.capture here' }
        }
        const drawn = sketch(context, options)
        if (drawn.error) return drawn
        const { encodePng } = await import(/* @vite-ignore */ '../../tools/lib/texture.mjs')
        const png = encodePng(drawn.width, drawn.height, drawn.pixels)
        const name = options.name || `${context.editor.levelName}-sketch-${++frameNumber}`
        return { ...asFiles(name, png.toString('base64'), drawn.description), counts: drawn.description.counts }
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
        if (moved) {
          Object.assign(view, wants, wants.mode ? {} : { mode: 'perspective' })
          context.renderer.sync(context.world)
          context.renderer.draw()
        }

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
