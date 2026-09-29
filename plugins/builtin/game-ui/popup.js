/**
 * Game UI popup menu: a list of choices opened at a point, such as the pointer
 * after a right click. It is a panel that takes the pointer and the menu keys,
 * so arrows, Enter and Esc work, and a click anywhere else dismisses it. A pick
 * or a dismiss hides it with a short leave, so CSS can animate it out.
 */
import { kit } from './components.js'

const PANEL = 'ui:menu'
const RADIAL_PANEL = 'ui:radial'

/** Pixels from a wheel's centre to its outermost edge beyond the item radius: half an item, and a margin. */
const WHEEL_MARGIN = 48

/** What the menu is placed against when a context has no viewport, and its size guesses for keeping it on screen. */
const FALLBACK_VIEWPORT = { width: 1280, height: 720 }
const MENU_WIDTH = 200
const ROW_HEIGHT = 36
const EDGE = 8

const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)))

/** Where a menu of `rowCount` rows opens for a pointer at `at`: moved in so it stays inside the viewport. */
export function menuPlacement(at, rowCount, viewport) {
  const height = rowCount * ROW_HEIGHT + EDGE * 2
  return { x: clamp(at.x, EDGE, viewport.width - MENU_WIDTH - EDGE), y: clamp(at.y, EDGE, viewport.height - height - EDGE) }
}

/**
 * Open a menu. `at` is `{ x, y }` in overlay pixels (an event has both);
 * `items` are `{ label, value, isDisabled, kind }` or `{ isDivider: true }`;
 * `onPick(value)` runs on the next fixed step. Replaces one already open.
 */
export function openMenu(context, { at, items, onPick }) {
  const { x, y } = menuPlacement(at, items.length, context.viewport ?? FALLBACK_VIEWPORT)
  const close = () => context.gameUi.hide(PANEL)
  context.gameUi.show(PANEL, {
    isInteractive: true,
    leave: 0.12,
    html: kit.contextMenu(items, { x, y }),
    on: { pick: value => { close(); onPick?.(value) }, dismiss: close, back: close }
  })
  return PANEL
}

/** Where a wheel's centre goes for a pointer at `at`: moved in so every item stays inside the viewport. */
export function radialPlacement(at, radius, viewport) {
  const reach = radius + WHEEL_MARGIN
  return { x: clamp(at.x, reach, viewport.width - reach), y: clamp(at.y, reach, viewport.height - reach) }
}

/**
 * Open a wheel of choices around `at` (`{ x, y }`; the middle of the viewport
 * when left out). `items` are `{ label, value, glyph, isDisabled }`;
 * `onPick(value)` runs on the next fixed step. It takes the pointer and the menu
 * keys, and `gameUi.pickFocused('ui:radial')` picks what is under the pointer
 * or stick, for a wheel that opens while a key is held and picks on release.
 */
export function openRadial(context, { at, items, radius = 110, onPick }) {
  const viewport = context.viewport ?? FALLBACK_VIEWPORT
  const { x, y } = radialPlacement(at ?? { x: viewport.width / 2, y: viewport.height / 2 }, radius, viewport)
  const close = () => context.gameUi.hide(RADIAL_PANEL)
  context.gameUi.show(RADIAL_PANEL, {
    isInteractive: true,
    leave: 0.12,
    html: kit.radial(items, { x, y, radius }),
    on: { pick: value => { close(); onPick?.(value) }, dismiss: close, back: close }
  })
  return RADIAL_PANEL
}
