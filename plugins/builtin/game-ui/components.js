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

/** `value` as a share of `max`, from 0 to 1, to three decimals so an unchanged bar writes an unchanged string. */
const fractionOf = (value, max) => Math.round(Math.min(Math.max(Number(value) / Number(max) || 0, 0), 1) * 1000) / 1000

/** What a key code reads as on a keycap. A code not listed loses its `Key`, `Digit` or `Numpad` prefix. */
const KEY_NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Bksp',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  MouseLeft: 'LMB', MouseRight: 'RMB', MouseMiddle: 'MMB'
}

/** A key code as a person reads it: `KeyE` is `E`, `ArrowUp` is `↑`, `none` when there is no key. */
export const keyName = code => (code ? KEY_NAMES[code] ?? String(code).replace(/^(Key|Digit|Numpad)/, '') : 'none')

/** Up to two capital letters from a name: `Ada Lovelace` is `AL`. */
const initialsOf = name => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('')

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
    'data-disabled': isDisabled === true,
    'aria-disabled': isDisabled === true ? 'true' : undefined
  }
}

const layout = className => (children, { gap, align, columns } = {}) =>
  tag('div', { class: className, style: styleOf(variable('gap', gap), variable('columns', columns)), 'data-align': align }, join(children))

const field = (label, control) =>
  tag('label', { class: 'ui-field' }, tag('span', { class: 'ui-field-label' }, escapeHtml(label)) + control)

