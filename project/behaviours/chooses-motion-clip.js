/**
 * Chooses Motion Clip — which captured clip a body plays, from what it is doing.
 *
 * Rig Animation plays whatever `entity.rigClip` names. This decides the name,
 * every step, from fields other behaviours already write: `moveSpeed` and
 * `crouched` from counter-strike-movement, `grounded` from Physics 3D, and
 * `damageable.alive` from the damage plugin. It reads them and writes one
 * string; it never asks another behaviour anything.
 *
 * Assignment rather than a call, which is what makes it safe to run every step:
 * naming the clip already playing does nothing, and naming a different one
 * restarts it at frame zero.
 *
 * Both sides use this. The clips are on the type, so a type that declares
 * different ones plays different ones with no change here.
 */

/**
 * Where each band starts, in metres a second.
 *
 * Movement's own numbers are 6.35 running, 3.3 walking on shift and 2.1
 * crouched. `RUNNING` sits between the walk and the run so shift-walking reads
 * as a walk; `MOVING` is above the drift a body has while stopping.
 */
const RUNNING = 4.5
const MOVING = 0.4

export default {
  update(entity) {
    entity.rigClip = clipFor(entity)
  }
}

/**
 * The clip name, most specific state first.
 *
 * Death outranks everything: a body shot in the air is dead, not jumping. A
 * missing clip is not this file's problem — Rig Animation holds the last pose
 * for a name the type has not got, so a type may declare only `idle` and
 * `walk` and the rest are simply never seen.
 */
function clipFor(entity) {
  if (entity.damageable?.alive === false) return 'death'
  if (entity.grounded === false) return 'jump'
  if (entity.crouched === true) return entity.moveSpeed > MOVING ? 'crouchWalk' : 'crouchIdle'
  if (entity.moveSpeed > RUNNING) return 'run'
  if (entity.moveSpeed > MOVING) return 'walk'
  return 'idle'
}
