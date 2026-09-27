/**
 * Kimodo designer: a move a person shapes on the board, then has Kimodo
 * generate. The board plays a base take on the model; a person drags a hand
 * or foot to where it must be and keys it at a time. Between keys the handle
 * follows a curve, and the limb reaches for it with the same solver the game
 * uses, so the preview is what the keys ask for. Generating turns the keys into
 * Kimodo hand and foot constraints (tools/lib/motion-conditions.mjs).
 *
 * A design is one record, stored as `assets/motion/designs/<name>.json`:
 *
 *   {
 *     name: 'overhead-chop',            the take is made as take-<name>
 *     model: 'models/fighter.glb',
 *     base: 'motion/fighter/idle.json', the take played under the keys; its stored motion is Kimodo's template
 *     prompt: 'a person chops down hard with a sword',
 *     seconds: 2, seed: 0, loop: false,
 *     fromBase: true,                   start the take in the base take's first pose
 *     keys: { RightHand: [{ at: 0.6, value: [x, y, z], ease: 'sine-in-out' }], ... },
 *     hold: { model: 'models/items/sword.glb', position: [x, y, z], rotation: [x, y, z] } | null
 *   }
 *
 * Points are model space: metres, the floor at 0, +Z the way the model faces.
 * `hold` is an item shown in the right hand, in the hand bone's space
 * (metres, radians); it is for the preview only.
 */
import { makeCurve } from '../../../engine/curves.js'

/** The limbs a design keys, each as its chain from the joint nearest the body, by the name Kimodo uses. */
export const HANDLES = {
  RightHand: ['RightArm', 'RightForeArm', 'RightHand'],
  LeftHand: ['LeftArm', 'LeftForeArm', 'LeftHand'],
  RightFoot: ['RightUpLeg', 'RightLeg', 'RightFoot'],
  LeftFoot: ['LeftUpLeg', 'LeftLeg', 'LeftFoot']
}

/** The ease a new key leaves with. */
const KEY_EASE = 'sine-in-out'

/** A new design over `base`, a take on `model`. */
export function newDesign({ name = 'move', model, base }) {
  return { name, model, base, prompt: '', seconds: 2, seed: 0, loop: false, fromBase: true, keys: {}, hold: null }
}

/**
 * The skeleton's own node names for a handle's chain: the node whose name,
 * after any `prefix:`, is the chain's part. Null when the model lacks one.
 */
export function chainOf(skeleton, handle) {
  const names = Object.keys(skeleton.nodes)
  const found = HANDLES[handle].map(part => names.find(name => name.split(':').pop() === part))
  return found.every(Boolean) ? found : null
}

/** `design` with `handle` keyed at `seconds` to `value`, replacing a key at the same frame. */
export function withKey(design, handle, seconds, value) {
  const at = Math.round(seconds * 30) / 30
  const others = (design.keys[handle] ?? []).filter(key => Math.abs(key.at - at) > 1e-6)
  const keys = [...others, { at, value: value.map(axis => Number(axis.toFixed(3))), ease: KEY_EASE }].sort(
    (first, second) => first.at - second.at
  )
  return { ...design, keys: { ...design.keys, [handle]: keys } }
}

/** `design` without `handle`'s key at `at`. */
export function withoutKey(design, handle, at) {
  const keys = (design.keys[handle] ?? []).filter(key => key.at !== at)
  const rest = { ...design.keys, [handle]: keys }
  if (!keys.length) delete rest[handle]
  return { ...design, keys: rest }
}

/** Where each keyed handle is asked to be at `seconds`: `{ handle: point }`. */
export function targetsAt(design, seconds) {
  return Object.fromEntries(
    Object.entries(design.keys).map(([handle, keys]) => [handle, makeCurve(keys).valueAt(seconds)])
  )
}

/** Points along a path, for drawing it: enough that a sine ease reads as a curve. */
const PATH_SAMPLES = 48

/**
 * What the board draws for each keyed handle at `seconds`, so a person sees
 * where the keys ask the limb to be, and not only where it reached:
 * `[{ handle, keys: [point], path: [point], target: point }]`. `path` runs
 * over the design's length.
 */
export function guidesAt(design, seconds) {
  return Object.entries(design.keys).map(([handle, keys]) => {
    const curve = makeCurve(keys)
    const path = Array.from({ length: PATH_SAMPLES + 1 }, (_, index) =>
      curve.valueAt((design.seconds * index) / PATH_SAMPLES)
    )
    return { handle, keys: keys.map(key => key.value), path, target: curve.valueAt(seconds) }
  })
}

/**
 * The reach constraints that pose the preview at `seconds`, for the handles
 * the skeleton has: each keyed handle at its curve, and `dragged`
 * (`{ handle, point }`, or null) where the pointer holds it.
 */
export function previewConstraints(design, skeleton, seconds, dragged = null) {
  const targets = { ...targetsAt(design, seconds), ...(dragged ? { [dragged.handle]: dragged.point } : {}) }
  return Object.entries(targets).flatMap(([handle, point]) => {
    const nodes = chainOf(skeleton, handle)
    return nodes ? [{ kind: 'reach', nodes, target: { model: point }, weight: 1 }] : []
  })
}

/**
 * The Kimodo constraint record for a design (motion-conditions.mjs): the base
 * take's first pose at the start when `fromBase`, and every keyed handle as a
 * joint constraint. `template` is the stored motion the base take came from.
 */
export function kimodoRecord(design, template) {
  const start = design.fromBase ? [{ kind: 'pose', at: [0], from: 0 }] : []
  const joints = Object.entries(design.keys).map(([joint, keys]) => ({
    kind: 'joint',
    joint,
    keys: keys.map(key => ({ at: key.at, value: key.value }))
  }))
  return { template, constraints: [...start, ...joints] }
}
