/**
 * Game UI — HTML and CSS a game shows over its own picture: panels, world-space
 * anchors, and a kit of components to build both from.
 *
 * Screen draws a game screen from a small item vocabulary on a canvas. This is
 * the other way: HTML, styled with CSS, for what is easier to write as a page.
 * It mounts into the kernel's `overlay` region through `context.ui.mount`.
 *
 *   const { stack, heading, button } = context.gameUi.kit
 *   context.gameUi.show('shop', {
 *     isInteractive: true,
 *     html: () => stack([heading('Shop'), button('Buy', { action: 'buy', kind: 'primary' })]),
 *     on: { buy: () => { gold -= 10 } }
 *   })
 *   context.gameUi.anchor('tag:7', { to: 'enemy7', offset: [0, 2, 0], html: enemy => `<b>${enemy.name}</b>` })
 *
 * - A panel fills the viewport. An anchor is a small box that follows a world
 *   point, one shadow root for all of them, culled and limited (world-layer.js).
 * - One stylesheet. `assets/ui/theme.css` styles every panel and anchor, and its
 *   colour tokens colour Screen and the HUD too (theme.js). It is plain CSS: any
 *   selector, any property. Every kit component also takes `class` and `style`.
 * - Events are the game's. Any kit control, and any element made with
 *   `kit.target`, names its own `action` and the DOM events that raise it.
 *   `on` maps `action` or `action:type` to `(value, event) => {}`. A report is
 *   queued and its handler runs on the next fixed step, so a replay repeats it.
 *   `click` does the same from a test, and `controls` lists what a panel offers.
 * - Keyboard focus. The last interactive (or `takesKeys`) panel with a control takes the `uiUp`
 *   `uiDown` `uiLeft` `uiRight` `uiConfirm` and `uiBack` actions (menu.js).
 * - Cost. `html` is asked each drawn frame, or each `every`-th; the DOM is
 *   patched only when the string changed (patch.js).
 *
 * Panels and anchors belong to the run that showed them: they are cleared on
 * `level:loaded` and `play:stopped`, like Screen's. The theme is the game's and stays.
 */
import { assetPath, assetURL } from '../../engine/asset-path.js'
import { kit } from './game-ui/components.js'
import { controlsOf, TRIGGER, withFocus } from './game-ui/controls.js'
import { bindMenuKeys, moveFocus, scopeOf, settledFocus } from './game-ui/menu.js'
import { createPanelElement } from './game-ui/panel-element.js'
import { patchInto } from './game-ui/patch.js'
import { advancePhase, htmlOf, isDue, makeAnchor, makePanel, makeUiEvent, refresh, startLeaving, textOf } from './game-ui/records.js'
import { hudPaletteOf, screenPaletteOf, sheetText, tokensOf } from './game-ui/theme.js'
import { createWorldLayer, drawAnchor, hideAnchor, placeAnchors, pruneHidden, removeAnchorElement, resolveTarget } from './game-ui/world-layer.js'

/** Where panels mount, and above what. Screen's canvas layer draws under the overlay. */
const REGION = 'overlay'

/** Mount order in the region: anchors under panels, so a menu covers a nameplate. */
const WORLD_ORDER = 40

/** The game's stylesheet, as an asset name. */
const THEME_FILE = 'ui/theme.css'

/** context -> its state, so the systems reach it without putting it on `context.gameUi`. */
const stateOf = new WeakMap()

/** One theme. `kind` is `default` (no file yet), `file` (read from `name`) or `code` (given as text). */
const makeTheme = ({ css, kind, name, version }) => ({ css, kind, name, version, tokens: tokensOf(css) })

