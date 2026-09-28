/**
 * Kimodo's hold board: a take played with an item held over it, by the same
 * hold Animation States gives a game (animation-states/held-items.js), so a
 * grip set here is the grip the game uses. An item is its hold record,
 * `assets/models/items/<item>.hold.json`; the sliders change a copy, and Save
 * writes it back.
 *
 * The board's hold is one record, changed only by the board:
 *   {
 *     item: 'sword' | ... | 'none',   an item that has a hold record
 *     record,                           the hold record the board shows, sliders applied
 *     edits: { [part]: [across, along, depth, roll] },   metres and degrees over the grip,
 *                                       part a socket's side or 'mount'; Save folds them in
 *     set, action, track, key,          the path board's part (path-board.js)
 *     isPinned, isCombo
 *   }
 */
import { applyClip } from '../rig-animation.js'
import { applyConstraints } from '../rig-animation/constraints.js'
import { heldPose } from '../animation-states/held-items.js'
import { FOLLOW, followOf, pathLineOf, recordAlong } from '../animation-states/guard-path.js'
import { placeOf } from '../rig-animation/skeleton.js'
import { rolesOf } from '../rig-animation/clip-reading.js'
import { liveSlider } from './live-slider.js'
import { boardMotionOf, boardTimeOf, keyTimesOf, legTakeOf, pathActionOf, pathRows } from './path-board.js'
import { mixLayer } from '../rig-animation/layer.js'
import { upperBodyOf } from '../animation-states/graph.js'
import { add } from '../game-maths/space.js'
import { multiply, turnAbout } from '../game-maths/turns.js'

const DEGREES = Math.PI / 180

/** Where the items' hold records are. */
export const ITEMS = 'assets/models/items'

/** An item's hold record file. */
export const holdFileOf = item => `${ITEMS}/${item}.hold.json`

/** The board's hold before any item is picked. */
export function newHold() {
  return { item: 'none', record: null, edits: {}, set: null, action: 'none', track: 'hand', key: 0, isPinned: false, isCombo: false }
}

/** The parts of a grip a person can move: each socket's side, or 'mount'. */
const gripParts = grip => (grip?.mount ? ['mount'] : Object.keys(grip?.sockets ?? {}))

/**
 * One part with its edit applied. A hand moves across, along the hilt (the
 * item's Y) and in depth, and rolls about the hilt, its own Y; a mount moves
 * along the bone (its X), out and across, and rolls about the bone.
 */
function editedPart(part, edit, kind) {
  if (!edit) return part
  const [across, along, depth, roll] = edit
  if (kind === 'mount')
    return { ...part, position: add(part.position, [along, depth, across]), turn: multiply(turnAbout(0, roll * DEGREES), part.turn) }
  return { ...part, position: add(part.position, [across, along, depth]), turn: multiply(part.turn, turnAbout(1, roll * DEGREES)) }
}

/** The hold record with every grip edit applied: what the board shows, and what Save writes. */
export function editedRecord(hold) {
  const record = hold.record
  if (!record) return null
  const grip = record.grip.mount
    ? { mount: editedPart(record.grip.mount, hold.edits.mount, 'mount') }
    : { sockets: Object.fromEntries(Object.entries(record.grip.sockets).map(([side, socket]) => [side, editedPart(socket, hold.edits[side], 'socket')])) }
  return { ...record, grip }
}

/** The drawn arcs' colours: the hand's, and the item tip's. */
const ARC_COLOURS = { hand: '#4ad8ff', tip: '#ff8a3d' }

/**
 * Draw the arcs again into `line` when the actions, the guard or the picked
 * key changed; the chest is where it is now. The picked key is marked on the
 * arc of its track: the hand's, or the tip's for the blade.
 */
function keepLine(line, hold, record, motion, chest) {
  const signature = JSON.stringify([hold.set.record.actions, record.guard, record.length, hold.action, hold.track, hold.key, hold.isCombo])
  if (signature === line.signature) return
  line.signature = signature
  const arcs = pathLineOf(record, motion, chest, keyTimesOf(hold))
  line.guides = Object.entries(arcs).map(([arc, drawn]) => ({
    handle: arc,
    ...drawn,
    colour: ARC_COLOURS[arc],
    picked: (arc === 'hand') === (hold.track === 'hand') ? hold.key : null,
    target: null
  }))
}

/**
 * A session the viewer draws (viewer.js `edit`): a take played on its model,
 * the board's item held over it. `hold` is read every frame, so a slider moves
 * the item as it is dragged. `loadClip(file)` answers a promise of a clip, for
 * the take a path action plays on the legs.
 */
