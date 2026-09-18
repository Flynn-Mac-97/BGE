import { describe } from './describe.js'

let frameNumber = 0

function clientName() {
  if (typeof location === 'undefined') return null
  const asked = new URLSearchParams(location.search).get('client')
  const name = asked || readSessionValue('engine:tab-id')
  return name ? String(name).replace(/[^a-z0-9_-]+/gi, '-') : null
}

function readSessionValue(key) {
  try { return sessionStorage.getItem(key) } catch { return null }
}

export async function frameWritten(path) {
  if (typeof fetch !== 'function' || typeof location === 'undefined') return false
  try {
    const answer = await fetch('/' + encodeURI(path), { method: 'HEAD', cache: 'no-store' })
    return (answer.headers.get('content-type') || '').startsWith('image/png')
  } catch {
    return false
  }
}

export async function freeFrameName(context, kind) {
  const stem = [context.editor.levelName, clientName(), kind].filter(Boolean).join('-')
  let name = `${stem}-${++frameNumber}`
  for (let tries = 0; tries < 50 && await frameWritten(`agent-runs/see/${name}.png`); tries++) {
    name = `${stem}-${++frameNumber}`
  }
  return name
}

export function declaredShape(context) {
  const device = context.device
  return device?.width > 0 && device?.height > 0 ? [device.width, device.height] : null
}

export function describeAtDeclaredShape(context, options) {
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

export function concealOverlays(context) {
  const hidden = []
  for (const child of context.renderer?.scene?.children || []) {
    if (child.userData?.overlay && child.visible) {
      child.visible = false
      hidden.push(child)
    }
  }
  return hidden
}

export function revealOverlays(hidden) {
  for (const child of hidden) child.visible = true
}

export function needsRenderer(context, verb, instead) {
  const missing = []
  if (!context.renderer) missing.push('no context.renderer')
  if (!context.shell?.canvas) missing.push('no context.shell.canvas')
  if (!canMakeCanvas(context)) missing.push('no way to make a canvas — no DOM and no renderer.createCanvas')
  if (!missing.length) return null
  return { why: `${verb} draws through a renderer: ${missing.join(', ')}.`, missing, instead }
}

const canMakeCanvas = context =>
  typeof document !== 'undefined' || typeof context.renderer?.createCanvas === 'function'

export function makeCanvas(context, width, height) {
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : context.renderer.createCanvas(width, height)
  canvas.width = width
  canvas.height = height
  return canvas
}

export const tabHidden = () => typeof document !== 'undefined' && document.hidden === true

export const blankFrameReason = context => context.renderer?.blank
  ? 'this world has the renderer surface with nothing behind it, so every frame is blank. '
    + 'Use see.sketch for a frame headless, or capture through a browser.'
  : 'the answering tab is not drawing (hidden, throttled, or stale). Focus one editor tab and close the others.'

const REPRESENTATIVE_SHARE = 0.05

const ENOUGH_TO_JUDGE = 20

export function unrepresentativeFrame(description, options) {
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

export const keepView = view => ({
  x: view.x, y: view.y, z: view.z, yaw: view.yaw, pitch: view.pitch,
  fov: view.fov, mode: view.mode, zoom: view.zoom
})

export function bindMarks(description) {
  description.marks = Object.fromEntries((description.visible || [])
    .filter(entry => entry.mark)
    .map(entry => [entry.mark, entry.id]))
  return description.marks
}

export async function withSubject(context, options, run) {
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

  const previewId = `see-preview-${wanted}`
  // A preview must not consume the id counter used by a seeded game run.
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


export const framesTaken = () => frameNumber
