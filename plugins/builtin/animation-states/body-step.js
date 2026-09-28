/**
 * Animation States: one body's fixed step — its graph and sets read, its
 * machine moved, an action started or ended, and its item held. The plugin
 * calls `stepBody` for every body with `animationStates` on its type, before
 * Rig Animation runs.
 *
 * `readJson(path)` is an asset file under assets/ as a record, or null while
 * it loads or when it is missing (the plugin reads and reports). The entity's
 * own fields it writes: `animationState`, `rigClip`, `rigRootTurn`,
 * `rigLayer`, `rigConstraints` and `attachments.held`, and the private ones
 * named below.
 */
import { nextState, pickClip } from './machine.js'
import { heldPose } from './held-items.js'
import { actionOf, armMaskOf, machineWith, upperBodyOf } from './graph.js'
import { guardAt, guardCurveOf } from './guard-path.js'
import { rolesOf } from '../rig-animation/clip-reading.js'
import { yawPitchRollOf } from '../game-maths/turns.js'

/** Where hold records are when a graph names no folder: `<folder>/<item>.hold.json` under assets/. */
export const ITEM_FOLDER = 'models/items'

/** Where set files are when a graph names no folder: `<folder>/<set>.set.json` under assets/. */
export const SET_FOLDER = 'animation/sets'

/** The graph a type declares: the record itself, or the file it names (under assets/). */
export const graphOf = (definition, readJson) =>
  typeof definition.animationStates === 'string' ? readJson(definition.animationStates) : definition.animationStates

/** The hold record of the entity's item, or null. */
export const heldRecordOf = (entity, graph, readJson) =>
  entity.heldItem ? readJson(`${graph.items ?? ITEM_FOLDER}/${entity.heldItem}.hold.json`) : null

/** The names of the sets on: the graph's own, then the held item's. */
export const setNamesOf = (graph, heldRecord) => [...(graph.sets ?? []), ...(heldRecord?.set ? [heldRecord.set] : [])]

/** The set records that have loaded, in order. */
export const setsOf = (graph, names, readJson) => names.map(name => readJson(`${graph.setsFolder ?? SET_FOLDER}/${name}.set.json`)).filter(Boolean)

/** Enter `name`: remember the state and pick its clip. */
function enter(entity, machine, name, random) {
  entity.animationState = name
  entity._animationClip = pickClip(machine, name, random())
}

/**
 * Move the machine a step and set the clip Rig Animation plays. `setKey`
 * names the sets on; when it changes, the state's clip is picked again from
 * the takes the sets now give.
 */
function stepMachine(entity, machine, random, setKey) {
  if (!entity.animationState || !machine.states[entity.animationState]) {
    enter(entity, machine, machine.start ?? Object.keys(machine.states)[0], random)
  }
  if (entity._animationSetKey !== setKey) {
    entity._animationSetKey = setKey
    enter(entity, machine, entity.animationState, random)
  }
  const inputs = { ...entity.animationInputs, acting: entity._animationAction?.name ?? null, done: Boolean(entity.rigDone) }
  const next = nextState(machine, entity.animationState, inputs)
  if (next !== entity.animationState) enter(entity, machine, next, random)
  if (entity._animationClip) entity.rigClip = entity._animationClip
  // A turn in place: the clip's turn moves into the entity's facing (Rig Animation's root turn).
  entity.rigRootTurn = Boolean(machine.states[entity.animationState]?.turns)
}

/**
 * The mask nodes an action names: 'upper', 'right-arm', 'left-arm', 'all', or
 * a list of nodes. Kept per skeleton, so a layer sees the same list each step.
 */
const masks = new WeakMap()
function maskOf(skeleton, mask) {
  if (Array.isArray(mask)) return mask
  if (!masks.has(skeleton)) {
    const roles = rolesOf(skeleton)
    masks.set(skeleton, {
      upper: upperBodyOf(skeleton, roles.chest),
      'right-arm': armMaskOf(skeleton, roles.chest, roles.right?.shoulder),
      'left-arm': armMaskOf(skeleton, roles.chest, roles.left?.shoulder),
      all: Object.keys(skeleton.nodes)
    })
  }
  return masks.get(skeleton)[mask ?? 'upper']
}

