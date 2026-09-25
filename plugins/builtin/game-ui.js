/**
 * Game UI — HTML and CSS panels a game shows over its own picture.
 *
 * Screen draws a game screen from a small item vocabulary on a canvas. This is
 * the other way: a panel is HTML, styled with CSS, for a layout that is easier
 * to write as a page — an inventory, a character sheet, a shop. It mounts into
 * the kernel's `overlay` region through `context.ui.mount`, and each panel's
 * CSS is kept inside a shadow root, so a game's styles and the editor's cannot
 * reach each other.
 *
 *   context.gameUi.show('inventory', { css, html: () => `<h1>${name}</h1>` })
 *   context.gameUi.hide('inventory')
 *
 * An element marked `data-ui="name"` reports the pointer: `hovered(id)` is the
 * name under it now, or null. A panel that lets clicks through still takes them
 * on an element whose CSS says `pointer-events: auto`, so a slot can be grabbed
 * while the game picks under the rest. The mouse buttons stay the game's input.
 *
 * `html` is a string or a function, asked every drawn frame, so a panel shows
 * live values with nothing pushed at it. The DOM is written only when the
 * string changes. `read` answers with a panel's text, headless or not, which is
 * how a test checks a panel came up.
 *
 * Panels belong to the run that showed them: they are cleared on `level:loaded`
 * and `play:stopped`, like Screen's.
 */
import { assetURL } from '../../engine/asset-path.js'

/** Where panels mount, and above what. Screen's canvas layer draws under the overlay. */
const REGION = 'overlay'

/** context -> its panels, so the frame system reaches them without putting them on `context.gameUi`. */
const panelsOf = new WeakMap()

export default {
  name: 'Game UI',
  category: 'game',
  about: 'HTML and CSS panels a game shows over its picture.',

  onLoad(context) {
    /** id -> { html, css, isInteractive, element, root, written, hovered } */
    const panels = new Map()
    panelsOf.set(context, panels)

    const remove = id => {
      const panel = panels.get(id)
      if (!panel) return false
      if (panel.element) context.ui?.unmount(panel.element)
      panels.delete(id)
      return true
    }

    context.gameUi = {
      /**
       * Show a panel, or replace the one under this id. `html` is a string or a
       * function returning one; `css` is scoped to this panel. A panel lets
       * clicks through to the game unless `isInteractive` is true.
       */
      show(id, { html, css = '', isInteractive = false }) {
        remove(id)
        panels.set(id, { html, css, isInteractive, element: null, root: null, written: null, hovered: null })
      },

      hide: remove,
      isShowing: id => panels.has(id),

      /** The `data-ui` name of the element under the pointer in a panel, or null. */
      hovered: id => panels.get(id)?.hovered ?? null,
      shown: () => [...panels.keys()],

      /** A panel's text, or every panel's by id. What a headless run reads. */
      read(id) {
        if (id !== undefined) return textOf(htmlOf(panels.get(id)))
        return Object.fromEntries([...panels].map(([key, panel]) => [key, textOf(htmlOf(panel))]))
      },

      /** The URL of a project asset, for an `<img src>`: `ui/portrait.png` is under `assets/`. */
      asset: assetURL
    }

    context.bus.on('level:loaded', () => { for (const id of [...panels.keys()]) remove(id) })
    context.bus.on('play:stopped', () => { for (const id of [...panels.keys()]) remove(id) })
  },

  systems: [{
    // Frame, because it only draws. Nothing here may change the simulation.
    phase: 'frame',
    run(world, seconds, context) {
      const panels = panelsOf.get(context)
      if (!panels || !context.ui || typeof document === 'undefined') return
      for (const [id, panel] of panels) writePanel(context, id, panel)
    }
  }],

  commands: [
    { id: 'gameui.read', label: 'Game UI panel text', run: (context, id) => context.gameUi.read(typeof id === 'string' ? id : id?.id) },
    { id: 'gameui.list', label: 'Game UI panels showing', run: context => context.gameUi.shown() }
  ]
}

/** A panel's HTML this moment. A function that throws shows nothing rather than breaking the frame. */
function htmlOf(panel) {
  if (!panel) return ''
  if (typeof panel.html !== 'function') return String(panel.html ?? '')
  try { return String(panel.html() ?? '') } catch (error) {
    console.error('[game-ui] a panel could not be built', error)
    return ''
  }
}

/** The words a panel shows: tags dropped, entities for the common few read back, space folded. */
function textOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Mount a panel on first sight, and write its HTML only when it changed. */
function writePanel(context, id, panel) {
  if (!panel.element) {
    const element = document.createElement('div')
    element.dataset.gameUi = id
    // The overlay lets clicks through; an interactive panel takes them back.
    element.style.cssText = `position:absolute;inset:0;pointer-events:${panel.isInteractive ? 'auto' : 'none'}`
    panel.root = element.attachShadow({ mode: 'open' })
    panel.root.addEventListener('pointerover', event => { panel.hovered = event.target.closest?.('[data-ui]')?.dataset.ui ?? null })
    panel.root.addEventListener('pointerout', event => { if (!event.relatedTarget || !panel.root.contains(event.relatedTarget)) panel.hovered = null })
    panel.element = element
  }
  // Also when the page took it off since: a panel that still says it is showing
  // must be on the page. Seen once right after play started, cause not found.
  if (!panel.element.isConnected) context.ui.mount(REGION, panel.element, { plugin: 'Game UI' })
  const html = htmlOf(panel)
  if (html === panel.written) return
  panel.written = html
  panel.root.innerHTML = `<style>${panel.css}</style>${html}`
}