export default {
  name: 'Game UI',
  category: 'game',
  about: 'HTML and CSS panels, world-space anchors, a component kit and one theme for a game.',
  // Loaded after the surfaces it themes and the keys it reads.
  needs: ['Screen', 'Heads Up Display', 'Keyboard Input'],

  onLoad(context) {
    const state = {
      panels: new Map(),
      anchors: new Map(),
      queue: [],
      theme: makeTheme({ css: '', kind: 'default', name: THEME_FILE, version: 0 }),
      sheet: null,
      sheetVersion: -1,
      layer: null,
      hasBoundKeys: false,
      frame: 0,
      shownCount: 0,
      // `limit` is the most anchors drawn at once; past it, the nearest to the view are kept.
      // `drawn` is how many the last frame drew.
      world: { limit: 48, drawn: 0 }
    }
    stateOf.set(context, state)

    const recordOf = id => state.panels.get(id) ?? state.anchors.get(id)

    /** What an anchor follows now, so its `html` and handlers can be given the entity. Panels have none. */
    const targetOf = record => (record?.kind === 'anchor' ? resolveTarget(record.to, context.world).entity : undefined)

    const remove = id => removeNow(context, state, id)

    const useTheme = (css, kind, name) => {
      state.theme = makeTheme({ css, kind, name, version: state.theme.version + 1 })
      Object.assign(context.screen?.palette ?? {}, screenPaletteOf(state.theme.tokens))
      Object.assign(context.hud?.palette ?? {}, hudPaletteOf(state.theme.tokens))
    }

    const loadTheme = async (name = THEME_FILE) => useTheme(await context.files.read(assetPath(name)), 'file', name)

    /** The enabled control an action names, taking the one with this value when several share the action. */
    const controlFor = (id, action, value) => {
      const record = recordOf(id)
      if (!record || record.phase === 'leaving') return undefined
      refresh(record, targetOf(record))
      const candidates = record.lastControls.filter(control => control.action === action && !control.isDisabled)
      return candidates.find(control => String(control.value) === String(value)) ?? candidates[0]
    }

    context.gameUi = {
      /** The components: functions from values to HTML. See game-ui/components.js. */
      kit,

      /**
       * Show a panel, or replace the one under this id. `html` is a string or a
       * function returning one; `css` is scoped to this panel and beats the
       * theme. A panel lets clicks through to the game unless `isInteractive`
       * is true; `takesKeys` gives it the menu keys without taking the pointer.
       * `on` maps an action (or `action:type`) to `(value, event) => {}`.
       * `every: n` asks `html` every n-th frame.
       */
      show(id, options) {
        remove(id)
        state.panels.set(id, makePanel(options, state.shownCount++))
      },

      /**
       * Show a piece of HTML that follows a point in the world; see makeAnchor
       * in game-ui/records.js for the options. `html` is given the entity when
       * `to` names one. An anchor whose entity id no longer exists is removed.
       */
      anchor(id, options) {
        remove(id)
        state.anchors.set(id, makeAnchor(options, state.shownCount++))
      },

      /**
       * Take a panel or an anchor down. One made with `leave: seconds` stays
       * for that long in its `leaving` phase, so CSS can animate it out.
       * False when there was none.
       */
      hide(id) {
        const record = recordOf(id)
        if (!record || record.phase === 'leaving') return false
        if (record.leave > 0 && record.element) startLeaving(record)
        else remove(id)
        return true
      },
      isShowing: id => Boolean(recordOf(id)) && recordOf(id).phase !== 'leaving',

      /** The `data-ui` name of the element under the pointer in a panel or anchor, or null. */
      hovered: id => recordOf(id)?.hovered ?? null,
      shown: () => [...state.panels, ...state.anchors].filter(([, record]) => record.phase !== 'leaving').map(([id]) => id),

      /** Anchor cost: `world.limit` is the most drawn at once, `world.drawn` what the last frame drew. */
      world: state.world,

      /** A record's text, or every one's by id. What a headless run reads. */
      read(id) {
        if (id !== undefined) return textOf(htmlOf(recordOf(id), targetOf(recordOf(id))))
        return Object.fromEntries(context.gameUi.shown().map(key => [key, context.gameUi.read(key)]))
      },

      /** The controls a panel or anchor offers, in order, each with `isFocused`. `[]` for an unknown id. */
      controls(id) {
        const record = recordOf(id)
        if (!record) return []
        refresh(record, targetOf(record))
        const scope = scopeOf(state.panels)
        const focused = scope?.[1] === record ? settledFocus(record, record.lastControls) : -1
        return record.lastControls.map((control, index) => ({ ...control, isFocused: index === focused }))
      },

      /**
       * Use a control as a person would: `type` is one of its triggers (its
       * first when left out). The handler runs on the next fixed step. A
       * control raised by a click-like event sends its own value; a toggle,
       * slider, select or text field sends `value`. False when no enabled
       * control has this action and trigger.
       */
      click(id, action, value, type) {
        const control = controlFor(id, action, value)
        const raised = type ?? control?.triggers[0]
        if (!control || !control.triggers.includes(raised)) return false
        const sendsOwnValue = raised !== TRIGGER[control.kind] || raised === 'click'
        state.queue.push(makeUiEvent(id, action, sendsOwnValue ? control.value : value, control.kind, { type: raised }))
        return true
      },

      /** The theme: `use(css)` applies text, `load(name)` reads an asset, `tokens()` is what Screen and the HUD read. */
      theme: {
        use: css => useTheme(css, 'code', ''),
        load: loadTheme,
        tokens: () => ({ ...state.theme.tokens }),
        name: () => state.theme.name,
        kind: () => state.theme.kind
      },

      /** The URL of a project asset, for an `<img src>`: `ui/portrait.png` is under `assets/`. */
      asset: assetURL
    }

    const clearRun = () => {
      for (const id of [...state.panels.keys(), ...state.anchors.keys()]) remove(id)
      state.queue.length = 0
    }
    context.bus.on('play:stopped', clearRun)
    context.bus.on('level:loaded', () => {
      clearRun()
      // A theme given as text is the code's; only a file is read again.
      if (state.theme.kind !== 'code') loadTheme(state.theme.name).catch(() => {})
    })
    // A stylesheet the person edits reaches the open game with no reload.
    context.bus.on('hot:applied', change => {
      if (state.theme.kind !== 'code' && change.file?.endsWith(assetPath(state.theme.name))) loadTheme(state.theme.name).catch(() => {})
    })
  },

  systems: [
    {
      // Fixed, because a click changes the game: it has to land on the same
      // step on every replay or simulate() stops repeating.
      phase: 'fixed',
      run(world, seconds, context) {
        const state = stateOf.get(context)
        if (!state) return
        bindMenuKeys(context, state)
        moveFocus(context, state)
        runHandlers(context, state)
        dropGoneAnchors(context, state)
      }
    },
    {
      // Frame, because it only draws. Nothing here may change the simulation.
      phase: 'frame',
      run(world, seconds, context) {
        const state = stateOf.get(context)
        if (!state || !context.ui || typeof document === 'undefined') return
        state.frame++
        runPhases(context, state, seconds)
        const sheet = themeSheet(state)
        drawPanels(context, state, sheet)
        drawAnchors(context, state, sheet)
      }
    }
  ],

  commands: [
    { id: 'gameui.read', label: 'Game UI text', run: (context, id) => context.gameUi.read(typeof id === 'string' ? id : id?.id) },
    { id: 'gameui.list', label: 'Game UI panels and anchors showing', run: context => context.gameUi.shown() },
    { id: 'gameui.controls', label: 'Game UI controls', run: (context, id) => context.gameUi.controls(typeof id === 'string' ? id : id?.id) },
    { id: 'gameui.click', label: 'Use a Game UI control', run: (context, { id, action, value, type }) => context.gameUi.click(id, action, value, type) },
    {
      id: 'gameui.theme',
      label: 'Game UI theme',
      run: async (context, name) => {
        if (typeof name === 'string') await context.gameUi.theme.load(name)
        return { kind: context.gameUi.theme.kind(), name: context.gameUi.theme.name(), tokens: context.gameUi.theme.tokens() }
      }
    }
  ]
}

