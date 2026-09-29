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
 * A panel, before its element exists. `stagger` offsets its `every` so panels
 * that share a period do not all draw on one frame. `leave` is the seconds a
 * hidden panel stays on screen in the `leaving` phase, for an exit animation.
 */
export const makePanel = ({ html, css = '', isInteractive = false, takesKeys = false, on = {}, every = 1, leave = 0 }, stagger) => ({
  kind: 'panel', html, css, isInteractive, takesKeys, on, every, stagger, leave,
  phase: 'entering', leaveLeft: 0, drawnFrame: -1,
  element: null, root: null, sheet: null, written: null, hovered: null, focusIndex: -1, lastHtml: null, lastControls: []
})

/**
 * An anchor. `to` is an entity id, an entity, a `[x, y, z]` point, or a
 * function returning one of those (or null to hide). `offset` is added to the
 * point in world units; `pivot` is the part of the box placed on the point
 * (`[0.5, 1]` is bottom centre); `maxDistance` culls it beyond that many world
 * units from the view; `scaleByDistance: d` scales it by `d / distance`.
 */
export const makeAnchor = ({ to, html, on = {}, offset = [0, 0, 0], pivot = [0.5, 1], maxDistance = Infinity, scaleByDistance = 0, isInteractive = false, every = 1, leave = 0 }, stagger) => ({
  kind: 'anchor', to, html, on, offset, pivot, maxDistance, scaleByDistance, isInteractive, every, stagger, leave,
  phase: 'entering', leaveLeft: 0, drawnFrame: -1,
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

/**
 * A record's phase is `entering` (its element just appeared), `open`, or
 * `leaving` (hidden, waiting out `leave` seconds). The element carries it as
 * `data-phase`, so CSS animates each one. This begins the exit of a record
 * whose `leave` is more than zero.
 */
export function startLeaving(record) {
  record.phase = 'leaving'
  record.leaveLeft = record.leave
}

/**
 * Move a record along its phases for one frame; true when it is done leaving.
 * A record opens on the frame after its element first appears, so a CSS
 * transition has an `entering` state to start from.
 */
export function advancePhase(record, frame, seconds) {
  if (record.phase === 'entering' && record.element && frame > record.drawnFrame) record.phase = 'open'
  if (record.phase !== 'leaving') return false
  record.leaveLeft -= seconds
  return record.leaveLeft <= 0
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
export const isDue = (record, frame) => record.lastHtml === null || record.every <= 1 || (frame + record.stagger) % record.every === 0

/** The words a record shows: tags dropped, entities for the common few read back, space folded. */
export function textOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
