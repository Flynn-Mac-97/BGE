/**
 * Game UI records: the two things Game UI shows, and what is read from them.
 *
 * `kind` is `panel` (a full-viewport HTML page over the game) or `anchor` (a
 * small piece of HTML that follows a point in the world). Both carry `html`,
 * `on` and `every`, so one `hide`, `read`, `controls` and `click` serve both.
 *
 * `isInteractive` takes the whole viewport's pointer; `takesKeys` takes only the
 * menu keys, so a card can be navigated while the game and the anchors under it
 * keep the mouse.
 *
 * `html` is a string or a function asked when a frame draws it; `every: 4` asks
 * it every fourth frame. The last string is kept with its parsed controls, so
 * an unchanged panel costs one string compare, not a parse.
 */
import { controlsOf } from './controls.js'

/**
 * A panel, before its element exists. `phase` staggers its `every` so panels
 * that share a period do not all draw on one frame.
 */
export const makePanel = ({ html, css = '', isInteractive = false, takesKeys = false, on = {}, every = 1 }, phase) => ({
  kind: 'panel', html, css, isInteractive, takesKeys, on, every, phase,
  element: null, root: null, sheet: null, written: null, hovered: null, focusIndex: -1, lastHtml: null, lastControls: []
})

/**
 * An anchor. `to` is an entity id, an entity, a `[x, y, z]` point, or a
 * function returning one of those (or null to hide). `offset` is added to the
 * point in world units; `pivot` is the part of the box placed on the point
 * (`[0.5, 1]` is bottom centre); `maxDistance` culls it beyond that many world
 * units from the view; `scaleByDistance: d` scales it by `d / distance`.
 */
export const makeAnchor = ({ to, html, on = {}, offset = [0, 0, 0], pivot = [0.5, 1], maxDistance = Infinity, scaleByDistance = 0, isInteractive = false, every = 1 }, phase) => ({
  kind: 'anchor', to, html, on, offset, pivot, maxDistance, scaleByDistance, isInteractive, every, phase,
  element: null, written: null, hovered: null, isHidden: null, placedTransform: '', lastHtml: null, lastControls: []
})

/**
 * What a control did, queued for the next fixed step. `type` is the DOM event
 * (or `key`); `x` and `y` are the pointer in the overlay's pixels.
 */
export const makeUiEvent = (id, action, value, kind, details = {}) =>
  ({ id, action, value, kind, type: details.type ?? 'click', x: details.x ?? 0, y: details.y ?? 0, entity: null })

/** A record's HTML this moment. A function that throws shows nothing rather than breaking the frame. */
export function htmlOf(record, target) {
  if (!record) return ''
  if (typeof record.html !== 'function') return String(record.html ?? '')
  try { return String(record.html(target) ?? '') } catch (error) {
    console.error('[game-ui] a panel could not be built', error)
    return ''
  }
}

/** Ask for the HTML, and re-read its controls only when the string changed. */
export function refresh(record, target) {
  const html = htmlOf(record, target)
  if (html !== record.lastHtml) {
    record.lastHtml = html
    record.lastControls = controlsOf(html)
  }
  return html
}

/** Whether a frame should ask this record for its HTML: the first time, then every `every`-th frame. */
export const isDue = (record, frame) => record.lastHtml === null || record.every <= 1 || (frame + record.phase) % record.every === 0

/** The words a record shows: tags dropped, entities for the common few read back, space folded. */
export function textOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
