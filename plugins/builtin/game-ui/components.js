/**
 * Game UI components: pure functions from values to an HTML string.
 *
 * Text arguments are escaped. Children are HTML strings from other kit
 * functions, joined as given, so a game builds a panel by nesting calls:
 *
 *   stack([heading('Shop'), button('Buy', { action: 'buy', kind: 'primary' })])
 *
 * A control carries `data-ui-control` (its kind), `data-action` (what a panel's
 * `on` table is keyed by), `data-value`, `data-label` and `data-disabled`.
 * Routing, keyboard focus and the headless `controls` list all read those
 * attributes, so a component states them once and every reader agrees.
 */
import { assetURL } from '../../../engine/asset-path.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** The text with the five HTML-special characters made safe. */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ESCAPES[character])

/** ` name="value"` for each entry; `true` is a bare attribute; `false`, `null` and `undefined` are left out. */
export function attributesOf(record) {
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join('')
}

/** Elements with no closing tag. */
const VOID_TAGS = new Set(['input', 'img'])

const tag = (name, attributes, inner = '') =>
  VOID_TAGS.has(name) ? `<${name}${attributesOf(attributes)}>` : `<${name}${attributesOf(attributes)}>${inner}</${name}>`
const join = children => [].concat(children ?? []).join('')

/** A CSS custom property for the style attribute, or nothing. Only plain numbers and lengths pass. */
const variable = (name, value) => (/^[\w.%-]+$/.test(String(value ?? '')) ? `--${name}:${value}` : undefined)
const styleOf = (...declarations) => declarations.filter(Boolean).join(';') || undefined

/** `{ value, label }` from a bare string or an option record. */
const optionOf = option => (typeof option === 'object' ? { value: option.value, label: option.label ?? option.value } : { value: option, label: option })

/** The attributes every control carries. */
function controlAttributes(kind, { action, value, label, isDisabled, triggers }) {
  return {
    'data-ui-control': kind,
    'data-trigger': triggers?.join(' '),
    'data-ui': action,
    'data-action': action,
    'data-value': value,
    'data-label': label,
    'data-disabled': isDisabled === true
  }
}

const layout = className => (children, { gap, align, columns } = {}) =>
  tag('div', { class: className, style: styleOf(variable('gap', gap), variable('columns', columns)), 'data-align': align }, join(children))

const field = (label, control) =>
  tag('label', { class: 'ui-field' }, tag('span', { class: 'ui-field-label' }, escapeHtml(label)) + control)

