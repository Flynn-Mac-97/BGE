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
import { FOLLOW, followOf, isPathAction, motionOf, recordAlong } from './guard-path.js'
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
 * The mask nodes an action names: 'upper', 'lower' (the hips and legs),
 * 'right-arm', 'left-arm', 'all', or a list of nodes. Kept per skeleton, so a
 * layer sees the same list each step.
 */
const masks = new WeakMap()
function maskOf(skeleton, mask) {
  if (Array.isArray(mask)) return mask
  if (!masks.has(skeleton)) {
    const roles = rolesOf(skeleton)
    const upper = upperBodyOf(skeleton, roles.chest)
    masks.set(skeleton, {
      upper,
      lower: Object.keys(skeleton.nodes).filter(name => !upper.includes(name)),
      'right-arm': armMaskOf(skeleton, roles.chest, roles.right?.shoulder),
      'left-arm': armMaskOf(skeleton, roles.chest, roles.left?.shoulder),
      all: Object.keys(skeleton.nodes)
    })
  }
  return masks.get(skeleton)[mask ?? 'upper']
}

/**
 * The action playing, as the entity keeps it. A path action moves the held
 * item by `motion` (guard-path.js) and its hands stay locked to the item
 * unless it says otherwise; a take action has no motion. `start` is the guard
 * a chained action takes over from.
 */
const playingOf = (name, action, guard, start = null) => ({
  name,
  hands: action.hold ?? {},
  body: action.body ?? FOLLOW,
  next: action.next ?? null,
  link: action.link ?? Infinity,
  isQueued: false,
  time: 0,
  motion: isPathAction(action) ? motionOf(action, guard, start) : null
})

/**
 * Play `action` as `name`: what it moves, and its take, if it names one, as a
 * layer on its mask. A path action with a take plays both: the take on the
 * legs, say, so the feet step, and the keys on the item and the arms.
 */
function startAction(entity, { name, action, guard, start }, skeleton, random) {
  entity._animationAction = playingOf(name, action, guard, start)
  // An action with no take leaves the layer as it is: a combo's later swings keep the first one's footwork.
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

/**
 * Move a path action on, and chain into its `next` once it was asked again
 * and has reached its `link`, from where the item is. Answers true when it
 * chained.
 */
function chainedOn(entity, { sets, guard, skeleton, random }, asked, seconds) {
  const playing = entity._animationAction
  if (!playing?.motion) return false
  playing.time += seconds
  if (asked && playing.next) playing.isQueued = true
  const next = playing.isQueued && playing.time >= playing.link ? actionOf(sets, playing.next) : null
  if (!isPathAction(next)) return false
  startAction(entity, { name: playing.next, action: next, guard, start: playing.motion.guardAt(playing.time) }, skeleton, random)
  return true
}

/**
 * Start the action game code asked for (`entity.animationAction`, taken when
 * read) as a layer over the state, chain a path action into its next, or end
 * the one playing when it is done. An action the on sets do not give is let
 * go of, and said once. `guard` is the held item's own guard.
 */
function stepAction(entity, sets, skeleton, random, report, seconds, guard) {
  const asked = entity.animationAction
  entity.animationAction = null
  if (chainedOn(entity, { sets, guard, skeleton, random }, asked, seconds)) return
  const playing = entity._animationAction
  const isPathDone = playing?.motion && playing.time > playing.motion.duration
  if (playing && (isPathDone || (!playing.motion && entity.rigLayerDone))) {
    entity._animationAction = null
    entity.rigLayer = null
  }
  if (!asked || entity._animationAction || !skeleton) return
  const action = actionOf(sets, asked)
  if (!isPathAction(action) && !action?.clips?.length) {
    report(`no set that is on gives the action "${asked}"`)
    return
  }
  startAction(entity, { name: asked, action, guard, start: null }, skeleton, random)
}

/** The hold record this step: during a path action, its guard moved along the action's motion. */
function recordNow(entity, record) {
  const acting = entity._animationAction
  return record && acting?.motion ? recordAlong(record, acting.motion, acting.time) : record
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
  // During a path action the spine turns after the item first, then the hands reach it.
  const acting = entity._animationAction
  const follow = acting?.motion ? followOf(skeleton, now.guard, record.guard, acting.body) : null
  entity.rigConstraints = [...(follow ? [{ ...follow, weight: follow.weight * weight }] : []), ...held.constraints]
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
  stepAction(entity, sets, skeleton, random, report, seconds, record?.guard ?? {})
  stepHold(entity, record, skeleton, machine, seconds)
  return machine
}