// ---------------------------------------------------------------- handlers

/** Run this step's queued events. A handler that throws is named and skipped. */
function runHandlers(context, state) {
  for (const event of state.queue.splice(0)) {
    const record = state.panels.get(event.id) ?? state.anchors.get(event.id)
    const handler = record?.phase === 'leaving' ? undefined : record?.on[`${event.action}:${event.type}`] ?? record?.on[event.action]
    if (!handler) continue
    const entity = record.kind === 'anchor' ? resolveTarget(record.to, context.world).entity : null
    try { handler(event.value, { ...event, entity }) } catch (error) {
      console.error(`[game-ui] the "${event.action}" handler of "${event.id}" failed`, error)
    }
  }
}

/** Take down the anchor of an entity that no longer exists. Here and not in the frame, so a headless run does it too. */
function dropGoneAnchors(context, state) {
  for (const [id, anchor] of state.anchors) if (resolveTarget(anchor.to, context.world).isGone) removeNow(context, state, id)
}

/** Take a panel or anchor down at once, whatever its `leave`. */
function removeNow(context, state, id) {
  const record = state.panels.get(id) ?? state.anchors.get(id)
  if (!record) return false
  if (record.kind === 'panel' && record.element) context.ui?.unmount(record.element)
  if (record.kind === 'anchor') removeAnchorElement(record)
  state.panels.delete(id)
  state.anchors.delete(id)
  return true
}

/** Advance every record's phase for a frame, remove those done leaving, and mirror the phase onto each element. */
function runPhases(context, state, seconds) {
  for (const records of [state.panels, state.anchors]) {
    for (const [id, record] of records) {
      if (advancePhase(record, state.frame, seconds)) removeNow(context, state, id)
      else if (record.element && record.element.dataset.phase !== record.phase) record.element.dataset.phase = record.phase
    }
  }
}

// ---------------------------------------------------------------- drawing

/** The one stylesheet every panel and anchor adopts. Made on first use, and rewritten in place when the theme changes. */
function themeSheet(state) {
  if (!state.sheet) state.sheet = new CSSStyleSheet()
  if (state.sheetVersion !== state.theme.version) {
    state.sheet.replaceSync(sheetText(state.theme.css))
    state.sheetVersion = state.theme.version
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
    Object.assign(panel, createPanelElement(id, panel, report))
    panel.element.dataset.phase = panel.phase
    panel.drawnFrame = state.frame
    panel.sheet = new CSSStyleSheet()
    panel.sheet.replaceSync(panel.css)
    // The theme first, so the panel's own css wins.
    panel.root.adoptedStyleSheets = [sheet, panel.sheet]
  }
  // Also when the page took it off since: a panel that still says it is showing
  // must be on the page. Seen once right after play started, cause not found.
  if (!panel.element.isConnected) context.ui.mount(REGION, panel.element, { plugin: 'Game UI' })
  const html = panel === scope ? withFocus(panel.lastHtml, settledFocus(panel, panel.lastControls)) : panel.lastHtml
  if (html === panel.written) return
  panel.written = html
  patchInto(panel.root, html)
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
    const hover = (id, name) => { const anchor = state.anchors.get(id); if (anchor) anchor.hovered = name }
    state.layer = createWorldLayer({ report, hover })
    state.layer.root.adoptedStyleSheets = [sheet]
  }
  if (!state.layer.element.isConnected) context.ui.mount(REGION, state.layer.element, { plugin: 'Game UI', order: WORLD_ORDER })
  return state.layer
}
