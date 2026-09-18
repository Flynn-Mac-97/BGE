import { freeFrameName, frameWritten, bindMarks } from './frame-context.js'

export function captureProfile({ stated, sized, windowShape }, copy, crop) {
  const shape = sized || [Math.round(windowShape.w), Math.round(windowShape.h)]
  return {
    width: shape[0],
    height: shape[1],
    orientation: shape[1] > shape[0] ? 'portrait' : 'landscape',
    from: stated ? 'the size given' : sized ? 'game.json device' : 'the window',
    frame: [copy.width, copy.height],
    // A cropped image has no single pixel ratio to the original viewport.
    ...(crop
      ? { cropped: true }
      : { pixelRatio: Math.round(copy.width / Math.max(1, shape[0]) * 100) / 100 })
  }
}

export async function captureReply(context, options, description, image, framing, stretched, subjectEntity) {
  const { copy, crop } = image
  const callerNamed = Boolean(options.file || options.name)
  const target = options.file
    ? String(options.file).replace(/^\.\//, '')
    : `agent-runs/see/${options.name || await freeFrameName(context, '')}.png`
  if (!target.startsWith('agent-runs/') || !target.endsWith('.png')) {
    throw new Error(`file must be a .png path under agent-runs/, not "${target}"`)
  }
  const replaced = callerNamed && await frameWritten(target) ? target : null
  const sidecarFile = target.replace(/\.png$/, '.json')
  const base64 = copy.toDataURL('image/png').split(',')[1]
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
}