const components = {
  mobileControls: children => tag('div', { class: 'ui-mobile-controls' }, join(children)),
  joystick: ({ label = 'Move', left = 'left', right = 'right', up = 'up', down = 'down', deadZone = 0.2, isDisabled = false } = {}) =>
    tag('div', { class: 'ui-mobile ui-joystick', 'data-mobile': 'joystick', 'data-directions': JSON.stringify({ left, right, up, down }), 'data-dead-zone': Math.min(0.9, Math.max(0.05, Number(deadZone) || 0.2)), 'data-disabled': isDisabled, 'aria-label': label, role: 'group' }, tag('span', { class: 'ui-joystick-thumb' })),
  actionButton: (label, { action, isDisabled = false } = {}) =>
    tag('button', { type: 'button', class: 'ui-mobile ui-action-button', 'data-mobile': 'button', 'data-action': action, 'data-disabled': isDisabled, disabled: isDisabled, 'aria-label': label }, escapeHtml(label)),
  gestureArea: (children, { action = 'gesture', label = 'Gesture area', debug = false } = {}) =>
    tag('div', { class: 'ui-mobile ui-gesture-area', 'data-mobile': 'gesture', ...controlAttributes('gesture', { action, label, triggers: ['tap', 'doubletap', 'longpress', 'dragstart', 'drag', 'dragend', 'swipe', 'transformstart', 'transform', 'transformend', 'cancel'] }), 'aria-label': label }, join(children) + (debug ? '<svg class="ui-touch-debug" data-touch-debug aria-hidden="true"></svg>' : '')),
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
  icon: glyph => tag('span', { class: 'ui-icon', 'aria-hidden': 'true' }, escapeHtml(glyph)),
  portrait: (source, { size, alt = '' } = {}) => tag('img', { class: 'ui-portrait', src: assetURL(source), alt, style: styleOf(variable('size', size)) }),
  keyHint: (key, label) => tag('span', { class: 'ui-key' }, tag('kbd', {}, escapeHtml(key)) + escapeHtml(label)),
  badge: (text, { tone } = {}) => tag('span', { class: 'ui-badge', 'data-tone': tone }, escapeHtml(text)),
  toast: (text, { tone } = {}) => tag('div', { class: 'ui-toast', role: 'status', 'data-tone': tone }, escapeHtml(text)),
  tooltip: (content, tip) => tag('span', { class: 'ui-tip' }, join(content) + tag('span', { class: 'ui-tip-body' }, escapeHtml(tip))),
  modal: (children, { title } = {}) =>
    tag('div', { class: 'ui-modal-scrim' }, tag('section', { class: 'ui-panel ui-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      (title ? tag('h2', { class: 'ui-panel-title' }, escapeHtml(title)) : '') + join(children))),

  button: (label, { action, value, kind, icon, isDisabled, triggers } = {}) =>
    tag('button', { class: 'ui-button', type: 'button', 'data-kind': kind, ...controlAttributes('button', { action, value, label, isDisabled, triggers }) },
      (icon ? components.icon(icon) : '') + escapeHtml(label)),

  toggle: (label, { action, isOn = false, isDisabled } = {}) =>
    tag('label', { class: 'ui-toggle', ...controlAttributes('toggle', { action, value: String(isOn), label, isDisabled }) },
      tag('input', { type: 'checkbox', role: 'switch', checked: isOn }) + tag('span', {}, escapeHtml(label))),

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
      tag('button', { class: 'ui-tab', type: 'button', role: 'tab', 'aria-selected': String(item.value === value), 'data-selected': item.value === value, ...controlAttributes('tab', { action, value: item.value, label: item.label }) }, escapeHtml(item.label))).join('')),

  bar: (value, { max = 1, label, kind, trail = true } = {}) => {
    const fraction = fractionOf(value, max)
    const head = label ? tag('div', { class: 'ui-bar-head' }, tag('span', {}, escapeHtml(label)) + tag('span', {}, `${escapeHtml(value)} / ${escapeHtml(max)}`)) : ''
    return tag('div', { class: 'ui-bar', 'data-kind': kind, role: 'progressbar', 'aria-label': label, 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': max },
      head + tag('div', { class: 'ui-bar-track', style: `--fraction:${fraction}` }, (trail ? tag('div', { class: 'ui-bar-trail' }) : '') + tag('div', { class: 'ui-bar-fill' })))
  },

  slot: ({ glyph, image, count, action, value, label, isSelected, isDisabled, triggers } = {}) => {
    const inner = (image ? tag('img', { class: 'ui-portrait', src: assetURL(image), alt: label ?? '' }) : tag('span', { class: 'ui-slot-glyph' }, escapeHtml(glyph ?? '')))
      + (count > 1 ? tag('span', { class: 'ui-slot-count' }, escapeHtml(count)) : '')
    const attributes = { class: 'ui-slot', 'data-selected': isSelected === true, 'aria-label': label }
    if (!action) return tag('div', attributes, inner)
    return tag('button', { ...attributes, type: 'button', 'aria-pressed': String(isSelected === true), ...controlAttributes('slot', { action, value, label, isDisabled, triggers }) }, inner)
  },

  /** A circular progress: `value` of `max`, the centre reads `label` or the percent. `size` is pixels. */
  ring: (value, { max = 1, size = 64, label, kind } = {}) => {
    const fraction = fractionOf(value, max)
    return tag('div', { class: 'ui-ring', role: 'progressbar', 'aria-label': label, 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': max, 'data-kind': kind, style: `--fraction:${fraction};--size:${Number(size) || 64}px` },
      tag('span', { class: 'ui-ring-label' }, escapeHtml(label ?? `${Math.round(fraction * 100)}%`)))
  },

  /**
   * Content under a cooldown: while `remaining` seconds of `total` are left, a
   * dark wedge sweeps away clockwise and the seconds show in the middle. The
   * game reads `remaining` from engine time, so the sweep pauses with the game.
   */
  cooldown: (content, { remaining = 0, total = 1 } = {}) => {
    const isCooling = remaining > 0
    const fraction = isCooling ? fractionOf(remaining, total || 1) : 0
    const seconds = remaining >= 10 ? Math.ceil(remaining) : remaining.toFixed(1)
    return tag('div', { class: 'ui-cooldown', 'data-cooling': isCooling, style: `--fraction:${fraction}` }, join(content) + (isCooling ? tag('span', { class: 'ui-cooldown-text' }, seconds) : ''))
  },

  /** Discrete steps, such as hearts or ammo: `value` full out of `max`. */
  pips: (value, { max = 5, glyph = '●', emptyGlyph = '○' } = {}) =>
    tag('span', { class: 'ui-pips', role: 'meter', 'aria-label': `${value} of ${max}`, 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': max },
      Array.from({ length: max }, (unused, index) => tag('span', { class: 'ui-pip', 'aria-hidden': 'true', 'data-full': String(index < value) }, escapeHtml(index < value ? glyph : emptyGlyph))).join('')),

  /**
   * Sections that open and close. Each header raises `action` (default `toggle`)
   * with the section's `value`; `open` is one value or a list of them. A closed
   * section keeps its content, so CSS can animate the height, but its controls
   * are disabled. `gameUi.read` therefore reads closed text too.
   */
  accordion: (sections, { action = 'toggle', open = [] } = {}) => {
    const openValues = [].concat(open)
    return tag('div', { class: 'ui-accordion' }, sections.map(section => {
      const isOpen = openValues.includes(section.value)
      const content = isOpen ? join(section.content) : join(section.content).replace(/\sdata-ui-control=/g, ' data-disabled data-ui-control=')
      return tag('section', { class: 'ui-accordion-item', 'data-open': isOpen },
        kit.button(section.title, { action, value: section.value, class: 'ui-accordion-head' })
        + tag('div', { class: 'ui-accordion-body', 'aria-hidden': String(!isOpen) }, tag('div', { class: 'ui-accordion-inner' }, content)))
    }).join(''))
  },

  /**
   * A table. `columns` are `{ key, label, align, isSortable }`; `rows` are
   * records with a `value` (the row's id) and a cell for each column key. With
   * `action` a row is clickable and raises it with its `value`; a sortable
   * header raises `sortAction` with its key, and the game sorts. Cells are text.
   */
  table: (columns, rows, { action, selected, sortKey, sortDirection = 'ascending', sortAction = 'sort' } = {}) => {
    const head = columns.map(column => tag('th', { 'data-align': column.align, 'aria-sort': column.key === sortKey ? sortDirection : undefined },
      column.isSortable ? kit.button(column.label + (column.key === sortKey ? (sortDirection === 'ascending' ? ' ▲' : ' ▼') : ''), { action: sortAction, value: column.key, kind: 'quiet', class: 'ui-table-sort' }) : escapeHtml(column.label))).join('')
    const body = rows.map(row => {
      const attributes = { class: 'ui-table-row', 'data-selected': row.value === selected }
      const cells = columns.map(column => tag('td', { 'data-align': column.align }, escapeHtml(row[column.key] ?? ''))).join('')
      return tag('tr', action ? { ...attributes, ...controlAttributes('row', { action, value: row.value, label: String(row.label ?? row.value) }) } : attributes, cells)
    }).join('')
    return tag('table', { class: 'ui-table' }, tag('thead', {}, tag('tr', {}, head)) + tag('tbody', {}, body))
  },

  /**
   * A log that shows its newest line at the bottom and stays there as lines
   * arrive, with no script: the scroller is `column-reverse`, which anchors its
   * scroll at the end. `lines` are strings or `{ who, text, tone }`, oldest
   * first; only the last `max` are drawn, so a long fight cannot grow the page.
   */
  log: (lines, { height = 160, max = 200 } = {}) =>
    tag('div', { class: 'ui-log', role: 'log', style: `--height:${Number(height) || 160}px` }, tag('div', { class: 'ui-log-inner' },
      lines.slice(-max).map(line => {
        const { who, text, tone } = typeof line === 'string' ? { text: line } : line
        return tag('div', { class: 'ui-log-line', 'data-tone': tone }, (who ? tag('b', {}, escapeHtml(who) + ' ') : '') + escapeHtml(text))
      }).join(''))),

  /**
   * A list of any length that draws only the rows in view. `items` are
   * `{ label, detail, value }`; `top` is the pixels scrolled, which the game
   * keeps from the `scroll` action (its value is the scroll position), so a row
   * is drawn only within `overscan` rows of the window. Row height is fixed, so
   * the scroll bar is exact. With `pick`, a row raises it with its value.
   */
  virtualList: (items, { rowHeight = 32, height = 240, top = 0, overscan = 4, pick, scrollAction = 'scroll' } = {}) => {
    const first = Math.max(0, Math.floor(top / rowHeight) - overscan)
    const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan)
    const rows = items.slice(first, last).map((item, offset) => {
      const attributes = { class: 'ui-row-item ui-vlist-row', style: `top:${(first + offset) * rowHeight}px` }
      const inner = tag('span', {}, escapeHtml(item.label)) + (item.detail === undefined ? '' : tag('span', { 'data-tone': 'quiet' }, escapeHtml(item.detail)))
      if (!pick) return tag('div', attributes, inner)
      return tag('button', { ...attributes, type: 'button', ...controlAttributes('row', { action: pick, value: item.value, label: item.label }) }, inner)
    }).join('')
    return tag('div', { class: 'ui-vlist', style: `--height:${height}px;--row:${rowHeight}px`, ...controlAttributes('target', { action: scrollAction, triggers: ['scroll'] }), 'data-passive': true },
      tag('div', { class: 'ui-vlist-inner', style: `height:${items.length * rowHeight}px` }, rows))
  },

  /** A round picture, or the name's initials when there is none. `status` is `online`, `away` or `busy`. */
  avatar: ({ image, name = '', size = 40, status } = {}) =>
    tag('span', { class: 'ui-avatar', title: name, 'data-status': status, style: `--size:${Number(size) || 40}px` },
      (image ? tag('img', { src: assetURL(image), alt: name }) : tag('span', { class: 'ui-avatar-initials' }, escapeHtml(initialsOf(name)))) + (status ? tag('span', { class: 'ui-avatar-status' }) : '')),

  /**
   * A rebinding row: a label and a keycap showing `code`. The keycap raises
   * `action` (default `rebind`) with `value`; the game then calls
   * `gameUi.captureKey` and shows `isListening` until a key comes.
   */
  keybind: (label, code, { action = 'rebind', value, isListening = false } = {}) =>
    tag('div', { class: 'ui-keybind' }, tag('span', { class: 'ui-keybind-label' }, escapeHtml(label))
      + kit.button(isListening ? 'Press a key…' : keyName(code), { action, value: value ?? label, class: isListening ? 'ui-keycap ui-listening' : 'ui-keycap' })),

  /**
   * Text revealed up to `chars` characters. The rest is laid out but hidden, so
   * the box does not grow as it types. Without `chars` all of it shows.
   */
  typewriter: (text, { chars = text.length } = {}) => {
    const shown = String(text).slice(0, chars)
    const rest = String(text).slice(chars)
    return tag('span', { class: 'ui-typewriter' }, tag('span', { class: 'ui-typed' }, escapeHtml(shown)) + (rest ? tag('span', { class: 'ui-caret' }, '▌') + tag('span', { class: 'ui-untyped' }, escapeHtml(rest)) : ''))
  },

  /**
   * A dialogue box: a speaker, typed text, and choices once the text is fully
   * shown. The box raises `advance` on a click or confirm key; choices raise
   * `choose` with their `value`. `chars` is how much text shows.
   */
  dialogue: ({ speaker, text, chars = text.length, portrait, choices = [], advance = 'advance', choose = 'choose' } = {}) => {
    const isDone = chars >= text.length
    const box = tag('div', { class: 'ui-dialogue-box', role: 'button', tabindex: '0', ...controlAttributes('target', { action: advance, label: speaker, triggers: ['click'] }) },
      (portrait ? tag('img', { class: 'ui-portrait', src: assetURL(portrait), alt: speaker ?? '' }) : '')
      + tag('div', { class: 'ui-dialogue-body' }, (speaker ? tag('div', { class: 'ui-dialogue-speaker' }, escapeHtml(speaker)) : '') + components.typewriter(text, { chars })))
    const options = isDone && choices.length ? tag('div', { class: 'ui-choices' }, choices.map(choice => components.button(choice.label, { action: choose, value: choice.value })).join('')) : ''
    return tag('div', { class: 'ui-dialogue' }, box + options)
  },

  /**
   * A menu of choices at a point (`x`, `y` in pixels), over a transparent layer
   * that dismisses it when clicked. A row is `{ label, value, isDisabled, kind }`
   * and raises `pick` with its value; `{ isDivider: true }` is a line.
   */
  contextMenu: (items, { x = 0, y = 0, pick = 'pick', dismiss = 'dismiss' } = {}) =>
    tag('div', { class: 'ui-menu', role: 'menu', style: `left:${Number(x)}px;top:${Number(y)}px` },
      items.map(item => (item.isDivider ? '<hr class="ui-divider">' : kit.button(item.label, { action: pick, value: item.value, kind: item.kind, isDisabled: item.isDisabled, class: 'ui-menu-item' }))).join(''))
    // `kit`, not `components`: only the kit's functions take a class.
    + kit.target('', { action: dismiss, triggers: ['click', 'contextmenu'], class: 'ui-menu-scrim', attributes: { 'data-passive': true } }),

  /**
   * Items around a point, clockwise from the top: a weapon wheel. `x`, `y` is
   * the centre in pixels and `radius` how far the items sit from it. An item is
   * `{ label, value, glyph, isDisabled }` and raises `pick` with its value; the
   * layer behind raises `dismiss`. Pointer hover, arrows and a stick all move
   * the same focus, so a game can `pickFocused` on a key's release.
   */
  radial: (items, { x = 0, y = 0, radius = 110, pick = 'pick', dismiss = 'dismiss' } = {}) =>
    tag('div', { class: 'ui-radial', role: 'menu', style: `left:${Number(x)}px;top:${Number(y)}px` },
      items.map((item, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / items.length
        const offset = `left:${Math.round(Math.cos(angle) * radius)}px;top:${Math.round(Math.sin(angle) * radius)}px;--i:${index}`
        return kit.button(item.label, { action: pick, value: item.value, icon: item.glyph, isDisabled: item.isDisabled, class: 'ui-radial-item', style: offset })
      }).join(''))
    + kit.target('', { action: dismiss, triggers: ['click', 'contextmenu'], class: 'ui-radial-scrim', attributes: { 'data-passive': true } }),

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
 * `tip: 'text'` gives it a tooltip (tooltip.js); `tipKey` and `tipValue` make the
 * tooltip HTML from a registered provider.
 * `drag: payload` makes the element draggable; `drop: action` (with `dropValue`)
 * makes it a place to drop (drag.js).
 */
export function decorate(html, options) {
  if (!options?.class && !options?.style && [options?.key, options?.drag, options?.drop, options?.tip, options?.tipKey].every(value => value === undefined)) return html
  return html.replace(/^<([a-z0-9-]+)((?:\s[^>]*)?)>/, (whole, name, attributes) => {
    let head = attributes
    if (options.class) head = /\sclass="/.test(head) ? head.replace(/(\sclass=")/, (match, open) => `${open}${escapeHtml(options.class)} `) : `${head} class="${escapeHtml(options.class)}"`
    if (options.key !== undefined) head += ` data-key="${escapeHtml(options.key)}"`
    if (options.tip !== undefined) head += ` data-tip="${escapeHtml(options.tip)}"`
    if (options.tipKey !== undefined) head += ` data-tip-key="${escapeHtml(options.tipKey)}" data-tip-value="${escapeHtml(options.tipValue ?? '')}"`
    if (options.drag !== undefined) head += ` data-drag="${escapeHtml(options.drag)}"`
    if (options.drop !== undefined) head += ` data-drop="${escapeHtml(options.drop)}" data-drop-value="${escapeHtml(options.dropValue ?? '')}"`
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
