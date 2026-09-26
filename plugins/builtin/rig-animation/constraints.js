/**
 * Rig Animation: constraints, which change the pose after the clip and the
 * layer, in the fixed step, so a headless run poses exactly as the page draws.
 *
 * A constraint is `{ kind, ... }`, and `kind` names a solver in SOLVERS. The
 * type's `rig.constraints` are solved first, then the entity's
 * `rigConstraints`, each list in order, so a later one sees what an earlier
 * one did. To add a kind, add a file to solvers/ and a line here.
 *
 * A solver is `(entity, skeleton, constraint, { seconds, memory }) -> refusal | null`.
 * It writes local turns into `entity.pose` and changes only nodes the clip
 * poses. `memory` is a record kept between steps for that one constraint, in
 * `entity._rigMemory`, keyed by its kind and nodes.
 */
import { makeOnceReporter } from '../../../engine/report-once.js'
import solveReach from './solvers/reach.js'
import solveLookAt from './solvers/look-at.js'
import solvePlant from './solvers/plant.js'

const reportOnce = makeOnceReporter().report

/** Every solver by kind. */
const SOLVERS = { reach: solveReach, lookAt: solveLookAt, plant: solvePlant }

/** Solve `constraints` in order over the entity's pose, one fixed step of `seconds`. */
export function applyConstraints(entity, skeleton, constraints, seconds) {
  entity._rigMemory ??= {}
  for (const constraint of constraints) {
    const solve = SOLVERS[constraint?.kind]
    if (!solve) {
      reportOnce(
        `[rig] ${entity.id}: no constraint kind "${constraint?.kind}"; one of ${Object.keys(SOLVERS).join(', ')}`
      )
      continue
    }
    const key = `${constraint.kind}:${JSON.stringify(constraint.nodes ?? constraint.node)}`
    entity._rigMemory[key] ??= {}
    const refusal = solve(entity, skeleton, constraint, { seconds, memory: entity._rigMemory[key] })
    if (refusal) reportOnce(`[rig] ${entity.id}: ${refusal}`)
  }
}
