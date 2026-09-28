/**
 * Kimodo's path board: a path action (animation-states/guard-path.js) built
 * over the hold board's item. The item's hold record names its set
 * (`set: 'one-handed'`); the board reads `assets/animation/sets/<set>.set.json`,
 * plays the picked action over the take, draws the arc the hand takes and
 * the arc the item's tip takes, and changes one key of one track at a time.
 * Save writes the set back.
 *
 * The board's part of the hold (hold-board.js) is:
 *   {
 *     set: { name, record } | null,   the item's set as read, changed in place by the sliders
 *     action: 'none' | name,          the path action played over the take
 *     track: 'hand' | 'blade',        the track the key buttons and sliders change
 *     key: 0,                         the key of that track the sliders change
 *     isPinned: false,                true holds the view at that key's time
 *     isCombo: false                  true plays the action and every action it chains into
 *   }
 */
import { curveNames } from '../../../engine/curves.js'
import { FOLLOW, TRACK_FIELDS, comboOf, isPathAction, motionOf, tracksOf } from '../animation-states/guard-path.js'
import { liveSlider } from './live-slider.js'

/** Where set files are, as a game keeps them. */
export const SETS = 'assets/animation/sets'

/** A set's file. */
export const setFileOf = name => `${SETS}/${name}.set.json`

/** Seconds the view rests on the end before it plays again. */
const REST_SECONDS = 0.5

/** The path action the board plays, or null when none is picked. */
export function pathActionOf(hold) {
  const action = hold.set?.record.actions?.[hold.action]
  return isPathAction(action) ? action : null
}

/** The motion the view plays: the picked action alone, or the combo it starts. */
export function boardMotionOf(hold, record) {
  if (hold.isCombo) return comboOf(hold.set.record.actions, hold.action, record.guard)
  return motionOf(pathActionOf(hold), record.guard)
}

/**
 * The take a path action plays under its keys at `time` along `motion`, as
 * the game plays it: `{ file, time }` in the take, or null. In a combo, the
 * latest step that names a take keeps playing through the steps after it.
 */
export function legTakeOf(hold, motion, time) {
  const actions = hold.set.record.actions
  const steps = motion.steps ?? [{ name: hold.action, from: 0 }]
  const step = steps.filter(each => each.from <= time && actions[each.name]?.clips?.length).at(-1)
  if (!step) return null
  const action = actions[step.name]
  const folder = hold.set.record.folder
  return { file: `${folder ? `${folder}/` : ''}${action.clips[0]}.json`, time: (time - step.from) * (action.speed ?? 1) }
}

/**
 * The picked track's keys; a path action's one list serves both tracks. A
 * track the action leaves out is made, still from start to end, so it can be
 * keyed.
 */
function keysOf(hold) {
  const action = pathActionOf(hold)
  if (!action.path) action[hold.track] ??= [{ at: 0, guard: {} }, { at: motionOf(action, {}).duration, guard: {} }]
  return tracksOf(action)[hold.track]
}

/** Where along the motion the view is at `seconds`: the picked key's time when pinned, else played over and over. */
export function boardTimeOf(hold, motion, seconds) {
  if (hold.isPinned) return keysOf(hold)[Math.min(hold.key, keysOf(hold).length - 1)].at
  return seconds % (motion.duration + REST_SECONDS)
}

/** The times of the picked action's keys, by track, for the drawn arcs. */
export const keyTimesOf = hold => {
  const tracks = tracksOf(pathActionOf(hold))
  return { hand: tracks.hand.map(key => key.at), blade: tracks.blade.map(key => key.at) }
}

/** A set as text: each key on one line, as the files are written by hand. */
export function setText(set) {
  const keys = []
  const isKeyList = name => name === 'path' || name in TRACK_FIELDS
  const text = JSON.stringify(set, (name, value) => (isKeyList(name) ? value.map(key => `@key${keys.push(JSON.stringify(key)) - 1}@`) : value), 2)
  return text.replace(/"@key(\d+)@"/g, (_, index) => keys[Number(index)]) + '\n'
}

/** Each guard field's slider range: `[min, max, step]`, metres and degrees. */
const FIELD_RANGES = {
  distance: [-0.2, 0.8, 0.01],
  height: [-0.9, 0.9, 0.01],
  side: [-0.6, 0.6, 0.01],
  pitch: [-180, 180, 1],
  yaw: [-180, 180, 1],
  roll: [-180, 180, 1]
}

