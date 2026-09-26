import { simplifyHull } from './describe.js'
import { drawRig } from './rig-marks.js'

export async function traceMarks(context, description) {
  try {
    const { silhouettes } = await import(/* @vite-ignore */ './id-buffer.js')
    const traced = await silhouettes(context, description.visible.filter(v => v.mark).map(v => v.id))
    for (const entry of description.visible) {
      if (!entry.mark || !(traced?.[entry.id]?.length >= 3)) continue
      const simplified = simplifyHull(traced[entry.id], Math.max(entry.size[0], entry.size[1]))
      if (simplified) entry.hull = simplified
    }
  } catch {
    // Keep projected box hulls when the renderer cannot supply silhouettes.
  }
}

export function annotateCapture(copy, pen, description, options, crop, silhouette) {
  // The rig is in screen points of the whole frame, so it is drawn only on a frame that is not cropped.
  if (description.rigs?.length && !crop) drawRig(copy, pen, description.rigs)
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

  if (crop) {
    // Studio images must not bias judgement with outlines or authored prose.
    delete description.palette
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
}
