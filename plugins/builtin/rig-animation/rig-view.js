/**
 * Rig Animation: the rig as it stands this step, in world points, for a
 * picture or a question: every posed bone, and every constraint solved on it.
 *
 *   {
 *     bones: [[from, to], ...],
 *     constraints: [{ kind, weight, end, target, joint?, pole? }, ...]
 *   }
 *
 * `end` is where the bone the constraint moves is now; `target` where it was
 * asked to go; `joint` the middle of a limb and `pole` where that joint was
 * asked to point. A plant's target is where its foot is locked. Points are
 * `[x, y, z]` in the world, after the constraints are solved.
 */
import { placeOf, posedNames } from './skeleton.js'
import { pointOf, worldPointOf } from './targets.js'

/** The rig of one entity under its pose, after `constraints` were solved; `memory` is theirs. */
export function rigView(entity, skeleton, constraints, memory = {}) {
  const worldAt = name => worldPointOf(entity, placeOf(skeleton, entity.pose, name).position)
  const posed = Object.keys(entity.pose)
    .map(name => skeleton.nameOf(name))
    .filter(Boolean)
  const bones = posed
    .filter(name => skeleton.nodes[name].parent && entity.pose[skeleton.nodes[name].parent])
    .map(name => [worldAt(skeleton.nodes[name].parent), worldAt(name)])
  const shown = constraints.map(constraint => VIEWS[constraint.kind]?.(entity, skeleton, constraint, memory, worldAt))
  return { bones, constraints: shown.filter(Boolean) }
}

/** A model-space target in the world, or null when it is not there. */
function worldTarget(entity, skeleton, target) {
  const point = target ? pointOf(entity, skeleton, target) : null
  return point ? worldPointOf(entity, point) : null
}

/** How each kind of constraint is shown, or null when it names bones the pose has not got. */
const VIEWS = {
  reach(entity, skeleton, reach, memory, worldAt) {
    const chain = posedNames(skeleton, entity.pose, reach.nodes)
    if (chain?.length !== 3) return null
    return {
      kind: 'reach',
      weight: reach.weight,
      end: worldAt(chain[2]),
      joint: worldAt(chain[1]),
      target: worldTarget(entity, skeleton, reach.target),
      pole: worldTarget(entity, skeleton, reach.pole)
    }
  },
  lookAt(entity, skeleton, look, memory, worldAt) {
    const [name] = posedNames(skeleton, entity.pose, [look.node]) ?? []
    if (!name) return null
    return {
      kind: 'lookAt',
      weight: look.weight,
      end: worldAt(name),
      target: worldTarget(entity, skeleton, look.target)
    }
  },
  plant(entity, skeleton, plant, memory, worldAt) {
    const chain = posedNames(skeleton, entity.pose, plant.nodes)
    if (chain?.length !== 3) return null
    const held = memory[`plant:${JSON.stringify(plant.nodes)}`]
    return {
      kind: 'plant',
      weight: held?.weight ?? 0,
      end: worldAt(chain[2]),
      joint: worldAt(chain[1]),
      target: held?.held ?? null,
      pole: worldTarget(entity, skeleton, plant.pole)
    }
  }
}
