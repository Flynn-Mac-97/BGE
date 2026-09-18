/**
 * Kernel: what a Rapier solver holds, so a checkpoint of the run carries it.
 *
 * The entities alone are not enough: a ball restored to where it was with no
 * velocity behind it is a world that stands still and looks right. Null is a
 * moment taken before the solver had bodies, and putting that back means holding
 * none — otherwise the rewind replays the later run's velocities.
 *
 * `restore` is the plugin's own, because only it knows how a moment is written
 * back into the solver.
 */
export function installSolver(context, { key, name, bridgeOf, restore }) {
  context[key] = {
    snapshot: () => bridgeOf(context)?.snapshot() || null,
    /** Put the solver back to a snapshot's moment. False when it would not go. */
    restore: bytes => bridgeOf(context)?.restore(bytes) === true
  }
  context.checkpoints?.add(name, {
    capture: () => bridgeOf(context)?.capture() || null,
    restore: capture => restore(context, capture)
  })
  context.bus.on('level:loaded', () => bridgeOf(context)?.forget())
}
