/**
 * Game UI menu: keyboard focus over the panel that owns the keys.
 *
 * The last interactive panel with a control that can be used takes the menu
 * actions. Each is an input action, so a player, a bot and a test press the
 * same thing; a game rebinds them with `context.input.bind`. Focus is an index
 * into the panel's controls, stored on the panel, so the mark survives a
 * redraw that changes the HTML. Runs on the fixed step.
 */
import { nextEnabled, steppedValue } from './controls.js'
import { makeUiEvent, refresh } from './records.js'

/** The input actions that move focus, and the way each moves it. */
const FOCUS_DIRECTIONS = { uiUp: -1, uiLeft: -1, uiDown: 1, uiRight: 1 }

/** Left and right also step a slider or a select; up and down only move focus. */
const STEPPING_ACTIONS = new Set(['uiLeft', 'uiRight'])

/** The keys the menu actions start on: the keyboard, and a gamepad's virtual codes (gamepad.js). */
const MENU_KEYS = {
  uiUp: ['ArrowUp', 'GamepadUp'],
  uiDown: ['ArrowDown', 'GamepadDown'],
  uiLeft: ['ArrowLeft', 'GamepadLeft'],
  uiRight: ['ArrowRight', 'GamepadRight'],
  uiConfirm: ['Enter', 'NumpadEnter', 'GamepadA'],
  uiBack: ['Escape', 'GamepadB']
}

/** What confirming a focused control reports, by kind. A kind absent here is not confirmed. */
const CONFIRMED_VALUES = {
  button: control => control.value,
  tab: control => control.value,
  slot: control => control.value,
  row: control => control.value,
  target: control => control.value,
  toggle: control => !control.value
}

/** The `[id, panel]` that takes the menu keys (an interactive panel, or one with `takesKeys`), or undefined. */
export function scopeOf(panels) {
  return [...panels].reverse().find(([, panel]) => panel.phase !== 'leaving' && (panel.isInteractive || panel.takesKeys) && panel.lastControls.some(control => !control.isDisabled))
}

/** The focused control's index: the stored one while it still can be used, else the first that can. */
export function settledFocus(panel, controls) {
  const stored = controls[panel.focusIndex]
  return stored && !stored.isDisabled ? panel.focusIndex : nextEnabled(controls, -1, 1)
}

/** Menu actions are input actions; bind the ones a game has not. Done once, on the first step. */
export function bindMenuKeys(context, state) {
  if (state.hasBoundKeys || !context.input) return
  const known = context.input.actions()
  for (const [action, codes] of Object.entries(MENU_KEYS)) if (!known.includes(action)) context.input.bind(action, codes)
  state.hasBoundKeys = true
}

/** Apply this step's menu keys to the panel that owns them: move, step a value, confirm or go back. */
export function moveFocus(context, state) {
  if (!context.input) return
  // Read now, so a value the last handler changed is what a step or a confirm sees.
  for (const panel of state.panels.values()) if (panel.phase !== 'leaving' && (panel.isInteractive || panel.takesKeys)) refresh(panel)
  const scope = scopeOf(state.panels)
  if (!scope) return
  const [id, panel] = scope
  const controls = panel.lastControls
  panel.focusIndex = settledFocus(panel, controls)
  const focused = controls[panel.focusIndex]
  const keyEvent = (action, value, kind) => state.queue.push(makeUiEvent(id, action, value, kind, { type: 'key' }))

  if (context.input.pressed('uiBack')) keyEvent('back', undefined, 'key')
  if (context.input.pressed('uiConfirm') && focused && CONFIRMED_VALUES[focused.kind]) {
    keyEvent(focused.action, CONFIRMED_VALUES[focused.kind](focused), focused.kind)
  }

  const moved = Object.entries(FOCUS_DIRECTIONS).find(([action]) => context.input.pressed(action))
  if (!moved) return
  const [action, direction] = moved
  const stepped = STEPPING_ACTIONS.has(action) && focused ? steppedValue(focused, direction) : undefined
  if (stepped !== undefined) {
    keyEvent(focused.action, stepped, focused.kind)
    return
  }
  panel.focusIndex = nextEnabled(controls, panel.focusIndex, direction)
  state.queue.push(makeUiEvent(id, '', undefined, 'focus', { type: 'focus' }))
}