export function holdSession({ model, clip, skeleton, hold, clock, loadClip }) {
  const entity = { id: 'kimodo-hold', x: 0, y: 0, z: 0, yaw: 0, pose: null, _rigTime: 0 }
  const memory = {}
  const chestNode = rolesOf(skeleton).chest
  const upper = upperBodyOf(skeleton, chestNode)
  const lower = Object.keys(skeleton.nodes).filter(name => !upper.includes(name))
  // Leg takes by file, loaded when an action first names one; null while it loads.
  const takes = new Map()
  let hung = null
  // The drawn path, kept until its keys or the guard change, so the view does not rebuild it every frame.
  const line = { signature: '', guides: [] }
  return {
    model,
    clock,
    poseAt(seconds) {
      entity._rigTime = seconds
      applyClip(entity, clip, {})
      const record = editedRecord(hold)
      const acting = record && pathActionOf(hold)
      const motion = acting && boardMotionOf(hold, record)
      const time = acting ? boardTimeOf(hold, motion, seconds) : 0
      // The action's own take on the hips and legs, as the game plays it, once it has loaded.
      const legs = acting && legTakeOf(hold, motion, time)
      const legClip = legs && takes.get(legs.file)
      if (legs && !takes.has(legs.file)) {
        takes.set(legs.file, null)
        loadClip(legs.file).then(loaded => takes.set(legs.file, loaded))
      }
      if (legClip) mixLayer(entity, legClip, lower, legs.time, 1)
      const now = acting ? recordAlong(record, motion, time) : record
      const held = now && heldPose({ record: now, skeleton, pose: entity.pose, seconds, memory })
      hung = held?.attachment ?? null
      if (acting) keepLine(line, hold, record, motion, placeOf(skeleton, entity.pose, chestNode))
      const follow = acting && held ? [followOf(skeleton, now.guard, record.guard, acting.body ?? FOLLOW)] : []
      if (held) applyConstraints(entity, skeleton, [...follow, ...held.constraints], 1 / 60)
      return entity.pose
    },
    handles: () => [],
    guides: () => (pathActionOf(hold) ? line.guides : []),
    get hold() {
      return hung
    }
  }
}

/** The record's sliders: `[path, label, min, max, step]`, a path into the record. */
const RECORD_SLIDERS = [
  [['weight'], 'weight', 0, 1, 0.05],
  [['guard', 'distance'], 'distance', 0, 0.7, 0.01],
  [['guard', 'height'], 'height', -0.8, 0.4, 0.01],
  [['guard', 'side'], 'side', -0.2, 0.5, 0.01]
]
const AIM_SLIDERS = [
  [['guard', 'pitch'], 'pitch', -90, 90, 1],
  [['guard', 'yaw'], 'yaw', -90, 90, 1],
  [['guard', 'roll'], 'roll', -180, 180, 1]
]
const MOTION_SLIDERS = [
  [['motion', 'stiffness'], 'spring', 0, 200, 1],
  [['motion', 'damping'], 'damping', 0, 30, 0.5],
  [['motion', 'sway'], 'sway', 0, 0.06, 0.002],
  [['motion', 'swaySpeed'], 'sway speed', 0, 2, 0.05]
]
/** A grip part's sliders, by its place in the edit `[across, along, depth, roll]`. */
const GRIP_SLIDERS = [
  ['across', -0.15, 0.15, 0.005],
  ['along', -0.3, 0.3, 0.005],
  ['depth', -0.15, 0.15, 0.005],
  ['roll', -180, 180, 1]
]

/**
 * The hold rows: the item, a slider per setting once an item is held, the
 * grip's own sliders with Save, then the path board's rows. `items` are the
 * item names with a hold record; `actions` is `{ pickItem(item), save(),
 * redraw(), saveSet() }`.
 */
export function holdRows(ui, hold, items, actions, note = '') {
  const record = hold.record
  const recordRow = ([path, label, min, max, step]) => {
    const [group, key] = path.length === 2 ? path : [null, path[0]]
    const owner = group ? (record[group] ??= {}) : record
    return liveSlider(ui, label, min, max, step, owner[key] ?? 0, value => (owner[key] = value))
  }
  const partRows = part => [
    ui.text(part === 'mount' ? 'Where it sits on the bone:' : `${part} hand on the item:`, { dim: true }),
    ...GRIP_SLIDERS.map(([label, min, max, step], index) =>
      liveSlider(ui, label, min, max, step, hold.edits[part]?.[index] ?? 0, value => {
        const edit = [...(hold.edits[part] ?? [0, 0, 0, 0])]
        edit[index] = value
        hold.edits[part] = edit
      })
    )
  ]
  const itemRows = record
    ? [
        ...RECORD_SLIDERS.map(recordRow),
        ...(record.grip.sockets ? AIM_SLIDERS.map(recordRow) : []),
        ...MOTION_SLIDERS.map(recordRow),
        ...gripParts(record.grip).flatMap(partRows),
        ui.button('Save hold', actions.save, { primary: true }),
        ...(note ? [ui.text(note, { dim: true })] : []),
        ...pathRows(ui, hold, record, { redraw: actions.redraw, save: actions.saveSet }, note)
      ]
    : []
  return [
    ui.text(items.length ? 'Hold an item over the take:' : `No items: put <item>.hold.json in ${ITEMS}/.`, { dim: true }),
    ...(items.length
      ? [ui.select({ k: 'hold', options: [{ value: 'none', label: 'nothing' }, ...items], value: hold.item, onChange: actions.pickItem })]
      : []),
    ...itemRows
  ]
}
