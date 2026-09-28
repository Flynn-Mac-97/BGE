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
 *   }
 */
import { applyClip } from '../rig-animation.js'
import { applyConstraints } from '../rig-animation/constraints.js'
import { heldPose } from '../animation-states/held-items.js'
import { add } from '../game-maths/space.js'
import { multiply, turnAbout } from '../game-maths/turns.js'

const DEGREES = Math.PI / 180

/** Where the items' hold records are. */
export const ITEMS = 'assets/models/items'

/** An item's hold record file. */
export const holdFileOf = item => `${ITEMS}/${item}.hold.json`

/** The board's hold before any item is picked. */
export function newHold() {
  return { item: 'none', record: null, edits: {} }
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

/**
 * A session the viewer draws (viewer.js `edit`): a take played on its model,
 * the board's item held over it. `hold` is read every frame, so a slider moves
 * the item as it is dragged.
 */
export function holdSession({ model, clip, skeleton, hold, clock }) {
  const entity = { id: 'kimodo-hold', x: 0, y: 0, z: 0, yaw: 0, pose: null, _rigTime: 0 }
  const memory = {}
  let hung = null
  return {
    model,
    clock,
    poseAt(seconds) {
      entity._rigTime = seconds
      applyClip(entity, clip, {})
      const record = editedRecord(hold)
      const held = record && heldPose({ record, skeleton, pose: entity.pose, seconds, memory })
      hung = held?.attachment ?? null
      if (held) applyConstraints(entity, skeleton, held.constraints, 1 / 60)
      return entity.pose
    },
    handles: () => [],
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

/** A slider that calls `set(value)` as it is dragged and shows the value beside it. */
function liveSlider(ui, label, min, max, step, value, set) {
  const element = ui.slider({
    k: label,
    min,
    max,
    step,
    value,
    onChange: changed => {
      set(changed)
      element.lastChild.textContent = String(changed)
    }
  })
  return element
}

/**
 * The hold rows: the item, a slider per setting once an item is held, and the
 * grip's own sliders with Save. `items` are the item names with a hold record;
 * `actions` is `{ pickItem(item), save() }`.
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
        ...(note ? [ui.text(note, { dim: true })] : [])
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