/**
 * Start the action game code asked for (`entity.animationAction`, taken when
 * read) as a layer over the state, or end the one playing when its clip is
 * done. An action the on sets do not give is let go of, and said once.
 */
function stepAction(entity, sets, skeleton, random, report, seconds) {
  const asked = entity.animationAction
  entity.animationAction = null
  const playing = entity._animationAction
  if (playing?.path) playing.time += seconds
  const isPathDone = playing?.path && playing.time > playing.path.at(-1).at
  if (playing && (isPathDone || (!playing.path && entity.rigLayerDone))) {
    entity._animationAction = null
    entity.rigLayer = null
  }
  if (!asked || entity._animationAction || !skeleton) return
  const action = actionOf(sets, asked)
  if (!action?.path?.length && !action?.clips?.length) {
    report(`no set that is on gives the action "${asked}"`)
    return
  }
  // A path action moves the held item; its hands stay locked to the item unless it says otherwise.
  entity._animationAction = { name: asked, hands: action.hold ?? {}, path: action.path ?? null, time: 0, curve: null }
  if (!action.clips?.length) return
  entity._animationActionCount = (entity._animationActionCount ?? 0) + 1
  entity.rigLayer = {
    clip: action.clips[Math.min(action.clips.length - 1, Math.floor(random() * action.clips.length))],
    mask: maskOf(skeleton, action.mask),
    speed: action.speed ?? 1,
    startedAt: entity._animationActionCount
  }
  entity.rigLayerDone = false
}

/** The hold record this step: during a path action, its guard moved along the path, with no spring or sway to lag it. */
function recordNow(entity, record) {
  const acting = entity._animationAction
  if (!record || !acting?.path) return record
  acting.curve ??= guardCurveOf(acting.path, record.guard)
  return { ...record, guard: guardAt(acting.curve, acting.time), motion: { ...record.motion, stiffness: 0, sway: 0 } }
}

/** Hold the entity's item this step, or let go of one it held. */
function stepHold(entity, record, skeleton, machine, seconds) {
  // `entity.holdWeight` (default 1) scales the whole hold: 0 shows the clip's own arms with the item still in the hand.
  const weight = (machine.states[entity.animationState]?.hold ?? 1) * (entity.holdWeight ?? 1)
  const hands = entity._animationAction?.hands ?? {}
  const memory = (entity._heldMemory ??= {})
  const now = recordNow(entity, record)
  const held = now && skeleton && entity.pose && heldPose({ record: now, skeleton, pose: entity.pose, seconds: entity._heldTime ?? 0, memory, weight, hands })
  entity._heldTime = (entity._heldTime ?? 0) + seconds
  if (!held) {
    if (!entity._isHolding) return
    entity.attachments = Object.fromEntries(Object.entries(entity.attachments ?? {}).filter(([name]) => name !== 'held'))
    entity.rigConstraints = []
    entity._isHolding = false
    return
  }
  const { model, node, position, turn } = held.attachment
  entity.attachments = { ...entity.attachments, held: { model, node, position, rotation: yawPitchRollOf(turn) } }
  entity.rigConstraints = held.constraints
  entity._isHolding = true
}

/**
 * One body's step. Answers the machine it ran, or null while its graph loads.
 * `report(words)` says a problem once.
 */
export function stepBody({ entity, readJson, skeletonOf, random, seconds, report }) {
  const graph = graphOf(entity._definition, readJson)
  if (!graph) return null
  const record = heldRecordOf(entity, graph, readJson)
  const names = setNamesOf(graph, record)
  const sets = setsOf(graph, names, readJson)
  const machine = machineWith(graph, sets)
  const skeleton = skeletonOf(entity)
  stepMachine(entity, machine, random, `${names.join(',')}:${sets.length}`)
  stepAction(entity, sets, skeleton, random, report, seconds)
  stepHold(entity, record, skeleton, machine, seconds)
  return machine
}
