/**
 * Rig Animation: the control rig. A type names its controls once, and game
 * code moves a control by name, never a bone.
 *
 *   rig: {
 *     controls: {
 *       rightHand: { kind: 'limb', nodes: [upper, lower, end], pole: { node: 'Spine2', at: [-0.4, -0.3, -0.6] } },
 *       head: { kind: 'aim', node: 'Head', limit: 60 }
 *     }
 *   }
 *   entity.rigControls = { rightHand: { target, weight }, head: { target, weight } }
 *
 * A limb's `pole` is where its middle joint points — an elbow, a knee. Put it
 * in a body node's space and the joint follows the body as it turns. A request
 * may name its own `pole` for one move. A request may also be a list, solved
 * in order on the same limb: an arm leaving a quiver for a bowstring.
 *
 * A request may follow a path instead of naming a target: curve keys of
 * points (engine/curves.js), in model space, or in `node`'s space when it names
 * one. `startedAt` is the world time the path starts; `speed` (1) runs it
 * faster or slower; the control takes the path over `fade` path seconds (0.15)
 * at its start and gives it back over the same at its end. A hand swinging a
 * weapon, a head following a flight, a foot tracing a step.
 *
 *   entity.rigControls = { rightHand: { path: [{ at: 0, value: [0, 1, 0.3], ease: 'quad-in' }, ...], startedAt: context.time } }
 *
 * Each control becomes a constraint (constraints.js): a limb a `reach`, an aim
 * a `lookAt`. A request names a target or a path, a weight (1 for a path) and
 * optionally a pole.
 */
import { makeCurve } from '../../../engine/curves.js'

/** Path seconds a control takes to join its path, and to leave it. */
const PATH_FADE = 0.15

/** Each path's curve, made once: a path is plain keys in entity state, so a snapshot stays plain data. */
const pathCurves = new WeakMap()

/** A control kind, as the constraint one request of it asks for. */
const CONSTRAINTS = {
  limb: (control, request) => ({
    kind: 'reach',
    nodes: control.nodes,
    target: request.target,
    weight: request.weight,
    pole: request.pole ?? control.pole ?? null
  }),
  aim: (control, request) => ({
    kind: 'lookAt',
    node: control.node,
    forward: control.forward,
    limit: control.limit,
    target: request.target,
    weight: request.weight
  })
}

/**
 * The constraints the entity's control requests ask for at world time `now`, in the order the
 * type declares its controls. Answers `{ constraints, refusals }`: a request
 * for a control the type has not got, or of an unknown kind, is refused by name.
 */
export function constraintsForControls(controls = {}, requests = {}, now = 0) {
  const refusals = Object.keys(requests)
    .filter(name => !controls[name])
    .map(name => `no control "${name}"; the type has ${Object.keys(controls).join(', ') || 'none'}`)
  const constraints = []
  for (const [name, control] of Object.entries(controls)) {
    const toConstraint = CONSTRAINTS[control.kind]
    if (!toConstraint) {
      refusals.push(`control "${name}" has kind "${control.kind}"; one of ${Object.keys(CONSTRAINTS).join(', ')}`)
      continue
    }
    for (const request of [].concat(requests[name] ?? []))
      constraints.push(toConstraint(control, requestAt(request, now)))
  }
  return { constraints, refusals }
}

/** A request as it stands at `now`: one that follows a path has its target on the path and its weight faded. */
function requestAt(request, now) {
  if (!request.path) return request
  if (!pathCurves.has(request.path)) pathCurves.set(request.path, makeCurve(request.path))
  const path = pathCurves.get(request.path)
  const seconds = (now - request.startedAt) * (request.speed ?? 1)
  const point = path.valueAt(seconds)
  const target = request.node ? { node: request.node, at: point } : { model: point }
  return {
    ...request,
    target,
    weight: (request.weight ?? 1) * fadeOf(seconds, path.duration, request.fade ?? PATH_FADE)
  }
}

/** How much of a path's weight is on at `seconds`: 0 outside it, easing to 1 over `fade` at each end. */
function fadeOf(seconds, duration, fade) {
  const share = Math.min(1, Math.max(0, Math.min(seconds, duration - seconds) / fade))
  return share * share * (3 - 2 * share)
}
