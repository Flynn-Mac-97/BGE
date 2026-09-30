/**
 * Game UI tooltip: a box that explains the element under the pointer, or the
 * one that has keyboard focus. Any component takes `tip: 'text'`; with `tipKey`
 * and `tipValue` the box is HTML from a provider the game registered
 * (`gameUi.tips({ item: value => '<b>...</b>' })`), for an item card.
 *
 * It waits `DELAY` seconds of frame time over one element before showing, sits
 * beside the pointer on the side with room, and follows it. It is one panel,
 * over the others and never taking the pointer, made when a tip shows and
 * removed when it goes. Presentation only: nothing here touches the world.
 */
import { escapeHtml, kit } from './components.js'
import { removeNow } from './lifecycle.js'
import { scopeOf } from './menu.js'

const PANEL = 'ui:tooltip'

/** Above every other panel, so a card is never covered by what it explains. */
const ORDER = 70

/** Seconds a tip source must hold the pointer or focus before its box shows. */
const DELAY = 0.35

/** Pixels from the pointer to the box. */
const GAP = { x: 14, y: 18 }

const FALLBACK_VIEWPORT = { width: 1280, height: 720 }

/** The state of the tip machine: what is pointed at, where, and for how long. */
export const makeTipState = () => ({ element: null, x: 0, y: 0, seconds: 0, current: null, isShown: false, isKeyLed: false, providers: {} })

/** The box's HTML for a source's attributes (`data-tip`, `data-tip-key`, `data-tip-value`), or '' when it has none. */
export function tipHtml({ tip, tipKey, tipValue }, providers) {
  const provided = tipKey ? providers[tipKey]?.(tipValue) : undefined
  if (provided) return provided
  return tip ? escapeHtml(tip) : ''
}

/** The box's inline position for a point: from the side of the viewport with more room, so it never runs off. */
export function tipPlacement(x, y, viewport) {
  const horizontal = x > viewport.width / 2 ? `right:${Math.round(viewport.width - x + GAP.x)}px` : `left:${Math.round(x + GAP.x)}px`
  const vertical = y > viewport.height / 2 ? `bottom:${Math.round(viewport.height - y + GAP.y)}px` : `top:${Math.round(y + GAP.y)}px`
  return `${horizontal};${vertical}`
}

/**
 * The hooks the DOM listeners call: `enter(element, x, y)` when the pointer
 * reaches a tip element, `move(x, y)`, and `leave()`.
 */
export function tipHooks(tip) {
  return {
    enter(element, x, y) {
      tip.isKeyLed = false
      if (element === tip.element) return
      Object.assign(tip, { element, x, y, seconds: 0 })
    },
    move(x, y) {
      Object.assign(tip, { x, y, isKeyLed: false })
    },
    leave() {
      tip.element = null
    }
  }
}

/**
 * The element with focus that has a tip, in the panel that takes the keys; null
 * when there is none, or when the pointer moved focus last. A pointer that has
 * left leaves focus where it was, and that is no reason to keep explaining it.
 */
function focusedTipSource(state) {
  if (!state.tip.isKeyLed) return null
  return scopeOf(state.panels)?.[1].root?.querySelector('[data-focus][data-tip], [data-focus][data-tip-key]') ?? null
}

/** Advance the tooltip one frame: start, wait, place and show, or hide. Browser only. */
export function runTooltip(context, state, seconds) {
  const { tip } = state
  if (tip.element && !tip.element.isConnected) tip.element = null
  const source = tip.element ?? focusedTipSource(state)
  if (source !== tip.current) Object.assign(tip, { current: source, seconds: 0 })
  if (!source) {
    hideTooltip(context, state)
    return
  }
  tip.seconds += seconds
  if (tip.seconds < DELAY) return
  const content = tipHtml({ tip: source.dataset.tip, tipKey: source.dataset.tipKey, tipValue: source.dataset.tipValue }, tip.providers)
  if (!content) {
    hideTooltip(context, state)
    return
  }
  const viewport = context.viewport ?? FALLBACK_VIEWPORT
  // A pointer-led tip follows the pointer; a focus-led one sits under its element.
  const at = tip.element ? { x: tip.x, y: tip.y } : (({ left, bottom }) => ({ x: left, y: bottom - GAP.y }))(source.getBoundingClientRect())
  tip.html = kit.element(content, { class: 'ui-tooltip-box', style: tipPlacement(at.x, at.y, viewport) })
  if (tip.isShown) return
  tip.isShown = true
  context.gameUi.show(PANEL, { order: ORDER, html: () => tip.html })
}

function hideTooltip(context, state) {
  if (!state.tip.isShown) return
  state.tip.isShown = false
  removeNow(context, state, PANEL)
}
