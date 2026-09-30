/**
 * Game UI drag and drop: pick up an element with `data-drag`, drop it on an
 * element with `data-drop`, across panels and anchors. Browser only.
 *
 * It follows the mouse or a finger, not HTML5 drag events, which do not cross
 * shadow roots well and are absent headless. The start is a `mousedown` or a
 * `touchstart`, because Mouse Look stops `pointerdown` from reaching the overlay
 * while a game plays. A dragged element is `touch-action: none` (base CSS), so
 * the page does not scroll under the finger.
 *
 * Three reports reach a panel's `on` table: `drag:dragstart` and `drag:dragend`
 * (value: the payload) from the source's panel, and `<zone action>:drop` (value:
 * `{ drag, drop }`) from the zone's panel. The source gets `data-dragging`, the
 * zone under the pointer gets `data-drop-hot`, and a copy of the source, class
 * `ui-drag-ghost`, follows the pointer.
 */

/** Pixels the pointer must move before a press becomes a drag, so a click still clicks. */
const START_DISTANCE = 4

/** root -> its `report`. Every root that listens, so a drop finds a zone in any of them. */
const roots = new Map()

/** The drag in progress, or null. */
let current = null
let isListening = false

/** Listen for a drag to start in `root`. `report` is the panel's, as for watchRoot. */
export function watchDrag(root, report) {
  roots.set(root, report)
  root.addEventListener('mousedown', event => press(event, root, report, event.button === 0))
  root.addEventListener('touchstart', event => press(event, root, report, event.touches.length === 1), { passive: false })
  if (isListening || typeof window === 'undefined') return
  isListening = true
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', release)
  window.addEventListener('touchmove', move, { passive: false })
  window.addEventListener('touchend', release)
  window.addEventListener('touchcancel', release)
}

/** Where a mouse event or a touch event is: the mouse event itself, or the first finger. */
const pointOf = event => event.touches?.[0] ?? event.changedTouches?.[0] ?? event

function press(event, root, report, isPrimary) {
  const source = isPrimary ? event.target.closest?.('[data-drag]') : null
  if (!source) return
  // Without this the browser starts selecting text under a mouse drag, or scrolling under a finger.
  event.preventDefault()
  const point = pointOf(event)
  current = { source, root, report, payload: source.dataset.drag, startX: point.clientX, startY: point.clientY, ghost: null, zone: null }
}

function move(event) {
  if (!current) return
  const point = pointOf(event)
  if (!current.ghost) {
    if (Math.hypot(point.clientX - current.startX, point.clientY - current.startY) < START_DISTANCE) return
    begin(event)
  }
  // A finger's move would scroll the page; once dragging, it is the drag's.
  if (event.cancelable) event.preventDefault()
  current.ghost.style.transform = `translate(${point.clientX + 8}px, ${point.clientY + 8}px)`
  const zone = zoneAt(point.clientX, point.clientY)
  if (zone?.element === current.zone?.element) return
  current.zone?.element.removeAttribute('data-drop-hot')
  zone?.element.setAttribute('data-drop-hot', '')
  current.zone = zone
}

/** Start the drag: mark the source, make the ghost, and say so. */
function begin(event) {
  const { source, root, report, payload } = current
  const ghost = source.cloneNode(true)
  for (const name of ['data-drag', 'data-drop', 'data-ui-control', 'data-action']) ghost.removeAttribute(name)
  ghost.classList.add('ui-drag-ghost')
  root.append(ghost)
  source.setAttribute('data-dragging', '')
  current.ghost = ghost
  const point = pointOf(event)
  report({ action: 'drag', value: payload, kind: 'drag', type: 'dragstart', x: point.clientX, y: point.clientY, target: source })
}

function release(event) {
  if (!current) return
  const { source, report, payload, ghost, zone } = current
  current = null
  if (!ghost) return
  ghost.remove()
  source.removeAttribute('data-dragging')
  zone?.element.removeAttribute('data-drop-hot')
  const point = pointOf(event)
  const details = { x: point.clientX, y: point.clientY }
  if (zone) zone.report({ ...details, action: zone.element.dataset.drop, value: { drag: payload, drop: zone.element.dataset.dropValue ?? '' }, kind: 'drop', type: 'drop', target: zone.element })
  report({ ...details, action: 'drag', value: payload, kind: 'drag', type: 'dragend', target: source })
  // The mouse comes up over the drop zone, but a drop on the source itself would still click it.
  window.addEventListener('click', stopEvent => stopEvent.stopPropagation(), { capture: true, once: true })
}

/** The drop zone under a point, in any watched root: `{ element, report }`, or null. */
function zoneAt(x, y) {
  for (const [root, report] of roots) {
    for (const found of root.elementsFromPoint(x, y)) {
      const element = found.closest('[data-drop]')
      if (element) return { element, report }
    }
  }
  return null
}
