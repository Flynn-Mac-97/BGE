/**
 * Kernel: the UI vocabulary.
 *
 * Plugins never write markup. They compose from these primitives, which means a
 * plugin cannot specify a colour, cannot drift from the design system, and
 * inherits theme changes for free. It also means a panel costs ~15 lines
 * instead of ~240.
 *
 * If a built-in panel ever needs to drop to raw DOM, that is a signal the
 * vocabulary is missing something — add the primitive, do not add an escape hatch.
 */

// Where an asset reference points is one rule, and it is in the pure module
// both halves import. Re-exported here because the renderer, materials and the
// skybox already import this file for the vocabulary and reach for it by name.
// A plugin that wants only the URL should import `asset-path.js` directly —
// audio, decals and particles do, so the headless world never loads this file.
// Imported as well as re-exported, deliberately: `export { x } from '...'`
// forwards the name without creating a local binding, so `ui.thumb` and
// `ui.preview` called an `assetURL` that was not in scope and threw for any
// image. Silently — the loader catches a panel's error and disables it.
import { assetURL } from './asset-path.js'
export { assetURL }

const IMAGE = /\.(png|jpg|jpeg|webp|gif|svg)$/i

/** Build one element. `on` takes listeners by event name; `text` sets the text content. */
function makeElement(tag, className, attributes = {}) {
  const element = document.createElement(tag)
  if (className) element.className = className
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue
    if (key === 'on') for (const [event, listener] of Object.entries(value)) element.addEventListener(event, listener)
    else if (key === 'text') element.textContent = value
    else element.setAttribute(key, value)
  }
  return element
}

/**
 * A button. `o.primary` marks the main action, `o.small` makes it compact,
 * `o.title` is its hover text, and `o.confirm` makes it ask
 * first: the first click shows `o.confirm` (such as "Delete?") and only a
 * second click within three seconds runs `onClick`, for an action that
 * cannot be undone.
 */
function confirmableButton(label, onClick, options = {}) {
  const element = makeElement(
    'button',
    'u-btn' + (options.primary ? ' primary' : '') + (options.small ? ' small' : ''),
    {
      text: label,
      title: options.title
    }
  )
  let isAsking = false
  element.addEventListener('click', event => {
    if (!options.confirm || isAsking) {
      onClick?.(event)
      return
    }
    isAsking = true
    element.textContent = options.confirm
    element.classList.add('asking')
    setTimeout(() => {
      isAsking = false
      element.textContent = label
      element.classList.remove('asking')
    }, 3000)
  })
  return element
}

/**
 * A dropdown in a labelled row, `o.k` its label. `o.options` are strings
 * or `{ value, label, disabled }`; `o.value` is the chosen value and
 * `o.onChange(value)` is called with the new one.
 */
function selectRow(options, redraw) {
  const element = makeElement('label', 'u-field')
  append(element, [makeElement('span', 'u-k', { text: options.k ?? '' })])
  const menu = makeElement('select', 'u-select')
  for (const entry of options.options || []) {
    const choice = typeof entry === 'string' ? { value: entry, label: entry } : entry
    const item = makeElement('option', null, { text: choice.label ?? choice.value, value: choice.value })
    if (choice.disabled) item.disabled = true
    if (choice.value === options.value) item.selected = true
    append(menu, [item])
  }
  menu.addEventListener('change', () => {
    options.onChange?.(menu.value)
    redraw()
  })
  append(element, [menu])
  if (options.note) append(element, [makeElement('span', 'u-note', { text: options.note })])
  return element
}

/**
 * A grid cell's content: `o.media` (a node, such as ui.picture) above a
 * title, a sub-line and a row of small `o.actions` buttons. Put it in
 * ui.grid's `cell`; an action's click does not pick the cell.
 */
function card(options = {}) {
  const element = makeElement('div', 'u-card')
  if (options.media) append(element, [options.media])
  if (options.title) append(element, [makeElement('span', 'u-tlabel', { text: options.title })])
  if (options.sub) append(element, [makeElement('span', 'u-tsub', { text: options.sub })])
  if (options.actions?.length) {
    const actions = append(makeElement('div', 'u-card-actions'), options.actions)
    // An action's click stays in the card; it does not pick the cell as well.
    actions.addEventListener('click', event => event.stopPropagation())
    append(element, [actions])
  }
  return element
}

