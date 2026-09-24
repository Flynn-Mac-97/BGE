/**
 * Rig Animation: a layer — a second clip played on some nodes only, over the
 * base clip, faded in and out. See the Rig Animation header for the contract.
 */
import { framesAt, mixInto } from './sample.js'

/**
 * Play the entity's layer clip over the pose already written, on the layer's
 * mask nodes only, faded in and out.
 *
 * The layer is remembered past the moment game code lets it go, so it can fade
 * out from where it was rather than snapping back to the base clip.
 * `clipOf(file)` is the loaded clip, or null while it loads.
 */
export function applyLayer(entity, rig, seconds, clipOf) {
  const wanted = entity.rigLayer
  const held = entity._rigLayer
  if (!wanted && !held) return

  const fade = rig.layerFade ?? 0.12
  // A new `startedAt` plays the same clip again from its start: the same attack twice.
  const isNew = wanted && (!held || held.clip !== wanted.clip || held.mask !== wanted.mask || held.startedAt !== wanted.startedAt)
  const layer = isNew ? { clip: wanted.clip, mask: wanted.mask, startedAt: wanted.startedAt, time: 0, weight: held?.weight ?? 0 } : held
  // Read every step, so a speed can change while the clip plays.
  if (!isNew) layer.time += seconds * (wanted?.speed ?? 1)
  layer.weight = Math.max(0, Math.min(1, layer.weight + (wanted ? 1 : -1) * (fade > 0 ? seconds / fade : 1)))
  entity._rigLayer = layer.weight > 0 || wanted ? layer : null
  if (isNew) entity.rigLayerDone = false

  const file = rig.clips?.[layer.clip]
  const nodes = rig.masks?.[layer.mask]
  const clip = file && clipOf(file)
  if (!clip || !nodes || !entity.pose) return

  const { first, second, blend, isDone } = framesAt(clip, layer.time)
  if (isDone && wanted) entity.rigLayerDone = true
  const sampled = [0, 0, 0, 1]
  for (const node of nodes) {
    const index = clip.nodes.indexOf(node)
    const into = entity.pose[node]
    if (index < 0 || !into) continue
    mixInto(sampled, clip.rotations[first], clip.rotations[second], index * 4, blend)
    mixInto(into, into, sampled, 0, layer.weight)
  }
}