/** Add a key after the picked one, halfway to the next, where the motion already is, so it does not change. */
function addKey(hold, record) {
  const keys = keysOf(hold)
  const key = keys[hold.key]
  const next = keys[hold.key + 1]
  const at = Number((next ? (key.at + next.at) / 2 : key.at + 0.2).toFixed(3))
  const guard = motionOf(pathActionOf(hold), record.guard).guardAt(at)
  const fields = TRACK_FIELDS[hold.track]
  keys.splice(hold.key + 1, 0, { at, guard: Object.fromEntries(fields.map(field => [field, Number(guard[field].toFixed(3))])), ...(key.ease ? { ease: key.ease } : {}) })
  hold.key += 1
}

/** Remove the picked key; a track keeps two. */
function removeKey(hold) {
  const keys = keysOf(hold)
  if (keys.length <= 2) return
  keys.splice(hold.key, 1)
  hold.key = Math.min(hold.key, keys.length - 1)
}

/** The picked key's rows: its time, how its time runs to the next key, and its track's fields. */
function keyRows(ui, hold, record) {
  const keys = keysOf(hold)
  const key = keys[Math.min(hold.key, keys.length - 1)]
  // A key's time stays between its neighbours', so the keys stay in order.
  const earliest = hold.key ? keys[hold.key - 1].at + 0.01 : 0
  const latest = keys[hold.key + 1] ? keys[hold.key + 1].at - 0.01 : 3
  key.guard ??= {}
  return [
    liveSlider(ui, 'at', earliest, latest, 0.01, key.at, value => (key.at = value)),
    ui.select({ k: 'ease', options: curveNames().eases, value: key.ease ?? 'linear', onChange: ease => (key.ease = ease) }),
    ...TRACK_FIELDS[hold.track].map(field =>
      liveSlider(ui, field, ...FIELD_RANGES[field], key.guard[field] ?? record.guard[field] ?? 0, value => (key.guard[field] = value))
    )
  ]
}

/** The action's own rows: how much the body follows, and what it chains into and when. */
function actionRows(ui, hold, names, pick) {
  const action = pathActionOf(hold)
  return [
    ui.text('How much the body turns after the item:', { dim: true }),
    liveSlider(ui, 'body', 0, 1, 0.05, action.body ?? FOLLOW, value => (action.body = value)),
    ui.text('A second press chains into:', { dim: true }),
    ui.select({
      k: 'next',
      options: [{ value: '', label: 'nothing' }, ...names.filter(name => name !== hold.action)],
      value: action.next ?? '',
      onChange: name => pick(() => (name ? (action.next = name) : delete action.next))()
    }),
    ...(action.next ? [liveSlider(ui, 'chain at', 0, motionOf(action, {}).duration, 0.01, action.link ?? motionOf(action, {}).duration, value => (action.link = value))] : [])
  ]
}

/**
 * The path rows: the set's path actions, and for the one picked its tracks,
 * keys and sliders, and Save. `actions` is `{ redraw(), save() }`.
 */
export function pathRows(ui, hold, record, actions, note = '') {
  if (!record?.set) return []
  if (!hold.set) return [ui.text(`No set file: ${setFileOf(record.set)}. Copy it from the game to build its paths here.`, { dim: true })]
  const names = Object.keys(hold.set.record.actions ?? {}).filter(name => isPathAction(hold.set.record.actions[name]))
  const pick = change => () => {
    change()
    actions.redraw()
  }
  const toggle = (label, field) => ui.button(label, pick(() => (hold[field] = !hold[field])), { small: true, primary: hold[field] })
  return [
    ui.text(`Path actions in set ${hold.set.name}:`, { dim: true }),
    ui.select({
      k: 'action',
      options: [{ value: 'none', label: 'none' }, ...names],
      value: hold.action,
      onChange: name => pick(() => Object.assign(hold, { action: name, key: 0 }))()
    }),
    ...(pathActionOf(hold)
      ? [
          ui.row(
            Object.entries({ hand: 'Hand arc', blade: 'Blade arc' }).map(([track, label]) =>
              ui.button(label, pick(() => Object.assign(hold, { track, key: 0 })), { small: true, primary: hold.track === track })
            )
          ),
          ui.row(keysOf(hold).map((key, index) => ui.button(String(index + 1), pick(() => (hold.key = index)), { small: true, primary: index === hold.key }))),
          ui.row([
            ui.button('Add key', pick(() => addKey(hold, record)), { small: true }),
            ui.button('Remove key', pick(() => removeKey(hold)), { small: true }),
            toggle('Stop at key', 'isPinned'),
            toggle('Play combo', 'isCombo')
          ]),
          ...keyRows(ui, hold, record),
          ...actionRows(ui, hold, names, pick),
          ui.button('Save set', actions.save, { primary: true }),
          ...(note ? [ui.text(note, { dim: true })] : [])
        ]
      : [])
  ]
}