/** Append children, skipping null and false. A string becomes a text node. */
const append = (element, children) => {
  for (const child of [].concat(children || [])) {
    if (child == null || child === false) continue
    element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return element
}

/**
 * The widget vocabulary a panel composes from: layout, text, inputs, lists,
 * trees, grids and asset views. Every method returns a DOM node.
 *
 * @param state  the panel's persisted state object (context.state)
 * @param redraw called whenever a bound input changes
 */
export function makeUI(state, redraw) {
  const bindable = (options, element, event, get) => {
    if (!options.bind && !options.onChange) return
    element.addEventListener(event, domEvent => {
      const value = get(domEvent.target)
      if (options.bind) state[options.bind] = value
      options.onChange?.(value)
      if (options.bind) redraw()
    })
  }

  const ui = {
    // ---- layout ----
    stack: (children, options = {}) => append(makeElement('div', 'u-stack' + (options.pad ? ' pad' : '')), children),
    row: (children, options = {}) => append(makeElement('div', 'u-row' + (options.pad ? ' pad' : '')), children),
    spacer: () => makeElement('div', 'u-spacer'),

    section: (title, children) =>
      append(makeElement('div', 'u-section'), [
        makeElement('div', 'u-cap', { text: title }),
        ...[].concat(children || [])
      ]),

    /**
     * Collapsible group. Closed until the reader opens it, so many folds cost
     * one summary line each. `o.meta` is a right-aligned count or note;
     * `o.open` starts it open; `o.onToggle(isOpen)` hears it open or close.
     */
    fold(title, children, options = {}) {
      const element = makeElement('details', 'u-fold')
      if (options.open) element.open = true
      if (options.onToggle) element.addEventListener('toggle', () => options.onToggle(element.open))
      const summary = makeElement('summary', 'u-fsum')
      append(summary, [makeElement('span', 'u-flabel', { text: title })])
      if (options.meta != null) append(summary, [makeElement('span', 'u-meta', { text: String(options.meta) })])
      append(element, [summary])
      return append(element, children)
    },

    /** Even columns of picture cells. Layout only — `grid` is for picking. */
    gallery: children => append(makeElement('div', 'u-gallery'), children),

    /** Side-by-side columns; `o.widths` is a CSS grid track list such as `'1fr 360px'`. Each column scrolls on its own. */
    columns(children, options = {}) {
      const element = makeElement('div', 'u-columns')
      if (options.widths) element.style.gridTemplateColumns = options.widths
      return append(element, children)
    },

    scroll: children => append(makeElement('div', 'u-scroll'), children),

    // ---- text ----
    text: (text, options = {}) => makeElement('div', 'u-text' + (options.dim ? ' dim' : ''), { text }),
    label: text => makeElement('span', 'u-label', { text }),
    value: value => makeElement('span', 'u-value', { text: String(value) }),
    empty: text => makeElement('div', 'u-empty', { text }),

    /** Machine-side detail on a row: a count, a reason, a duration. Never the subject. */
    meta: text => makeElement('span', 'u-meta', { text: text ?? '' }),

    /** A single status character that holds its column: · ✓ ✗ */
    glyph: (text, options = {}) =>
      makeElement('span', 'u-glyph-m' + (options.strong ? ' strong' : ''), { text: text ?? '·' }),

    // ---- inputs ----
    search(options = {}) {
      const element = makeElement('div', 'u-search')
      const input = makeElement('input', null, {
        value: options.value ?? (options.bind ? (state[options.bind] ?? '') : ''),
        placeholder: options.placeholder || 'filter',
        spellcheck: 'false',
        autocomplete: 'off'
      })
      bindable(options, input, 'input', target => target.value)
      append(element, [makeElement('span', 'u-mag', { text: '/' }), input])
      if (options.count != null) append(element, [makeElement('span', 'u-count', { text: String(options.count) })])
      element._focus = () => {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
      return element
    },

    field(options = {}) {
      const element = makeElement('div', 'u-field' + (options.marked ? ' marked' : ''))
      append(element, [makeElement('span', 'u-k', { text: options.k ?? '' })])
      if (options.onChange || options.bind) {
        const input = makeElement('input', 'u-v', { value: String(options.v ?? ''), spellcheck: 'false' })
        bindable(
          {
            ...options,
            bind: null,
            onChange: value => options.onChange?.(options.kind === 'number' ? Number(value) : value)
          },
          input,
          'change',
          target => target.value
        )
        append(element, [input])
      } else {
        append(element, [makeElement('span', 'u-v ro', { text: String(options.v ?? '') })])
      }
      if (options.note) append(element, [makeElement('span', 'u-note', { text: options.note })])
      return element
    },

    button: confirmableButton,
    select: options => selectRow(options, redraw),
    card,

    toggle(options = {}) {
      const isOn = options.value ?? (options.bind ? !!state[options.bind] : false)
      const element = makeElement('button', 'u-toggle', { 'aria-pressed': String(isOn) })
      append(element, [makeElement('span', 'u-box'), makeElement('span', null, { text: options.label || '' })])
      element.addEventListener('click', event => {
        if (options.stop) event.stopPropagation()
        const value = !isOn
        if (options.bind) state[options.bind] = value
        options.onChange?.(value)
        redraw()
      })
      return element
    },

    slider(options = {}) {
      const element = makeElement('div', 'u-field')
      append(element, [makeElement('span', 'u-k', { text: options.k ?? '' })])
      const input = makeElement('input', 'u-slider', {
        type: 'range',
        min: options.min ?? 0,
        max: options.max ?? 1,
        step: options.step ?? 0.01,
        value: options.value ?? (options.bind ? state[options.bind] : 0)
      })
      bindable(options, input, 'input', target => Number(target.value))
      append(element, [input, makeElement('span', 'u-v ro', { text: String(options.value ?? '') })])
      return element
    },

    pick(options = {}) {
      const element = makeElement('div', 'u-pick')
      for (const opt of options.options || []) {
        const val = typeof opt === 'string' ? opt : opt.value
        const lab = typeof opt === 'string' ? opt : opt.label
        const optionButton = makeElement('button', 'u-pickone', {
          text: lab,
          'aria-pressed': String(val === options.value)
        })
        optionButton.addEventListener('click', () => {
          options.onChange?.(val)
          redraw()
        })
        append(element, [optionButton])
      }
      return element
    },

    // ---- collections ----
    list(options = {}) {
      const element = makeElement('div', 'u-list')
      const items = options.items || []
      if (!items.length) return append(element, [ui.empty(options.emptyText || 'nothing here')])
      items.forEach((item, index) => {
        const key = options.key ? options.key(item) : index
        const row = makeElement(
          'div',
          'u-lrow' + (options.selected === key ? ' on' : '') + (options.dim?.(item) ? ' dim' : ''),
          { role: 'button', tabindex: '0' }
        )
        append(row, options.row ? options.row(item) : [ui.label(String(item))])

        // Rows can be dragged out of a list and dropped somewhere that knows
        // what to do with them — a type onto the viewport, for instance. The
        // list says what the payload is; it never knows who catches it.
        // Asked once, at render: a handler that returns nothing for this item
        // means this row is not draggable. Otherwise every row would offer a
        // drag that quietly does nothing — a signifier for an affordance that
        // is not there.
        const payload = options.drag?.(item)
        if (payload) {
          row.draggable = true
          row.addEventListener('dragstart', event => {
            event.dataTransfer.setData('application/x-engine', JSON.stringify(payload))
            event.dataTransfer.effectAllowed = 'copy'
            row.classList.add('dragging')
          })
          row.addEventListener('dragend', () => row.classList.remove('dragging'))
        }

        row.addEventListener('click', event => options.onPick?.(item, event))
        row.addEventListener('contextmenu', event => options.onContext?.(item, event))
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            options.onPick?.(item, event)
          }
        })
        append(element, [row])
      })
      return element
    },

    textarea(options = {}) {
      const element = makeElement('textarea', 'u-textarea', {
        spellcheck: 'false',
        placeholder: options.placeholder || ''
      })
      element.value = String(options.value ?? '')
      if (options.readOnly) element.readOnly = true
      if (options.rows) {
        element.rows = options.rows
        element.style.minHeight = 'auto'
      }
      if (options.label) element.setAttribute('aria-label', options.label)
      bindable(options, element, 'input', target => target.value)
      return element
    },

    /**
     * Markup shown in a shadow root, so its stylesheet and the editor's cannot
     * reach each other. `options.background` sets the colour behind it.
     * `options.onPick(value)` hears a click, or Enter on a focused element, on
     * anything inside marked `data-pick="value"`. `restyle(css)` swaps the sheet and `reshow(html)` swaps
     * the markup, both without redrawing the panel.
     */
    sandbox(options = {}) {
      const element = makeElement('div', 'u-sandbox')
      if (options.background) element.style.background = options.background
      const style = document.createElement('style')
      style.textContent = options.css ?? ''
      const body = document.createElement('div')
      body.innerHTML = options.html ?? ''
      const root = element.attachShadow({ mode: 'open' })
      root.append(style, body)
      if (options.onPick) {
        const picked = event => event.target.closest?.('[data-pick]')?.dataset.pick
        root.addEventListener('click', event => {
          const value = picked(event)
          if (value !== undefined) options.onPick(value)
        })
        root.addEventListener('keydown', event => {
          const value = event.key === 'Enter' && event.target.matches?.('[data-pick]') ? picked(event) : undefined
          if (value !== undefined) options.onPick(value)
        })
      }
      element.restyle = css => {
        style.textContent = css
      }
      element.reshow = html => {
        body.innerHTML = html
      }
      return element
    },

    tree(options = {}) {
      const element = makeElement('div', 'u-tree')
      const nodes = options.nodes || []
      if (!nodes.length) return append(element, [ui.empty(options.emptyText || 'nothing here')])
      const byParent = new Map()
      for (const node of nodes) {
        const key = node.parent || ''
        byParent.set(key, [...(byParent.get(key) || []), node])
      }
      const draw = (parent, depth) => {
        for (const node of byParent.get(parent) || []) {
          const children = byParent.get(node.id) || []
          const row = makeElement('div', 'u-trow' + (options.selected === node.id ? ' on' : ''), {
            role: 'button',
            tabindex: '0',
            style: `--depth:${depth}`
          })
          append(row, options.row ? options.row(node, children.length) : [ui.label(node.title || node.id)])
          row.addEventListener('click', event => options.onPick?.(node, event))
          row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              options.onPick?.(node, event)
            }
          })
          append(element, [row])
          draw(node.id, depth + 1)
        }
      }
      draw('', 0)
      return element
    },

    grid(options = {}) {
      const items = options.items || []
      const element = makeElement('div', 'u-grid', { style: `--cols:${options.cols || 3}` })
      if (!items.length) return append(makeElement('div'), [ui.empty(options.emptyText || 'nothing here')])
      items.forEach(item => {
        const key = options.key ? options.key(item) : item
        const cell = makeElement('div', 'u-cell' + (options.selected === key ? ' on' : ''), {
          role: 'button',
          tabindex: '0'
        })
        append(cell, options.cell ? options.cell(item) : [ui.label(String(item))])
        cell.addEventListener('click', () => options.onPick?.(item))
        cell.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            options.onPick?.(item)
          }
        })
        append(element, [cell])
      })
      return element
    },

    // ---- assets ----
    thumb(item, options = {}) {
      const element = makeElement('div', 'u-thumb')
      const art = makeElement('div', 'u-art')
      const src = typeof item === 'string' ? item : item.src || item.file
      if (src && IMAGE.test(src)) {
        append(art, [makeElement('img', null, { src: assetURL(src), alt: '' })])
      } else {
        append(art, [makeElement('span', 'u-glyph', { text: options.glyph || '·' })])
      }
      append(element, [art])
      if (options.label) append(element, [makeElement('span', 'u-tlabel', { text: options.label })])
      if (options.sub) append(element, [makeElement('span', 'u-tsub', { text: options.sub })])
      return element
    },

    preview(item, options = {}) {
      const element = makeElement('div', 'u-preview')
      const src = typeof item === 'string' ? item : item?.file
      if (src && IMAGE.test(src)) {
        append(element, [makeElement('img', null, { src: assetURL(src), alt: '' })])
      } else {
        append(element, [makeElement('span', 'u-glyph', { text: options.glyph || '—' })])
      }
      return element
    },

    /**
     * An image by checkout path, not by asset name — for output a run left
     * behind (a test's frames under agent-runs/), which no asset URL reaches.
     * `stamp` busts the browser cache when the same path holds a new picture.
     */
    picture(src, options = {}) {
      const element = makeElement('figure', 'u-picture')
      const url = src.startsWith('data:') ? src : `/${src}${options.stamp ? `?run=${options.stamp}` : ''}`
      append(element, [makeElement('img', null, { src: url, alt: options.label || '' })])
      if (options.label) append(element, [makeElement('figcaption', 'u-tsub', { text: options.label })])
      return element
    },

    // escape hatch of last resort — its use is a bug report about this file
    raw: node => node
  }

  return ui
}
