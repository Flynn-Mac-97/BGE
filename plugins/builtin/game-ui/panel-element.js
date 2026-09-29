/**
 * Game UI panel element: the DOM one panel is made of, and the listeners both a
 * panel and the world layer put on their shadow root.
 *
 * A root keeps the game's styles and the editor's apart, reports which `data-ui`
 * element the pointer is over, and turns a person's use of a kit control into
 * one report: `report({ action, value, kind, type, x, y, target })`. Drags start here too (drag.js). Nothing
 * here runs the game's handler; the plugin queues the report and runs it on a
 * fixed step. Browser only.
 */
import { TRIGGER } from './controls.js'
import { watchDrag } from './drag.js'

/** Every DOM event a control can be triggered by. Each bubbles, so one listener per type on the root is enough. */
const EVENT_TYPES = ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointerover', 'pointerout', 'input', 'change']

/** How each kind of control reads the value a person set. Others send their `data-value`. */
const FIELD_VALUES = {
  toggle: field => field.checked,
  slider: field => Number(field.value),
  select: field => field.value,
  text: field => field.value
}

/** Report the kit control an event happened on, if that event is one of its triggers. */
function routeControlEvent(event, report) {
  const control = event.target.closest?.('[data-ui-control]')
  if (!control || control.hasAttribute('data-disabled')) return
  const kind = control.dataset.uiControl
  const triggers = (control.dataset.trigger ?? TRIGGER[kind] ?? '').split(' ')
  if (!triggers.includes(event.type)) return
  // Moving between two parts of one control is not entering or leaving it.
  if ((event.type === 'pointerover' || event.type === 'pointerout') && control.contains(event.relatedTarget)) return
  const field = control.querySelector('input, select') ?? control
  const isOwnEvent = TRIGGER[kind] === event.type
  const value = isOwnEvent && FIELD_VALUES[kind] ? FIELD_VALUES[kind](field) : control.dataset.value ?? ''
  report({ action: control.dataset.action, value, kind, type: event.type, x: event.clientX ?? 0, y: event.clientY ?? 0, target: control })
}

/**
 * Listen on a shadow root. `hover(name, target)` is called with the `data-ui`
 * name under the pointer, or null once it leaves; `report` gets each control use.
 */
export function watchRoot(root, { report, hover }) {
  root.addEventListener('pointerover', event => hover(event.target.closest?.('[data-ui]')?.dataset.ui ?? null, event.target))
  root.addEventListener('pointerout', event => { if (!event.relatedTarget || !root.contains(event.relatedTarget)) hover(null, event.target) })
  for (const type of EVENT_TYPES) root.addEventListener(type, event => routeControlEvent(event, report))
  watchDrag(root, report)
}

/** Build a panel's element. `panel.hovered` is kept up to date on the record. */
export function createPanelElement(id, panel, report) {
  const element = document.createElement('div')
  element.dataset.gameUi = id
  // The overlay lets clicks through. An interactive panel takes them back once it has content (game-ui.js).
  element.style.cssText = 'position:absolute;inset:0;pointer-events:none'
  const root = element.attachShadow({ mode: 'open' })
  watchRoot(root, { report, hover: name => { panel.hovered = name } })
  return { element, root }
}
