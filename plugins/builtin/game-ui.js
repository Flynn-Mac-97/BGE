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
import { escapeHtml, kit } from './game-ui/components.js'
import { dragsOf, dropsOf, TRIGGER } from './game-ui/controls.js'
import { drawFrame } from './game-ui/draw.js'
import { dropGoneAnchors, removeNow } from './game-ui/lifecycle.js'
import { makeNotifications } from './game-ui/notifications.js'
import { openMenu } from './game-ui/popup.js'
import { bindMenuKeys, moveFocus, scopeOf, settledFocus } from './game-ui/menu.js'
import { htmlOf, makeAnchor, makePanel, makeUiEvent, refresh, startLeaving, textOf } from './game-ui/records.js'
import { hudPaletteOf, screenPaletteOf, tokensOf } from './game-ui/theme.js'
import { revealedChars } from './game-ui/typewriter.js'
import { resolveTarget } from './game-ui/world-layer.js'

/** The most floating texts alive at once. The oldest go first, so a burst of hits cannot grow the page. */
const FLOAT_CAP = 200

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
      floatCount: 0,
      floats: [],
      capture: null,
      // `limit` is the most anchors drawn at once; past it, the nearest to the view are kept.
      // `drawn` is how many the last frame drew.
      world: { limit: 48, drawn: 0 }
    }
    stateOf.set(context, state)

    const notifications = makeNotifications(context, state)

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
      const exact = candidates.find(control => String(control.value) === String(value))
      // A control raised by a click sends its own value, so another one's is no substitute. Others take `value` as the new value.
      return exact ?? candidates.find(control => value === undefined || TRIGGER[control.kind] !== 'click')
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
       * Show short-lived text at a point: a damage number, a pickup. `at` is
       * an entity id, an entity or a `[x, y, z]` point, read once, so the text
       * stays where it happened. It rises and fades over `life` seconds of game
       * time (a `tone` of `danger`, `good` or `accent` colours it), then goes.
       * Answers the id, or '' when `at` names nothing.
       */
      float(text, { at, life = 1, offset = [0, 1.2, 0], tone, class: className = '', html } = {}) {
        const { point } = resolveTarget(at, context.world)
        if (!point) return ''
        const id = `float:${state.floatCount++}`
        const content = kit.element(html ?? escapeHtml(text), { class: `ui-floating ${className}`.trim(), style: `--life:${life}s`, attributes: { 'data-tone': tone } })
        context.gameUi.anchor(id, { to: point, offset, html: content })
        state.floats.push(id)
        context.after(life, () => removeNow(context, state, id))
        for (const stale of state.floats.splice(0, Math.max(0, state.floats.length - FLOAT_CAP))) removeNow(context, state, stale)
        return id
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

      /**
       * A line that types itself out at `speed` characters a second of game
       * time, starting now. `chars()` is how much shows, for `kit.dialogue`;
       * `skip()` shows it all; `isDone()`; `restart(text)` starts a new line.
       */
      typewriter(text, { speed = 30 } = {}) {
        const line = { text, speed, startedAt: context.time }
        return {
          get text() { return line.text },
          chars: () => revealedChars(line.text, context.time - line.startedAt, line.speed),
          isDone: () => revealedChars(line.text, context.time - line.startedAt, line.speed) >= line.text.length,
          skip() { line.startedAt = -Infinity },
          restart(next) { Object.assign(line, { text: next ?? line.text, startedAt: context.time }) }
        }
      },

      /** Show a message in the notifications stack, for `life` seconds of game time. See game-ui/notifications.js. */
      notify: notifications.notify,

      /** Open a menu of choices at `at` (`{ x, y }`, as a pointer event has), and run `onPick(value)` on a pick. See game-ui/popup.js. */
      menu: options => openMenu(context, options),

      /**
       * Take the next key press for `callback(code)` on the next fixed step:
       * for a rebinding row. Esc cancels with `null`. While waiting, Game UI
       * keeps the key from its own menu, and `isCapturing()` is true so a game
       * can ignore its bindings. Replaces a capture already waiting.
       */
      captureKey(callback) {
        state.capture = callback
      },
      isCapturing: () => Boolean(state.capture),

      /** Give a key press to a waiting `captureKey`, as the page's keydown does. True when it was taken. */
      feedKey(code) {
        if (!state.capture) return false
        const callback = state.capture
        state.capture = null
        state.queue.push({ ...makeUiEvent('ui:capture', 'captured', code === 'Escape' ? null : code, 'key', { type: 'key' }), callback })
        return true
      },

      /** The payloads a panel or anchor lets a person drag, and the drop zones it offers as `{ action, value }`. */
      drags: id => dragsOf(htmlOf(recordOf(id), targetOf(recordOf(id)))),
      drops: id => dropsOf(htmlOf(recordOf(id), targetOf(recordOf(id)))),

      /**
       * Drop a payload on a zone as a person would: the handler for the zone's
       * `action` gets `{ drag, drop }` on the next fixed step. False when the
       * panel has no such zone.
       */
      drop(id, action, drag, dropValue = '') {
        const zone = context.gameUi.drops(id).find(candidate => candidate.action === action && String(candidate.value) === String(dropValue))
        if (!zone || recordOf(id).phase === 'leaving') return false
        state.queue.push(makeUiEvent(id, action, { drag, drop: zone.value }, 'drop', { type: 'drop' }))
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

    // The page's keys go to a waiting capture first, so a rebinding row gets the key and nothing else does.
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', event => {
        if (!context.gameUi.feedKey(event.code)) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }, { capture: true })
    }

    const clearRun = () => {
      for (const id of [...state.panels.keys(), ...state.anchors.keys()]) remove(id)
      state.queue.length = 0
      state.capture = null
      notifications.clear()
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
        drawFrame(context, state, seconds)
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
    if (event.callback) {
      try { event.callback(event.value) } catch (error) { console.error('[game-ui] a captured key handler failed', error) }
      continue
    }
    const record = state.panels.get(event.id) ?? state.anchors.get(event.id)
    const handler = record?.phase === 'leaving' ? undefined : record?.on[`${event.action}:${event.type}`] ?? record?.on[event.action]
    if (!handler) continue
    const entity = record.kind === 'anchor' ? resolveTarget(record.to, context.world).entity : null
    try { handler(event.value, { ...event, entity }) } catch (error) {
      console.error(`[game-ui] the "${event.action}" handler of "${event.id}" failed`, error)
    }
  }
}
