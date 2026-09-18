import { makeCanvas, blankFrameReason } from './frame-context.js'
import { studioBounds, studioSilhouette, cropPixels, encodeColours } from './capture-pixels.js'

export async function drawStudioImage(context, options, studio, subjectEntity) {
  const canvas = context.shell.canvas
  let copy, pen, crop, silhouette
  const target = new studio.THREE.WebGLRenderTarget(canvas.width, canvas.height)
  const raw = new Uint8Array(canvas.width * canvas.height * 4)
  try {
    await context.renderer.drawInto(target, raw)
  } finally {
    target.dispose()
  }

  const { left, right, top, bottom, spans } = studioBounds(raw, canvas)
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

  silhouette = studioSilhouette(spans, crop)

  copy = makeCanvas(context, crop.w, crop.h)
  pen = copy.getContext('2d')
  const image = pen.createImageData(crop.w, crop.h)
  cropPixels(raw, canvas, crop, image)
  encodeColours(image)
  if (options.background && options.background !== 'alpha') {
    const flat = makeCanvas(context, crop.w, crop.h)
    flat.getContext('2d').putImageData(image, 0, 0)
    pen.fillStyle = options.background
    pen.fillRect(0, 0, crop.w, crop.h)
    pen.drawImage(flat, 0, 0)
  } else {
    pen.putImageData(image, 0, 0)
  }
  return { copy, pen, crop, silhouette }
}

export function drawSceneImage(context, options, stretched) {
  const canvas = context.shell.canvas
  let copy, pen
  copy = makeCanvas(context, canvas.width, canvas.height)
  pen = copy.getContext('2d')
  pen.drawImage(canvas, 0, 0)
  if (options.ui !== false && (!stretched || options.ui === true) && typeof document !== 'undefined') {
    if (document.hidden) {
      throw new Error(
        'this tab is hidden, so the HUD and screen layers hold a stale picture. '
        + 'Bring the tab to the front, or pass {"ui":false} to capture the world alone.')
    }
    for (const layer of document.querySelectorAll('canvas.hud-layer, canvas.screen-layer')) {
      if (layer.width && layer.height) pen.drawImage(layer, 0, 0, copy.width, copy.height)
    }
  }
  return { copy, pen, crop: null, silhouette: null }
}
