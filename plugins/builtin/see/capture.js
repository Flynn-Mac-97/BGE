import { describe } from './describe.js'
import { resolveView } from './views.js'
import { declaredShape, keepView, needsRenderer, withSubject, concealOverlays, unrepresentativeFrame, blankFrameReason, tabHidden } from './frame-context.js'
import { drawStudioImage, drawSceneImage } from './capture-images.js'
import { measureLight, hasPixels } from './capture-pixels.js'
import { traceMarks, annotateCapture } from './capture-marks.js'
import { waitForModel, prepareStudio, hideStudioBackground, restoreCapture } from './capture-state.js'
import { captureReply, captureProfile } from './capture-reply.js'

export async function capture(context, options = {}) {
  const missing = needsRenderer(context, 'a capture',
    'headless, see.sketch takes the same options and draws a flat-colour frame from the same '
    + 'computed facts, with no renderer — real art and lighting need the browser.')
  if (missing) return missing
  options = await resolveView(context, options)
  if (options.error) return { error: options.error }
  return withSubject(context, options, resolved => captureSubject(context, resolved))
}

async function captureSubject(context, options) {
  let description = describe(context, options)
  if (description.error) return description
  const settings = captureSettings(context, options)
  if (settings.error) return settings
  const { sized, stretched } = settings

  const view = context.view
  const kept = keepView(view)
  const wants = { ...(options.camera || {}) }
  if (options.subject) Object.assign(wants, description.camera, options.camera || {})
  const moved = Object.keys(wants).length > 0
  const subjectEntity = options.subject && context.world.byId(options.subject)

  const state = { sized, moved, kept, concealed: [], overlays: [], studio: null }
  let studio = null
  let copy, pen, crop = null, silhouette = null
  // All scene changes stay within this restoration boundary.
  try {
    if (moved) Object.assign(view, wants, wants.mode ? {} : { mode: 'perspective' })
    if (moved) view.borrowedBy = 'see.capture'
    if (sized) {
      context.renderer.frameSize(sized[0], sized[1])
      description = describe(context, options)
    }

    await waitForModel(context, subjectEntity)

    if (options.alone && subjectEntity) {
      await prepareStudio(context, subjectEntity, state)
      studio = state.studio
    }

    context.renderer.sync(context.world)
    if (options.ui === false) state.overlays = concealOverlays(context)
    if (studio) hideStudioBackground(studio, subjectEntity)
    context.renderer.draw()

    const image = studio
      ? await drawStudioImage(context, options, studio, subjectEntity)
      : drawSceneImage(context, options, stretched)
    if (image.error) return image
    ;({ copy, pen, crop, silhouette } = image)

    if (options.marks !== false && !crop && !studio) {
      await traceMarks(context, description)
    }
  } finally {
    restoreCapture(context, state)
  }

  const framing = unrepresentativeFrame(description, options)
  const pixels = pen.getImageData(0, 0, copy.width, copy.height).data
  if (!hasPixels(pixels)) {
    return {
      error: `the canvas read back empty — ${blankFrameReason(context)}`,
      blank: true,
      hidden: tabHidden(),
      ...(framing ? { framing } : {})
    }
  }

  description.light = measureLight(pixels, copy.width, copy.height)
  description.profile = captureProfile(settings, copy, crop)
  if (framing) description.framing = framing
  annotateCapture(copy, pen, description, options, crop, silhouette)
  return captureReply(context, options, description, { copy, crop }, framing, stretched, subjectEntity)
}

function captureSettings(context, options) {
  const stated = Array.isArray(options.size) && options.size.length === 2
    ? options.size.map(Number).filter(side => Number.isFinite(side) && side > 0)
    : null
  if (options.size && stated?.length !== 2) {
    return { error: `size is [width, height] in pixels, for example {"size":[540,960]}` }
  }
  const sized = stated || declaredShape(context)
  const windowShape = context.renderer.size
  const stretched = !!sized
    && (sized[0] !== Math.round(windowShape.w) || sized[1] !== Math.round(windowShape.h))

  return { stated, sized, windowShape, stretched }
}
