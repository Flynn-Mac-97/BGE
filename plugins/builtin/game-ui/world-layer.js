/**
 * Game UI world layer: HTML that follows points in the world.
 *
 * A nameplate over an enemy, a prompt over a door, a damage number where a hit
 * landed. Every anchor is in one shared shadow root, so the theme sheet is
 * adopted once no matter how many anchors there are. Each frame costs:
 *
 * - one projection per anchor, before any DOM is touched;
 * - no DOM and no `html` call for an anchor that is off screen, behind the
 *   camera, farther than its `maxDistance`, or past the layer's `limit`
 *   (the nearest to the view are kept);
 * - one `transform` write, and only when the rounded pixel moved. Nothing lays
 *   out: an anchor is `position:absolute` at the origin and moved by transform.
 *
 * `placeAnchors` and `resolveTarget` are pure, so culling is tested with no
 * browser. Browser code is `createWorldLayer` and `drawAnchor`.
 */
import { watchRoot } from './panel-element.js'
import { patchInto } from './patch.js'

/** How far outside the viewport an anchor is still drawn, so one sliding in is already there. */
const MARGIN = 64

/** The scale range `scaleByDistance` may reach. */
const SCALE_RANGE = [0.4, 1.6]

const pointOf = entity => [entity.x, entity.y, entity.z ?? 0]
const isEntity = value => value && typeof value === 'object' && !Array.isArray(value)

/**
 * What an anchor follows this frame: `{ entity, point, isGone }`. `point` is
 * null when there is nothing to follow (a function said null). `isGone` is
 * true only for an entity id that no longer exists, so its anchor is removed.
 */
export function resolveTarget(to, world) {
  const target = typeof to === 'function' ? to() : to
  if (typeof target === 'string') {
    const entity = world.byId(target)
    return entity ? { entity, point: pointOf(entity), isGone: false } : { entity: null, point: null, isGone: typeof to !== 'function' }
  }
  if (isEntity(target)) return { entity: target, point: pointOf(target), isGone: false }
  return { entity: null, point: Array.isArray(target) ? [target[0], target[1], target[2] ?? 0] : null, isGone: false }
}

/**
 * The anchors to draw, nearest to the view first, each with its pixel.
 * `entries` are `{ id, anchor, entity, point }` with the offset already added; each placement carries them on.
 * `project(x, y, z)` is `renderer.toScreen`.
 */
export function placeAnchors(entries, { project, view, viewport, limit }) {
  const placed = []
  for (const entry of entries) {
    const { anchor, point } = entry
    const pixel = project(point[0], point[1], point[2])
    if (pixel.behind) continue
    if (pixel.x < -MARGIN || pixel.y < -MARGIN || pixel.x > viewport.width + MARGIN || pixel.y > viewport.height + MARGIN) continue
    const distance = Math.hypot(point[0] - view.x, point[1] - view.y, point[2] - (view.z ?? 0))
    if (distance > anchor.maxDistance) continue
    placed.push({ ...entry, x: pixel.x, y: pixel.y, distance })
  }
  return placed.length > limit ? placed.sort((first, second) => first.distance - second.distance).slice(0, limit) : placed
}

/** The transform that puts an anchor's pivot on a pixel. The origin is the top left, so scaling keeps the pivot still. */
export function transformOf(anchor, { x, y, distance }) {
  const [pivotX, pivotY] = anchor.pivot
  const scale = anchor.scaleByDistance > 0 ? Math.min(Math.max(anchor.scaleByDistance / (distance || 1), SCALE_RANGE[0]), SCALE_RANGE[1]) : 1
  return `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale.toFixed(2)}) translate(${-pivotX * 100}%, ${-pivotY * 100}%)`
}

/** The one element that holds every anchor. `report` and `hover` are as for `watchRoot`; `hover` also gets the anchor's id. */
export function createWorldLayer({ report, hover, tip }) {
  const element = document.createElement('div')
  element.dataset.gameUi = 'world'
  element.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none'
  const root = element.attachShadow({ mode: 'open' })
  const anchorIdOf = target => target?.closest?.('[data-anchor]')?.dataset.anchor
  watchRoot(root, {
    report: details => report({ ...details, id: anchorIdOf(details.target) }),
    hover: (name, target) => hover(anchorIdOf(target), name),
    tip
  })
  return { element, root }
}

/** Put an anchor's element in the layer the first time it is seen. */
function ensureAnchorElement(layer, id, anchor, frame) {
  if (anchor.element) return
  anchor.element = document.createElement('div')
  anchor.element.className = 'ui-anchor'
  anchor.element.dataset.anchor = id
  anchor.element.dataset.phase = anchor.phase
  anchor.drawnFrame = frame
  if (anchor.isInteractive) anchor.element.dataset.interactive = ''
  layer.root.append(anchor.element)
}

/** Show one placed anchor: its HTML when it changed, and its transform when the pixel moved. */
export function drawAnchor(layer, placement, html, frame) {
  const { id, anchor } = placement
  ensureAnchorElement(layer, id, anchor, frame)
  if (anchor.isHidden !== false) {
    anchor.element.hidden = false
    anchor.isHidden = false
  }
  if (html !== anchor.written) {
    anchor.written = html
    patchInto(anchor.element, html, layer.root)
  }
  const transform = transformOf(anchor, placement)
  if (transform === anchor.placedTransform) return
  anchor.placedTransform = transform
  anchor.element.style.transform = transform
}

/** Hide an anchor that is not placed this frame. Once: a hidden anchor costs nothing after. */
export function hideAnchor(anchor) {
  if (!anchor.element || anchor.isHidden) return
  anchor.element.hidden = true
  anchor.isHidden = true
}

/** Take an anchor's element out of the layer. It is made again if the anchor is drawn again. */
export function removeAnchorElement(anchor) {
  anchor.element?.remove()
  Object.assign(anchor, { element: null, written: null, placedTransform: '', isHidden: null })
}

/**
 * Drop the elements of hidden anchors once the layer holds more than `keep`.
 * A crowd whose nearest few change keeps making elements; without this the
 * page would grow to one per anchor that was ever near.
 */
export function pruneHidden(layer, anchors, keep) {
  if (layer.root.childElementCount <= keep) return
  for (const anchor of anchors) if (anchor.isHidden) removeAnchorElement(anchor)
}
