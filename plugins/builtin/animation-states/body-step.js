/**
 * Animation States: one body's fixed step — its graph and sets read, its
 * machine moved, an action started or ended, and its item held. The plugin
 * calls `stepBody` for every body with `animationStates` on its type, before
 * Rig Animation runs.
 *
 * `readJson(path)` is an asset file under assets/ as a record, or null while
 * it loads or when it is missing (the plugin reads and reports). The entity's
 * own fields it writes: `animationState`, `rigClip`, `rigRootTurn`,
 * `rigLayer`, `rigConstraints`, `attachments.held` and `attachments.heldOff`,
 * and the private ones named below.
 *
 * `entity.offHandItem` holds a second item in the other hand: its own hold
 * record seen in a mirror (held-items.js `offHandRecord`), and its `offSet`
 * turned on. A path action with `item: 'off'` moves that item; its keys are
 * written as for the holding hand, and are mirrored as they play.
 */
import { nextState, pickClip } from './machine.js'
import { heldPose, offHandRecord } from './held-items.js'
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

/** The hold record of `item`, as its file has it, or null. */
const holdRecordOf = (graph, item, readJson) => (item ? readJson(`${graph.items ?? ITEM_FOLDER}/${item}.hold.json`) : null)

/** The hold record of the entity's item, or null. */
export const heldRecordOf = (entity, graph, readJson) => holdRecordOf(graph, entity.heldItem, readJson)

/** The hold record of the entity's off-hand item as its file has it (for the holding hand), or null. */
export const offHandItemRecordOf = (entity, graph, readJson) => holdRecordOf(graph, entity.offHandItem, readJson)

/**
 * The names of the sets on: the graph's own, the held item's, then the set
 * the off-hand item turns on (`offSet`), which wins where it gives the same action.
 */
export const setNamesOf = (graph, heldRecord, offHandRecordOnFile = null) => [
  ...(graph.sets ?? []),
  ...(heldRecord?.set ? [heldRecord.set] : []),
  ...(offHandRecordOnFile?.offSet ? [offHandRecordOnFile.offSet] : [])
]

/** Which held item an action moves: 'main', or 'off' for the off-hand item. */
const movedItemOf = action => (action?.item === 'off' ? 'off' : 'main')

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
  item: movedItemOf(action),
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
function startAction(entity, { name, action, guards, start }, skeleton, random) {
  entity._animationAction = playingOf(name, action, guards[movedItemOf(action)], start)
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
function chainedOn(entity, { sets, guards, skeleton, random }, asked, seconds) {
  const playing = entity._animationAction
  if (!playing?.motion) return false
  playing.time += seconds
  if (asked && playing.next) playing.isQueued = true
  const next = playing.isQueued && playing.time >= playing.link ? actionOf(sets, playing.next) : null
  if (!isPathAction(next)) return false
  // The next swing takes over from where the item is, when it moves the same item.
  const start = movedItemOf(next) === playing.item ? playing.motion.guardAt(playing.time) : null
  startAction(entity, { name: playing.next, action: next, guards, start }, skeleton, random)
  return true
}

/**
 * Start the action game code asked for (`entity.animationAction`, taken when
 * read) as a layer over the state, chain a path action into its next, or end
 * the one playing when it is done. An action the on sets do not give is let
 * go of, and said once. `guards` is each held item's own guard, `{ main, off }`.
 */
function stepAction(entity, sets, skeleton, random, report, seconds, guards) {
  const asked = entity.animationAction
  entity.animationAction = null
  if (chainedOn(entity, { sets, guards, skeleton, random }, asked, seconds)) return
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
  startAction(entity, { name: asked, action, guards, start: null }, skeleton, random)
}

/**
 * Each item held this step, `{ item, attachment, record, rest }`: `record` the
 * hold as it is now (during a path action that moves it, its guard moved
 * along the motion), `rest` as its file has it, each seen from the hand that
 * holds it. `records` is `{ main, off }` as the files have them.
 */
function holdsNow(entity, records) {
  const acting = entity._animationAction
  const moved = (record, item) => (acting?.motion && acting.item === item ? recordAlong(record, acting.motion, acting.time) : record)
  return [
    records.main && { item: 'main', attachment: 'held', record: moved(records.main, 'main'), rest: records.main },
    records.off && { item: 'off', attachment: 'heldOff', record: offHandRecord(moved(records.off, 'off')), rest: offHandRecord(records.off) }
  ].filter(Boolean)
}

/** The attachments with the held items' dropped. */
const withoutHeld = attachments => Object.fromEntries(Object.entries(attachments ?? {}).filter(([name]) => name !== 'held' && name !== 'heldOff'))

/** Hold the entity's items this step, or let go of those it held. */
function stepHold(entity, records, skeleton, machine, seconds) {
  // `entity.holdWeight` (default 1) scales the whole hold: 0 shows the clip's own arms with the item still in the hand.
  const weight = (machine.states[entity.animationState]?.hold ?? 1) * (entity.holdWeight ?? 1)
  const acting = entity._animationAction
  const memories = (entity._heldMemories ??= { main: {}, off: {} })
  const holds = skeleton && entity.pose ? holdsNow(entity, records) : []
  const posed = holds
    .map(hold => ({ ...hold, held: heldPose({ record: hold.record, skeleton, pose: entity.pose, seconds: entity._heldTime ?? 0, memory: memories[hold.item], weight, hands: acting?.item === hold.item ? acting.hands : {} }) }))
    .filter(hold => hold.held)
  entity._heldTime = (entity._heldTime ?? 0) + seconds
  if (!posed.length) {
    if (!entity._isHolding) return
    entity.attachments = withoutHeld(entity.attachments)
    entity.rigConstraints = []
    entity._isHolding = false
    return
  }
  const attachments = Object.fromEntries(posed.map(({ attachment, held: { attachment: { model, node, position, turn } } }) => [attachment, { model, node, position, rotation: yawPitchRollOf(turn) }]))
  entity.attachments = { ...withoutHeld(entity.attachments), ...attachments }
  // During a path action the spine turns after the item it moves first, then the hands reach it.
  const mover = acting?.motion && posed.find(hold => hold.item === acting.item)
  const follow = mover ? followOf(skeleton, mover.record.guard, mover.rest.guard, acting.body) : null
  entity.rigConstraints = [...(follow ? [{ ...follow, weight: follow.weight * weight }] : []), ...posed.flatMap(hold => hold.held.constraints)]
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
  const offRecord = offHandItemRecordOf(entity, graph, readJson)
  const names = setNamesOf(graph, record, offRecord)
  const sets = setsOf(graph, names, readJson)
  const machine = machineWith(graph, sets)
  const skeleton = skeletonOf(entity)
  stepMachine(entity, machine, random, `${names.join(',')}:${sets.length}`)
  stepAction(entity, sets, skeleton, random, report, seconds, { main: record?.guard ?? {}, off: offRecord?.guard ?? {} })
  stepHold(entity, { main: record, off: offRecord }, skeleton, machine, seconds)
  return machine
}
