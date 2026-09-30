/**
 * Game UI controls: what a panel's HTML offers, read from its attributes.
 *
 * A component writes `data-ui-control` and its siblings (see components.js), and
 * this file reads them back with no DOM. That is how a headless test lists a
 * panel's controls, how keyboard focus finds the next one, and how a focus ring
 * is added to the HTML before it is written. All functions are pure.
 *
 * A control is `{ kind, action, label, value, isDisabled, isPassive, triggers, options, min, max, step }`.
 * A passive control (`data-passive`) can be clicked but is never focused: the dismiss layer behind a menu.
 * `triggers` are the DOM events that raise it: its kind's own, unless `data-trigger` lists others.
 * `value` is a boolean for a toggle, a number for a slider and text otherwise.
 */

const CONTROL_TAG = /<[a-z][a-z0-9]*\b[^>]*\sdata-ui-control="[^"]*"[^>]*>/g
const ATTRIBUTE = /\s([\w-]+)(?:="([^"]*)")?/g

const UNESCAPES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }
const unescapeHtml = text => text.replace(/&(?:lt|gt|quot|#39|amp);/g, entity => UNESCAPES[entity])

/** Attribute name → text for one opening tag; a bare attribute reads as `''`. */
const attributesFrom = tagText =>
  Object.fromEntries([...tagText.replace(/^<\w+/, '').matchAll(ATTRIBUTE)].map(([, name, value]) => [name, unescapeHtml(value ?? '')]))

/** How each kind reads its `data-value`. */
const VALUE_READERS = {
  toggle: text => text === 'true',
  slider: text => Number(text)
}

function controlFrom(tagText) {
  const attributes = attributesFrom(tagText)
  const kind = attributes['data-ui-control']
  return {
    kind,
    action: attributes['data-action'] ?? '',
    label: attributes['data-label'] ?? '',
    value: (VALUE_READERS[kind] ?? (text => text))(attributes['data-value'] ?? ''),
    isDisabled: 'data-disabled' in attributes,
    isPassive: 'data-passive' in attributes,
    triggers: (attributes['data-trigger'] ?? TRIGGER[kind] ?? '').split(' ').filter(Boolean),
    options: attributes['data-options'] ? JSON.parse(attributes['data-options']) : [],
    min: Number(attributes['data-min'] ?? 0),
    max: Number(attributes['data-max'] ?? 1),
    step: Number(attributes['data-step'] ?? 0.1)
  }
}

/** The DOM event that acts on each kind of control. A kind absent here is not acted on. */
export const TRIGGER = {
  button: 'click',
  tab: 'click',
  slot: 'click',
  row: 'click',
  toggle: 'change',
  slider: 'input',
  select: 'change',
  text: 'input',
  target: 'click'
}

/** The controls in a panel's HTML, in document order. */
export const controlsOf = html => [...html.matchAll(CONTROL_TAG)].map(([tagText]) => controlFrom(tagText))

/** The HTML with `data-focus` on its `index`-th control, so CSS draws the focus ring. */
export function withFocus(html, index) {
  if (index < 0) return html
  let seen = -1
  return html.replace(CONTROL_TAG, tagText => (++seen === index ? tagText.replace(/^<\w+/, '$& data-focus') : tagText))
}

/** Whether keyboard focus may rest on a control: not disabled, and not a passive layer. */
export const isFocusable = control => !control.isDisabled && !control.isPassive

/** The nearest focusable control from `from` in a direction (1 or -1), wrapping. -1 when none is. */
export function nextEnabled(controls, from, direction) {
  for (let step = 1; step <= controls.length; step++) {
    const index = (((from + direction * step) % controls.length) + controls.length) % controls.length
    if (isFocusable(controls[index])) return index
  }
  return -1
}

/** How each kind steps its value one notch. A kind absent here has no notch. */
const STEPPERS = {
  slider: (control, direction) => Number(Math.min(Math.max(control.value + direction * control.step, control.min), control.max).toFixed(6)),
  select: (control, direction) => {
    const from = control.options.indexOf(control.value)
    return control.options[(from + direction + control.options.length) % control.options.length]
  }
}

/** The value one notch along, or `undefined` when this kind of control has none. */
export const steppedValue = (control, direction) => STEPPERS[control.kind]?.(control, direction)

const DRAG_TAG = /<[a-z][a-z0-9]*\b[^>]*\sdata-drag="[^"]*"[^>]*>/g
const DROP_TAG = /<[a-z][a-z0-9]*\b[^>]*\sdata-drop="[^"]*"[^>]*>/g

/** The payload of each draggable element in a panel's HTML, in order. */
export const dragsOf = html => [...html.matchAll(DRAG_TAG)].map(([tagText]) => attributesFrom(tagText)['data-drag'])

/** The drop zones in a panel's HTML, in order: `{ action, value }`. */
export const dropsOf = html =>
  [...html.matchAll(DROP_TAG)].map(([tagText]) => attributesFrom(tagText)).map(attributes => ({ action: attributes['data-drop'], value: attributes['data-drop-value'] ?? '' }))
