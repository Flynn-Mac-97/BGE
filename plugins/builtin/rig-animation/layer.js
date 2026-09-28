/**
 * Rig Animation: a layer — a second clip played on some nodes only, over the
 * base clip, faded in and out. See the Rig Animation header for the contract.
 */
import { framesAt, mixInto } from './sample.js'
import { clipFileOf, maskNodesOf } from './clip-names.js'

/**
 * Write one layer clip at `time` over the pose on `nodes`, `weight` of the
 * way. A node the clip also places (the hips) moves too, so a crouch in the
 * layer lowers the body and its feet stay on the floor.
 */
export function mixLayer(entity, clip, nodes, time, weight) {
  const { first, second, blend, isDone } = framesAt(clip, time)
  const sampled = [0, 0, 0, 1]
  for (const node of nodes) {
    const index = clip.nodes.indexOf(node)
    const into = entity.pose[node]
    if (index < 0 || !into) continue
    mixInto(sampled, clip.rotations[first], clip.rotations[second], index * 4, blend)
    mixInto(into, into, sampled, 0, weight)
    const places = clip.positions?.[node]
    if (!places || into.length < 7) continue
    for (let axis = 0; axis < 3; axis++) {
      const place = places[first][axis] + (places[second][axis] - places[first][axis]) * blend
      into[4 + axis] += (place - into[4 + axis]) * weight
    }
  }
  return isDone
}

/**
 * Play the entity's layer clip over the pose already written, on the layer's
 * mask nodes only, faded in and out.
 *
 * The layer is remembered past the moment game code lets it go, so it can fade
 * out from where it was rather than snapping back to the base clip. A layer
 * that replaces one still showing fades from where the old one was, held
 * still, rather than snapping to the new clip's first frame: a combo's
 * swings run on from each other.
 * `clipOf(file)` is the loaded clip, or null while it loads.
 */
export function applyLayer(entity, rig, seconds, clipOf) {
  const wanted = entity.rigLayer
  const held = entity._rigLayer
  if (!wanted && !held) return

  const fade = rig.layerFade ?? 0.12
  // A new `startedAt` plays the same clip again from its start: the same attack twice.
  const isNew = wanted && (!held || held.clip !== wanted.clip || held.mask !== wanted.mask || held.startedAt !== wanted.startedAt)
  const previous = isNew && held?.weight > 0 ? { clip: held.clip, mask: held.mask, time: held.time, weight: held.weight } : null
  const layer = isNew ? { clip: wanted.clip, mask: wanted.mask, startedAt: wanted.startedAt, time: 0, weight: 0, previous } : held
  // Read every step, so a speed can change while the clip plays.
  if (!isNew) layer.time += seconds * (wanted?.speed ?? 1)
  layer.weight = Math.max(0, Math.min(1, layer.weight + (wanted ? 1 : -1) * (fade > 0 ? seconds / fade : 1)))
  if (layer.weight >= 1) layer.previous = null
  entity._rigLayer = layer.weight > 0 || wanted ? layer : null
  if (isNew) entity.rigLayerDone = false
  if (!entity.pose) return

  const shown = layer.previous && clipOf(clipFileOf(rig, layer.previous.clip))
  const shownNodes = layer.previous && maskNodesOf(rig, layer.previous.mask)
  if (shown && shownNodes) mixLayer(entity, shown, shownNodes, layer.previous.time, layer.previous.weight)

  const file = clipFileOf(rig, layer.clip)
  const nodes = maskNodesOf(rig, layer.mask)
  const clip = file && clipOf(file)
  if (!clip || !nodes) return
  if (mixLayer(entity, clip, nodes, layer.time, layer.weight) && wanted) entity.rigLayerDone = true
}
