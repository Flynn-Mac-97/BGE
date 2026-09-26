/**
 * See: the control rig of a rigged body, as screen facts and as marks on a
 * frame. Asked for with `rig: true` on `see.describe` or `see.capture`.
 *
 * The rig comes from Rig Animation (`context.rigAnimation.rigOf`): the posed
 * bones, and each constraint solved this step. Screen points are percent of
 * the frame, like every other See fact; a point behind the camera is null.
 *
 * Drawn as: bones in white; a constraint's target as a ring in its kind's
 * colour, joined to where its bone is now; a pole as a diamond joined to the
 * joint it points; a planted foot's lock as a filled square. A ring's size
 * shows its weight.
 */

/** The colour of each constraint kind's marks. */
export const RIG_COLOURS = { reach: '#58e07a', lookAt: '#4cc9f0', plant: '#f4a340' }

/** The rig of the subject, or of every rigged body in view, as screen facts; empty when none has one. */
export function rigFacts(context, options, projector) {
  const rigOf = context.rigAnimation?.rigOf
  if (!rigOf) return []
  const bodies = options.subject ? [context.world.byId(options.subject)] : context.world.entities
  const onScreen = point => {
    if (!point) return null
    const placed = projector.place(point[0], point[1], point[2])
    return placed.inFront ? [round(placed.x), round(placed.y)] : null
  }
  return bodies
    .map(entity => ({ entity, rig: entity && rigOf(entity) }))
    .filter(({ rig }) => rig)
    .map(({ entity, rig }) => ({
      id: entity.id,
      bones: rig.bones.map(([from, end]) => [onScreen(from), onScreen(end)]).filter(([from, end]) => from && end),
      constraints: rig.constraints.map(shown => ({
        kind: shown.kind,
        weight: round(shown.weight ?? 0),
        end: onScreen(shown.end),
        target: onScreen(shown.target),
        ...(shown.joint ? { joint: onScreen(shown.joint), pole: onScreen(shown.pole) } : {})
      }))
    }))
}

/** Draw rig facts over a frame. */
export function drawRig(copy, pen, rigs) {
  const line = Math.max(1.5, copy.height / 400)
  const pixelsOf = point => [(point[0] / 100) * copy.width, (point[1] / 100) * copy.height]
  for (const rig of rigs) {
    pen.setLineDash([])
    pen.lineWidth = line
    pen.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    for (const [from, end] of rig.bones) segment(pen, pixelsOf(from), pixelsOf(end))
    for (const shown of rig.constraints) drawConstraint(pen, pixelsOf, shown, line)
  }
  pen.setLineDash([])
}

/** One constraint: its target ring or lock, the dashed line from its bone, and its pole. */
function drawConstraint(pen, pixelsOf, shown, line) {
  pen.strokeStyle = RIG_COLOURS[shown.kind] ?? '#ffffff'
  pen.fillStyle = pen.strokeStyle
  pen.lineWidth = line
  if (shown.target && shown.end) {
    pen.setLineDash([line * 3, line * 2])
    segment(pen, pixelsOf(shown.end), pixelsOf(shown.target))
    pen.setLineDash([])
    const [x, y] = pixelsOf(shown.target)
    const size = line * (3 + 4 * shown.weight)
    if (shown.kind === 'plant') pen.fillRect(x - size / 2, y - size / 2, size, size)
    else ring(pen, x, y, size)
  }
  if (shown.pole && shown.joint) {
    pen.setLineDash([line, line * 2])
    segment(pen, pixelsOf(shown.joint), pixelsOf(shown.pole))
    pen.setLineDash([])
    diamond(pen, ...pixelsOf(shown.pole), line * 4)
  }
}

function segment(pen, [fromX, fromY], [endX, endY]) {
  pen.beginPath()
  pen.moveTo(fromX, fromY)
  pen.lineTo(endX, endY)
  pen.stroke()
}

function ring(pen, x, y, radius) {
  pen.beginPath()
  pen.arc(x, y, radius, 0, Math.PI * 2)
  pen.stroke()
}

function diamond(pen, x, y, size) {
  pen.beginPath()
  pen.moveTo(x, y - size)
  pen.lineTo(x + size, y)
  pen.lineTo(x, y + size)
  pen.lineTo(x - size, y)
  pen.closePath()
  pen.stroke()
}

const round = value => Math.round(value * 10) / 10
