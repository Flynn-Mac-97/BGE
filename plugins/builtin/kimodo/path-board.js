/**
 * Kimodo's path board: a path action (animation-states/guard-path.js) built
 * over the hold board's item. The item's hold record names its set
 * (`set: 'one-handed'`); the board reads `assets/animation/sets/<set>.set.json`,
 * plays the picked action over the take, draws the path the item's tip takes,
 * and changes one key at a time. Save writes the set back.
 *
 * The board's part of the hold (hold-board.js) is:
 *   {
 *     set: { name, record } | null,   the item's set as read, changed in place by the sliders
 *     action: 'none' | name,          the path action played over the take
 *     key: 0,                         the key the sliders change
 *     isPinned: false                 true holds the view at that key's time
 *   }
 */
import { curveNames } from '../../../engine/curves.js'
import { FOLLOW, guardAt, guardCurveOf } from '../animation-states/guard-path.js'
import { liveSlider } from './live-slider.js'

/** Where set files are, as a game keeps them. */
export const SETS = 'assets/animation/sets'

/** A set's file. */
export const setFileOf = name => `${SETS}/${name}.set.json`

/** Seconds the view rests on the path's end before it plays again. */
const REST_SECONDS = 0.5

/** The path action the board plays, `{ path, body }`, or null when none is picked. */
export function pathActionOf(hold) {
  const action = hold.set?.record.actions?.[hold.action]
  return action?.path?.length ? { path: action.path, body: action.body ?? FOLLOW } : null
}

/** Where along the path the view is at `seconds`: the picked key's time when pinned, else played over and over. */
export function pathTimeOf(hold, path, seconds) {
  if (hold.isPinned) return path[Math.min(hold.key, path.length - 1)].at
  return seconds % (path.at(-1).at + REST_SECONDS)
}

/** A set as text: each path key on one line, as the files are written by hand. */
export function setText(set) {
  const keys = []
  const text = JSON.stringify(set, (name, value) => (name === 'path' ? value.map(key => `@key${keys.push(JSON.stringify(key)) - 1}@`) : value), 2)
  return text.replace(/"@key(\d+)@"/g, (_, index) => keys[Number(index)]) + '\n'
}

/** The guard sliders: `[field, min, max, step]`, metres and degrees. */
const GUARD_SLIDERS = [
  ['distance', -0.2, 0.8, 0.01],
  ['height', -0.9, 0.9, 0.01],
  ['side', -0.6, 0.6, 0.01],
  ['pitch', -180, 180, 1],
  ['yaw', -180, 180, 1],
  ['roll', -180, 180, 1]
]

/** Add a key after the picked one, halfway to the next, where the path already is, so the motion does not change. */
function addKey(hold, record) {
  const path = pathActionOf(hold).path
  const key = path[hold.key]
  const next = path[hold.key + 1]
  const at = next ? (key.at + next.at) / 2 : key.at + 0.2
  const guard = guardAt(guardCurveOf(path, record.guard), at)
  path.splice(hold.key + 1, 0, { at: Number(at.toFixed(3)), guard, ...(key.ease ? { ease: key.ease } : {}) })
  hold.key += 1
}

/** Remove the picked key; a path keeps two. */
function removeKey(hold) {
  const path = pathActionOf(hold).path
  if (path.length <= 2) return
  path.splice(hold.key, 1)
  hold.key = Math.min(hold.key, path.length - 1)
}

/** The picked key's rows: its time, how it leaves for the next key, and its guard. */
function keyRows(ui, hold, record, path) {
  const key = path[hold.key]
  // A key's time stays between its neighbours', so the keys stay in order.
  const earliest = hold.key ? path[hold.key - 1].at + 0.01 : 0
  const latest = path[hold.key + 1] ? path[hold.key + 1].at - 0.01 : 3
  key.guard ??= {}
  return [
    liveSlider(ui, 'at', earliest, latest, 0.01, key.at, value => (key.at = value)),
    ui.select({
      k: 'ease',
      options: curveNames().eases,
      value: key.ease ?? 'linear',
      onChange: ease => (key.ease = ease)
    }),
    ...GUARD_SLIDERS.map(([field, min, max, step]) =>
      liveSlider(ui, field, min, max, step, key.guard[field] ?? record.guard[field] ?? 0, value => (key.guard[field] = value))
    )
  ]
}

/**
 * The path rows: the set's path actions, and for the one picked its keys and
 * sliders and Save. `actions` is `{ redraw(), save() }`.
 */
export function pathRows(ui, hold, record, actions, note = '') {
  if (!record?.set) return []
  if (!hold.set) return [ui.text(`No set file: ${setFileOf(record.set)}. Copy it from the game to build its paths here.`, { dim: true })]
  const names = Object.keys(hold.set.record.actions ?? {}).filter(name => hold.set.record.actions[name].path)
  const acting = pathActionOf(hold)
  const pick = change => () => {
    change()
    actions.redraw()
  }
  return [
    ui.text(`Path actions in set ${hold.set.name}:`, { dim: true }),
    ui.select({
      k: 'action',
      options: [{ value: 'none', label: 'none' }, ...names],
      value: hold.action,
      onChange: name => pick(() => Object.assign(hold, { action: name, key: 0 }))()
    }),
    ...(acting
      ? [
          ui.row(
            acting.path.map((key, index) =>
              ui.button(String(index + 1), pick(() => (hold.key = index)), { small: true, primary: index === hold.key })
            )
          ),
          ui.row([
            ui.button('Add key', pick(() => addKey(hold, record)), { small: true }),
            ui.button('Remove key', pick(() => removeKey(hold)), { small: true }),
            ui.button(hold.isPinned ? 'Play' : 'Stop at key', pick(() => (hold.isPinned = !hold.isPinned)), { small: true, primary: hold.isPinned })
          ]),
          ...keyRows(ui, hold, record, acting.path),
          ui.text('How much the body turns after the item:', { dim: true }),
          liveSlider(ui, 'body', 0, 1, 0.05, acting.body, value => (hold.set.record.actions[hold.action].body = value)),
          ui.button('Save set', actions.save, { primary: true }),
          ...(note ? [ui.text(note, { dim: true })] : [])
        ]
      : [])
  ]
}
