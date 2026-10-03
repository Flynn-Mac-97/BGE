/**
 * Game UI draw: what one drawn frame does. Phases advance, then every panel
 * that is due asks for its HTML and is patched if the string changed, then the
 * anchors are projected and drawn (world-layer.js). It only draws: nothing here
 * may change the simulation.
 */
import { withFocus } from './controls.js'
import { runPhases } from './lifecycle.js'
import { scopeOf, settledFocus } from './menu.js'
import { createPanelElement } from './panel-element.js'
import { patchInto } from './patch.js'
import { isDue, makeUiEvent, refresh } from './records.js'
import { sheetText } from './theme.js'
import { runTooltip, tipHooks } from './tooltip.js'
import { createWorldLayer, drawAnchor, hideAnchor, placeAnchors, pruneHidden, resolveTarget } from './world-layer.js'

/** Where panels mount, and above what. Screen's canvas layer draws under the overlay. */
const REGION = 'overlay'

/** Mount order in the region: anchors under panels, so a menu covers a nameplate. */
const WORLD_ORDER = 40

/** Custom properties that must be registered in the page, not a shadow root, to animate. */
const PROPERTY_RULES = '@property --fraction { syntax: "<number>"; inherits: true; initial-value: 0; }'
let hasRegisteredProperties = false

/** Register them once. A shadow root's stylesheet cannot, so this adds a page stylesheet named by `--fraction` alone. */
function registerProperties() {
  if (hasRegisteredProperties || !('adoptedStyleSheets' in document)) return
  hasRegisteredProperties = true
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(PROPERTY_RULES)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
}

/** Draw one frame. `seconds` is the frame's length, which times a `leave`. */
export function drawFrame(context, state, seconds) {
  state.frame++
  registerProperties()
  runPhases(context, state, seconds)
  const sheet = themeSheet(state)
  drawPanels(context, state, sheet)
  drawAnchors(context, state, sheet)
  runTooltip(context, state, seconds)
}

/**
 * The one stylesheet every panel and anchor adopts. Made on first use, and
 * rewritten in place when the theme or a component file changes. The
 * components' CSS comes before the theme, so the theme can restyle a component.
 */
function themeSheet(state) {
  if (!state.sheet) state.sheet = new CSSStyleSheet()
  const version = `${state.theme.version}:${state.components.version}`
  if (state.sheetVersion !== version) {
    state.sheet.replaceSync(sheetText(`${state.components.css}\n${state.theme.css}`))
    state.sheetVersion = version
  }
  return state.sheet
}

function drawPanels(context, state, sheet) {
  for (const panel of state.panels.values()) if (isDue(panel, state.frame)) refresh(panel)
  const scope = scopeOf(state.panels)?.[1]
  for (const [id, panel] of state.panels) writePanel(context, state, id, panel, { sheet, scope })
}

/** Mount a panel on first sight, and patch its HTML only when it changed. */
function writePanel(context, state, id, panel, { sheet, scope }) {
  if (!panel.element) {
    const report = details => state.queue.push(makeUiEvent(id, details.action, details.value, details.kind, details))
    Object.assign(panel, createPanelElement(id, panel, report, tipHooks(state.tip), context.input))
    panel.element.dataset.phase = panel.phase
    panel.drawnFrame = state.frame
    panel.sheet = new CSSStyleSheet()
    panel.sheet.replaceSync(panel.css)
    // The theme first, so the panel's own css wins.
    panel.root.adoptedStyleSheets = [sheet, panel.sheet]
  }
  // Also when the page took it off since: a panel that still says it is showing
  // must be on the page. Seen once right after play started, cause not found.
  if (!panel.element.isConnected) context.ui.mount(REGION, panel.element, { plugin: 'Game UI', order: panel.order })
  const html = panel === scope ? withFocus(panel.lastHtml, settledFocus(panel, panel.lastControls)) : panel.lastHtml
  if (html === panel.written) return
  panel.written = html
  patchInto(panel.root, html)
  panel.mobile.reconcile()
  // An interactive panel with nothing on it would still take every click.
  panel.element.style.pointerEvents = panel.isInteractive && html.trim() ? 'auto' : 'none'
}

/** Project every anchor, then write only the ones placed this frame. Nothing runs when there are none. */
function drawAnchors(context, state, sheet) {
  if (!state.anchors.size || !context.renderer?.toScreen) {
    state.world.drawn = 0
    return
  }
  const layer = worldLayerOf(context, state, sheet)
  const entries = []
  for (const [id, anchor] of state.anchors) {
    const target = resolveTarget(anchor.to, context.world)
    if (target.point) entries.push({ id, anchor, entity: target.entity, point: target.point.map((value, axis) => value + anchor.offset[axis]) })
    else hideAnchor(anchor)
  }

  const placed = placeAnchors(entries, { project: context.renderer.toScreen, view: context.view, viewport: context.viewport, limit: state.world.limit })
  state.world.drawn = placed.length
  const placedAnchors = new Set(placed.map(placement => placement.anchor))
  for (const { anchor } of entries) if (!placedAnchors.has(anchor)) hideAnchor(anchor)
  for (const placement of placed) {
    if (isDue(placement.anchor, state.frame)) refresh(placement.anchor, placement.entity)
    drawAnchor(layer, placement, placement.anchor.lastHtml, state.frame)
  }
  pruneHidden(layer, state.anchors.values(), state.world.limit * 2 + 16)
}

/** The layer that holds every anchor, made and mounted when the first anchor is drawn. */
function worldLayerOf(context, state, sheet) {
  if (!state.layer) {
    const report = details => state.queue.push(makeUiEvent(details.id, details.action, details.value, details.kind, details))
    const hover = (id, name) => {
      const anchor = state.anchors.get(id)
      if (!anchor) return
      if (name && name !== anchor.hovered) state.queue.push(makeUiEvent(id, '', name, 'hover', { type: 'hover' }))
      anchor.hovered = name
    }
    state.layer = createWorldLayer({ report, hover, tip: tipHooks(state.tip) })
    state.layer.root.adoptedStyleSheets = [sheet]
  }
  if (!state.layer.element.isConnected) context.ui.mount(REGION, state.layer.element, { plugin: 'Game UI', order: WORLD_ORDER })
  return state.layer
}
