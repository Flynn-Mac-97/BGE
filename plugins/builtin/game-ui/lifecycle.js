/**
 * Game UI lifecycle: taking records down, and moving each through its phases.
 * A record leaves at once (`removeNow`) or after its `leave` seconds; an anchor
 * whose entity is gone leaves at once.
 */
import { advancePhase } from './records.js'
import { removeAnchorElement, resolveTarget } from './world-layer.js'

/** Take down the anchor of an entity that no longer exists. Here and not in the frame, so a headless run does it too. */
export function dropGoneAnchors(context, state) {
  for (const [id, anchor] of state.anchors) if (resolveTarget(anchor.to, context.world).isGone) removeNow(context, state, id)
}

/** Take a panel or anchor down at once, whatever its `leave`. */
export function removeNow(context, state, id) {
  const record = state.panels.get(id) ?? state.anchors.get(id)
  if (!record) return false
  if (record.kind === 'panel' && record.element) context.ui?.unmount(record.element)
  if (record.kind === 'anchor') removeAnchorElement(record)
  state.panels.delete(id)
  state.anchors.delete(id)
  return true
}

/** Advance every record's phase for a frame, remove those done leaving, and mirror the phase onto each element. */
export function runPhases(context, state, seconds) {
  for (const records of [state.panels, state.anchors]) {
    for (const [id, record] of records) {
      if (advancePhase(record, state.frame, seconds)) removeNow(context, state, id)
      else if (record.element && record.element.dataset.phase !== record.phase) record.element.dataset.phase = record.phase
    }
  }
}
