/**
 * Kernel: the dock sizes and the four resize handles.
 *
 * `shell.js` builds the frame; where its dividers sit is a separate concern.
 * Sizes are browser-local layout state, so they survive reloads and never enter
 * project files. A drag, a double-click, Home and the arrow keys all come
 * through `resize`, so the clamp and the stored value hold for each.
 */

const LAYOUT_KEY = 'browser-game-engine.layout.v1'

/** The stored layout, over the defaults, or the defaults when storage is blocked. */
function readLayout(fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') } }
  catch { return { ...fallback } }
}

/** Store the layout for the next page. Blocked storage is not an error. */
function saveLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* storage may be blocked */ }
}

/**
 * The four dock sizes, and the handles that change them.
 *
 * The centre default is a fraction of the frame's own width, so the defaults
 * are read from `root`. `onResize` runs whenever a size changes because the
 * viewport changed size and the renderer has to recompute the camera aspect
 * ratio.
 */
export function makeLayout(root, frame, onResize) {
  const element = id => root.querySelector('#' + id)

  const DEFAULT_LAYOUT = {
    left: 190,
    right: 236,
    centre: Math.min(560, Math.max(240, Math.round(root.getBoundingClientRect().width * 0.46))),
    bottom: 220
  }
  const layout = readLayout(DEFAULT_LAYOUT)

  /** The drag range of one divider, from the frame's current size. */
  function boundsFor(key) {
    const box = frame.getBoundingClientRect()
    if (key === 'bottom') return [100, Math.max(100, Math.round(box.height * 0.65))]
    if (key === 'centre') return [240, Math.max(240, Math.round(box.width * 0.65))]
    return [120, Math.max(120, Math.min(480, Math.round(box.width * 0.45)))]
  }

  /** Set one layout size, clamp it to its range, and tell the renderer the viewport changed. */
  function resize(key, value, save = false) {
    const [least, most] = boundsFor(key)
    layout[key] = Math.round(Math.max(least, Math.min(most, Number(value) || DEFAULT_LAYOUT[key])))
    frame.style.setProperty(`--${key}-size`, `${layout[key]}px`)
    const handle = element('resize-' + key)
    handle?.setAttribute('aria-valuemin', String(least))
    handle?.setAttribute('aria-valuemax', String(most))
    handle?.setAttribute('aria-valuenow', String(layout[key]))
    if (save) saveLayout(layout)
    onResize?.()
  }

  /** Apply every stored size to the frame, without writing the layout back. */
  function applyLayout() {
    for (const key of Object.keys(DEFAULT_LAYOUT)) resize(key, layout[key])
  }

  /** Put one divider, or all of them, back to the default size. */
  function resetLayout(key = null) {
    for (const name of key ? [key] : Object.keys(DEFAULT_LAYOUT)) resize(name, DEFAULT_LAYOUT[name])
    saveLayout(layout)
    return { ...layout }
  }

  /**
   * Wire one divider: pointer drag, double-click and Home to reset, and arrow
   * keys to step it.
   */
  function installResizer(id, key, axis, direction) {
    const handle = element(id)
    if (!handle) return
    handle.title = 'Drag to resize · double-click to reset'

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      const startPoint = axis === 'x' ? event.clientX : event.clientY
      const startSize = layout[key]
      handle.setPointerCapture?.(event.pointerId)
      frame.classList.add('resizing')
      handle.classList.add('active')

      const move = next => {
        const point = axis === 'x' ? next.clientX : next.clientY
        resize(key, startSize + (point - startPoint) * direction)
      }
      const done = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', done)
        handle.removeEventListener('pointercancel', done)
        handle.classList.remove('active')
        frame.classList.remove('resizing')
        saveLayout(layout)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', done)
      handle.addEventListener('pointercancel', done)
    })

    handle.addEventListener('dblclick', () => resetLayout(key))
    handle.addEventListener('keydown', event => {
      const backward = axis === 'x' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
      const forward = axis === 'x' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
      if (!backward && !forward && event.key !== 'Home') return
      event.preventDefault()
      if (event.key === 'Home') resetLayout(key)
      else resize(key, layout[key] + (backward ? -16 : 16) * direction, true)
    })
  }

  /** Set several sizes at once, then store the result. */
  function setLayout(values = {}) {
    for (const key of Object.keys(DEFAULT_LAYOUT)) {
      if (values[key] != null) resize(key, values[key])
    }
    saveLayout(layout)
    return { ...layout }
  }

  return {
    applyLayout,
    installResizer,
    resetLayout,
    setLayout,
    /** What is stored right now. */
    snapshot: () => ({ ...layout })
  }
}
