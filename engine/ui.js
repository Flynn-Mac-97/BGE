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

// Where an asset reference points is one rule, and it lives in the pure module
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
  for (const [k, v] of Object.entries(attributes)) {
    if (v == null) continue
    if (k === 'on') for (const [event, fn] of Object.entries(v)) element.addEventListener(event, fn)
    else if (k === 'text') element.textContent = v
    else element.setAttribute(k, v)
  }
  return element
}

/** Append children, skipping null and false. A string becomes a text node. */
const append = (element, children) => {
  for (const k of [].concat(children || [])) {
    if (k == null || k === false) continue
    element.append(k instanceof Node ? k : document.createTextNode(String(k)))
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
      const v = get(domEvent.target)
      if (options.bind) state[options.bind] = v
      options.onChange?.(v)
      if (options.bind) redraw()
    })
  }

  const ui = {
    // ---- layout ----
    stack: (children, o = {}) => append(makeElement('div', 'u-stack' + (o.pad ? ' pad' : '')), children),
    row: (children, o = {}) => append(makeElement('div', 'u-row' + (o.pad ? ' pad' : '')), children),
    spacer: () => makeElement('div', 'u-spacer'),

    section: (title, children) =>
      append(makeElement('div', 'u-section'), [
        makeElement('div', 'u-cap', { text: title }),
        ...[].concat(children || [])
      ]),

    /**
     * Collapsible group. Closed until the reader opens it, so many folds cost
     * one summary line each. `o.meta` is a right-aligned count or note;
     * `o.open` starts it open.
     */
    fold(title, children, o = {}) {
      const element = makeElement('details', 'u-fold')
      if (o.open) element.open = true
      const summary = makeElement('summary', 'u-fsum')
      append(summary, [makeElement('span', 'u-flabel', { text: title })])
      if (o.meta != null) append(summary, [makeElement('span', 'u-meta', { text: String(o.meta) })])
      append(element, [summary])
      return append(element, children)
    },

    /** Even columns of picture cells. Layout only — `grid` is for picking. */
    gallery: children => append(makeElement('div', 'u-gallery'), children),

    scroll: children => append(makeElement('div', 'u-scroll'), children),

    // ---- text ----
    text: (s, o = {}) => makeElement('div', 'u-text' + (o.dim ? ' dim' : ''), { text: s }),
    label: s => makeElement('span', 'u-label', { text: s }),
    value: v => makeElement('span', 'u-value', { text: String(v) }),
    empty: s => makeElement('div', 'u-empty', { text: s }),

    /** Machine-side detail on a row: a count, a reason, a duration. Never the subject. */
    meta: s => makeElement('span', 'u-meta', { text: s ?? '' }),

    /** A single status character that holds its column: · ✓ ✗ */
    glyph: (s, o = {}) => makeElement('span', 'u-glyph-m' + (o.strong ? ' strong' : ''), { text: s ?? '·' }),

    // ---- inputs ----
    search(o = {}) {
      const element = makeElement('div', 'u-search')
      const input = makeElement('input', null, {
        value: o.value ?? (o.bind ? (state[o.bind] ?? '') : ''),
        placeholder: o.placeholder || 'filter',
        spellcheck: 'false',
        autocomplete: 'off'
      })
      bindable(o, input, 'input', t => t.value)
      append(element, [makeElement('span', 'u-mag', { text: '/' }), input])
      if (o.count != null) append(element, [makeElement('span', 'u-count', { text: String(o.count) })])
      element._focus = () => {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      }
      return element
    },

    field(o = {}) {
      const element = makeElement('div', 'u-field' + (o.marked ? ' marked' : ''))
      append(element, [makeElement('span', 'u-k', { text: o.k ?? '' })])
      if (o.onChange || o.bind) {
        const input = makeElement('input', 'u-v', { value: String(o.v ?? ''), spellcheck: 'false' })
        bindable(
          { ...o, bind: null, onChange: v => o.onChange?.(o.kind === 'number' ? Number(v) : v) },
          input,
          'change',
          t => t.value
        )
        append(element, [input])
      } else {
        append(element, [makeElement('span', 'u-v ro', { text: String(o.v ?? '') })])
      }
      if (o.note) append(element, [makeElement('span', 'u-note', { text: o.note })])
      return element
    },

    button: (label, onClick, o = {}) =>
      makeElement('button', 'u-btn' + (o.primary ? ' primary' : ''), { text: label, on: { click: onClick } }),

    toggle(o = {}) {
      const on = o.value ?? (o.bind ? !!state[o.bind] : false)
      const element = makeElement('button', 'u-toggle', { 'aria-pressed': String(on) })
      append(element, [makeElement('span', 'u-box'), makeElement('span', null, { text: o.label || '' })])
      element.addEventListener('click', event => {
        if (o.stop) event.stopPropagation()
        const v = !on
        if (o.bind) state[o.bind] = v
        o.onChange?.(v)
        redraw()
      })
      return element
    },

    slider(o = {}) {
      const element = makeElement('div', 'u-field')
      append(element, [makeElement('span', 'u-k', { text: o.k ?? '' })])
      const input = makeElement('input', 'u-slider', {
        type: 'range',
        min: o.min ?? 0,
        max: o.max ?? 1,
        step: o.step ?? 0.01,
        value: o.value ?? (o.bind ? state[o.bind] : 0)
      })
      bindable(o, input, 'input', t => Number(t.value))
      append(element, [input, makeElement('span', 'u-v ro', { text: String(o.value ?? '') })])
      return element
    },

    pick(o = {}) {
      const element = makeElement('div', 'u-pick')
      for (const opt of o.options || []) {
        const val = typeof opt === 'string' ? opt : opt.value
        const lab = typeof opt === 'string' ? opt : opt.label
        const b = makeElement('button', 'u-pickone', { text: lab, 'aria-pressed': String(val === o.value) })
        b.addEventListener('click', () => {
          o.onChange?.(val)
          redraw()
        })
        append(element, [b])
      }
      return element
    },

    // ---- collections ----
    list(o = {}) {
      const element = makeElement('div', 'u-list')
      const items = o.items || []
      if (!items.length) return append(element, [ui.empty(o.emptyText || 'nothing here')])
      items.forEach((it, i) => {
        const key = o.key ? o.key(it) : i
        const row = makeElement('div', 'u-lrow' + (o.selected === key ? ' on' : '') + (o.dim?.(it) ? ' dim' : ''), {
          role: 'button',
          tabindex: '0'
        })
        append(row, o.row ? o.row(it) : [ui.label(String(it))])

        // Rows can be dragged out of a list and dropped somewhere that knows
        // what to do with them — a type onto the viewport, for instance. The
        // list says what the payload is; it never knows who catches it.
        // Asked once, at render: a handler that returns nothing for this item
        // means this row is not draggable. Otherwise every row would offer a
        // drag that quietly does nothing — a signifier for an affordance that
        // is not there.
        const payload = o.drag?.(it)
        if (payload) {
          row.draggable = true
          row.addEventListener('dragstart', event => {
            event.dataTransfer.setData('application/x-engine', JSON.stringify(payload))
            event.dataTransfer.effectAllowed = 'copy'
            row.classList.add('dragging')
          })
          row.addEventListener('dragend', () => row.classList.remove('dragging'))
        }

        row.addEventListener('click', event => o.onPick?.(it, event))
        row.addEventListener('contextmenu', event => o.onContext?.(it, event))
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            o.onPick?.(it, event)
          }
        })
        append(element, [row])
      })
      return element
    },

    textarea(o = {}) {
      const element = makeElement('textarea', 'u-textarea', { spellcheck: 'false', placeholder: o.placeholder || '' })
      element.value = String(o.value ?? '')
      bindable(o, element, 'input', target => target.value)
      return element
    },

    tree(o = {}) {
      const element = makeElement('div', 'u-tree')
      const nodes = o.nodes || []
      if (!nodes.length) return append(element, [ui.empty(o.emptyText || 'nothing here')])
      const byParent = new Map()
      for (const node of nodes) {
        const key = node.parent || ''
        byParent.set(key, [...(byParent.get(key) || []), node])
      }
      const draw = (parent, depth) => {
        for (const node of byParent.get(parent) || []) {
          const children = byParent.get(node.id) || []
          const row = makeElement('div', 'u-trow' + (o.selected === node.id ? ' on' : ''), {
            role: 'button',
            tabindex: '0',
            style: `--depth:${depth}`
          })
          append(row, o.row ? o.row(node, children.length) : [ui.label(node.title || node.id)])
          row.addEventListener('click', event => o.onPick?.(node, event))
          row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              o.onPick?.(node, event)
            }
          })
          append(element, [row])
          draw(node.id, depth + 1)
        }
      }
      draw('', 0)
      return element
    },

    grid(o = {}) {
      const items = o.items || []
      const element = makeElement('div', 'u-grid', { style: `--cols:${o.cols || 3}` })
      if (!items.length) return append(makeElement('div'), [ui.empty(o.emptyText || 'nothing here')])
      items.forEach(it => {
        const key = o.key ? o.key(it) : it
        const cell = makeElement('div', 'u-cell' + (o.selected === key ? ' on' : ''), { role: 'button', tabindex: '0' })
        append(cell, o.cell ? o.cell(it) : [ui.label(String(it))])
        cell.addEventListener('click', () => o.onPick?.(it))
        cell.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            o.onPick?.(it)
          }
        })
        append(element, [cell])
      })
      return element
    },

    // ---- assets ----
    thumb(item, o = {}) {
      const element = makeElement('div', 'u-thumb')
      const art = makeElement('div', 'u-art')
      const src = typeof item === 'string' ? item : item.src || item.file
      if (src && IMAGE.test(src)) {
        append(art, [makeElement('img', null, { src: assetURL(src), alt: '' })])
      } else {
        append(art, [makeElement('span', 'u-glyph', { text: o.glyph || '·' })])
      }
      append(element, [art])
      if (o.label) append(element, [makeElement('span', 'u-tlabel', { text: o.label })])
      if (o.sub) append(element, [makeElement('span', 'u-tsub', { text: o.sub })])
      return element
    },

    preview(item, o = {}) {
      const element = makeElement('div', 'u-preview')
      const src = typeof item === 'string' ? item : item?.file
      if (src && IMAGE.test(src)) {
        append(element, [makeElement('img', null, { src: assetURL(src), alt: '' })])
      } else {
        append(element, [makeElement('span', 'u-glyph', { text: o.glyph || '—' })])
      }
      return element
    },

    /**
     * An image by checkout path, not by asset name — for output a run left
     * behind (a test's frames under agent-runs/), which no asset URL reaches.
     * `stamp` busts the browser cache when the same path holds a new picture.
     */
    picture(src, o = {}) {
      const element = makeElement('figure', 'u-picture')
      const url = src.startsWith('data:') ? src : `/${src}${o.stamp ? `?run=${o.stamp}` : ''}`
      append(element, [makeElement('img', null, { src: url, alt: o.label || '' })])
      if (o.label) append(element, [makeElement('figcaption', 'u-tsub', { text: o.label })])
      return element
    },

    // escape hatch of last resort — its use is a bug report about this file
    raw: node => node
  }

  return ui
}