const components = {
  stack: layout('ui-stack'),
  row: layout('ui-row'),
  grid: layout('ui-grid'),
  scroll: (children, { height } = {}) => tag('div', { class: 'ui-scroll', style: styleOf(variable('height', height)) }, join(children)),
  divider: () => '<hr class="ui-divider">',
  spacer: (size = 1) => tag('span', { class: 'ui-spacer', style: styleOf(variable('size', size)) }),
  panel: (children, { title } = {}) =>
    tag('section', { class: 'ui-panel' }, (title ? tag('h2', { class: 'ui-panel-title' }, escapeHtml(title)) : '') + join(children)),

  heading: (text, { level = 1 } = {}) => tag('h' + Math.min(Math.max(level, 1), 3), { class: 'ui-heading', 'data-level': level }, escapeHtml(text)),
  text: (text, { tone } = {}) => tag('p', { class: 'ui-text', 'data-tone': tone }, escapeHtml(text)),
  icon: glyph => tag('span', { class: 'ui-icon' }, escapeHtml(glyph)),
  portrait: (source, { size, alt = '' } = {}) => tag('img', { class: 'ui-portrait', src: assetURL(source), alt, style: styleOf(variable('size', size)) }),
  keyHint: (key, label) => tag('span', { class: 'ui-key' }, tag('kbd', {}, escapeHtml(key)) + escapeHtml(label)),
  badge: (text, { tone } = {}) => tag('span', { class: 'ui-badge', 'data-tone': tone }, escapeHtml(text)),
  toast: (text, { tone } = {}) => tag('div', { class: 'ui-toast', role: 'status', 'data-tone': tone }, escapeHtml(text)),
  tooltip: (content, tip) => tag('span', { class: 'ui-tip' }, join(content) + tag('span', { class: 'ui-tip-body' }, escapeHtml(tip))),
  modal: (children, { title } = {}) =>
    tag('div', { class: 'ui-modal-scrim' }, tag('section', { class: 'ui-panel ui-modal', role: 'dialog' },
      (title ? tag('h2', { class: 'ui-panel-title' }, escapeHtml(title)) : '') + join(children))),

  button: (label, { action, value, kind, icon, isDisabled, triggers } = {}) =>
    tag('button', { class: 'ui-button', type: 'button', 'data-kind': kind, ...controlAttributes('button', { action, value, label, isDisabled, triggers }) },
      (icon ? components.icon(icon) : '') + escapeHtml(label)),

  toggle: (label, { action, isOn = false, isDisabled } = {}) =>
    tag('label', { class: 'ui-toggle', ...controlAttributes('toggle', { action, value: String(isOn), label, isDisabled }) },
      tag('input', { type: 'checkbox', checked: isOn }) + tag('span', {}, escapeHtml(label))),

  slider: (label, { action, value = 0, min = 0, max = 1, step = 0.1, isDisabled } = {}) =>
    tag('label', { class: 'ui-field', 'data-min': min, 'data-max': max, 'data-step': step, ...controlAttributes('slider', { action, value, label, isDisabled }) },
      tag('span', { class: 'ui-field-label' }, escapeHtml(label))
      + tag('span', { class: 'ui-field-row' }, tag('input', { class: 'ui-slider', type: 'range', min, max, step, value }) + tag('span', {}, escapeHtml(value)))),

  select: (label, { action, value, options = [], isDisabled } = {}) => {
    const choices = options.map(optionOf)
    const inner = choices.map(choice => tag('option', { value: choice.value, selected: choice.value === value }, escapeHtml(choice.label))).join('')
    return tag('label', { class: 'ui-field', 'data-options': JSON.stringify(choices.map(choice => choice.value)), ...controlAttributes('select', { action, value, label, isDisabled }) },
      tag('span', { class: 'ui-field-label' }, escapeHtml(label)) + tag('select', { class: 'ui-select' }, inner))
  },

  textInput: (label, { action, value = '', placeholder, isDisabled } = {}) =>
    tag('label', { class: 'ui-field', ...controlAttributes('text', { action, value, label, isDisabled }) },
      tag('span', { class: 'ui-field-label' }, escapeHtml(label)) + tag('input', { class: 'ui-input', type: 'text', value, placeholder })),

  tabs: (items, { action, value } = {}) =>
    tag('div', { class: 'ui-tabs', role: 'tablist' }, items.map(optionOf).map(item =>
      tag('button', { class: 'ui-tab', type: 'button', 'data-selected': item.value === value, ...controlAttributes('tab', { action, value: item.value, label: item.label }) }, escapeHtml(item.label))).join('')),

  bar: (value, { max = 1, label, kind } = {}) => {
    const fraction = Math.min(Math.max(Number(value) / Number(max) || 0, 0), 1)
    const head = label ? tag('div', { class: 'ui-bar-head' }, tag('span', {}, escapeHtml(label)) + tag('span', {}, `${escapeHtml(value)} / ${escapeHtml(max)}`)) : ''
    return tag('div', { class: 'ui-bar', 'data-kind': kind, role: 'progressbar', 'aria-valuenow': value, 'aria-valuemax': max },
      head + tag('div', { class: 'ui-bar-track' }, tag('div', { class: 'ui-bar-fill', style: `--fraction:${fraction}` })))
  },

  slot: ({ glyph, image, count, action, value, label, isSelected, isDisabled, triggers } = {}) => {
    const inner = (image ? tag('img', { class: 'ui-portrait', src: assetURL(image), alt: label ?? '' }) : tag('span', { class: 'ui-slot-glyph' }, escapeHtml(glyph ?? '')))
      + (count > 1 ? tag('span', { class: 'ui-slot-count' }, escapeHtml(count)) : '')
    const attributes = { class: 'ui-slot', 'data-selected': isSelected === true }
    if (!action) return tag('div', attributes, inner)
    return tag('button', { ...attributes, type: 'button', ...controlAttributes('slot', { action, value, label, isDisabled, triggers }) }, inner)
  },

  /** Any element: a tag from a safe set of characters, extra attributes, and children. The way to CSS the kit has no class for. */
  element: (children, { as = 'div', attributes = {} } = {}) => tag(/^[a-z][a-z0-9-]*$/.test(as) ? as : 'div', attributes, join(children)),

  /**
   * Any element as a target for a game's own event. `action` names the event,
   * `triggers` lists the DOM events that raise it (`click`, `dblclick`,
   * `contextmenu`, `pointerdown`, `pointerup`, `pointerover`, `pointerout`).
   * `attributes` are extra attributes, such as `data-hot` for the theme to style.
   */
  target: (children, { action, value, label, triggers = ['click'], as = 'div', isDisabled, attributes = {} } = {}) =>
    tag(/^[a-z][a-z0-9-]*$/.test(as) ? as : 'div', { ...attributes, ...controlAttributes('target', { action, value, label, isDisabled, triggers }) }, join(children)),

  list: (items, { action, triggers } = {}) =>
    tag('div', { class: 'ui-list' }, items.map(item => {
      const inner = tag('span', {}, escapeHtml(item.label)) + (item.detail === undefined ? '' : tag('span', { 'data-tone': 'quiet' }, escapeHtml(item.detail)))
      const attributes = { class: 'ui-row-item', 'data-selected': item.isSelected === true }
      if (!action) return tag('div', attributes, inner)
      return tag('button', { ...attributes, type: 'button', ...controlAttributes('row', { action, value: item.value, label: item.label, isDisabled: item.isDisabled, triggers }) }, inner)
    }).join(''))
}

/**
 * Add the caller's `class` and `style` to the first tag of `html`. Every
 * component takes them, so a game restyles one element with no new rule. The
 * caller's style comes last and so wins over the kit's inline style. A `key`
 * becomes `data-key`; changing it replaces the element, which replays its CSS animation.
 */
export function decorate(html, options) {
  if (!options?.class && !options?.style && options?.key === undefined) return html
  return html.replace(/^<([a-z0-9-]+)((?:\s[^>]*)?)>/, (whole, name, attributes) => {
    let head = attributes
    if (options.class) head = /\sclass="/.test(head) ? head.replace(/(\sclass=")/, (match, open) => `${open}${escapeHtml(options.class)} `) : `${head} class="${escapeHtml(options.class)}"`
    if (options.key !== undefined) head += ` data-key="${escapeHtml(options.key)}"`
    if (options.style) head = /\sstyle="/.test(head) ? head.replace(/(\sstyle="[^"]*)"/, (match, open) => `${open};${escapeHtml(options.style)}"`) : `${head} style="${escapeHtml(options.style)}"`
    return `<${name}${head}>`
  })
}

/** The options record a component was called with: its last argument, when that is a plain object. */
const optionsOf = args => {
  const last = args.at(-1)
  return last && typeof last === 'object' && !Array.isArray(last) ? last : undefined
}

/** The components, each accepting `class` and `style` in its options. */
export const kit = Object.fromEntries(
  Object.entries(components).map(([name, component]) => [name, (...args) => decorate(component(...args), optionsOf(args))])
)
