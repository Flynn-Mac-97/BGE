/**
 * See: what a body wears, where it is on screen. Each attachment on the
 * subject (a model hung on a bone, such as a worn item): `hang`, its hang
 * point, and `middle`, the middle of the drawn item, both percent of the
 * frame like every other See fact; and `pointer`, the viewport pixel
 * `input.point` takes to press on the item. The middle and the pointer need
 * the renderer; with none, the pointer is the hang point, which may be on
 * the item's edge. A point behind the camera is null. Needs Rig Animation to
 * pose the bone.
 */
import { makeProjector } from '../../../engine/camera-project.js'

const round = value => Math.round(value * 10) / 10

/** The subject's attachments and where each is on screen now. */
export function worn(context, options) {
  if (!options.subject) return { error: 'see.worn needs a subject: {"subject":"<entity id>"}' }
  const entity = context.world.byId(options.subject)
  if (!entity) return { error: `no entity "${options.subject}"` }
  if (!context.rigAnimation?.worldPointOf) return { error: 'see.worn needs Rig Animation, which poses the bones items hang on' }
  const viewport = context.viewport
  const projector = makeProjector(context.view, viewport)
  const onScreen = point => {
    const placed = point && projector.place(point[0], point[1], point[2])
    return placed?.inFront ? [round(placed.x), round(placed.y)] : null
  }
  const pixelOf = at => (at ? [Math.round((at[0] / 100) * viewport.width), Math.round((at[1] / 100) * viewport.height)] : null)
  const worn = Object.entries(entity.attachments ?? {}).map(([name, attachment]) => {
    const hang = onScreen(context.rigAnimation.worldPointOf(entity, { node: attachment.node, at: attachment.position ?? [0, 0, 0] }))
    const middle = onScreen(context.renderer?.attachmentMiddle?.(entity, name) ?? null)
    return { name, model: attachment.model, node: attachment.node, hang, middle, pointer: pixelOf(middle ?? hang) }
  })
  return { subject: entity.id, viewport: [Math.round(viewport.width), Math.round(viewport.height)], worn }
}
