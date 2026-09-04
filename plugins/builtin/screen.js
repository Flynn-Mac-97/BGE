/**
 * Screen — game screens, composed as data rather than drawn by hand.
 *
 * A panel is the editor's furniture and `ui.*` builds it. A *screen* is the
 * other thing entirely: the title card, the pause menu, the level-up choice,
 * the result card at the end of a run. None of that is a dock in the editor
 * shell, and none of it can be composed from `ui.stack` and `ui.field`.
 *
 * Before this, every screen in the checkout invented the same private canvas
 * layer and then hand-wrote its own rounded rectangles and text metrics — the
 * identical `ensureLayer` sits in four files, and the drawing under it is
 * another sixty lines each time. Worse, none of it could be read without a
 * screenshot, so an agent working headless could not tell whether the screen it
 * had just written said anything at all.
 *
 * So a screen is a list of plain items:
 *
 *   context.screen.show('paused', () => [
 *     { dim: 0.6 },
 *     { text: 'PAUSED', at: [0, 0], anchor: 'center', size: 44 }
 *   ])
 *
 * Three rules make it work everywhere:
 *
 * - Coordinates are in a design box (1280x720 by default), scaled to fit
 *   whatever the viewport is. A screen laid out once is laid out for every
 *   window size, and a headless world measures the same box a browser does.
 *   The box GROWS to the viewport's shape rather than letterboxing — read
 *   `screen.box`, not `screen.design`, and a bar anchored to an edge is on the
 *   edge in every window.
 * - Nothing here needs a document. With no canvas the items are still built,
 *   still ordered and still readable through `screen.read` — which is how a
 *   headless run proves a screen came up and what it said.
 * - The vocabulary is extensible rather than closed. `screen.painter(kind, ...)`
 *   adds an item kind, which is how `Screen Card` adds cards without this file
 *   knowing what a card is. Add a painter; never add an escape hatch.
 */

/** The box every screen is laid out in. Scaled to fit the viewport, never stretched. */
const DESIGN = { width: 1280, height: 720 }

/** Defaults a screen can lean on so a plain item still looks deliberate. */
const PALETTE = {
  ink: '#ffffff',
  dim: 'rgba(6, 8, 14, 0.72)',
  panel: 'rgba(14, 17, 28, 0.90)',
  edge: 'rgba(255, 255, 255, 0.16)',
  accent: '#ffd166',
  track: 'rgba(255, 255, 255, 0.14)',
  quiet: 'rgba(255, 255, 255, 0.55)'
}

export const FONT = "ui-monospace, 'SF Mono', Menlo, monospace"

export default {
  name: 'Screen',
  category: 'game',
  about: 'Draw game screens — a title card, a pause menu, a result card — from a list of plain items.',
  inspect: context => {
    const shown = context.screen?.shown() || []
    return shown.length ? [{ title: 'On screen', rows: shown.map(s => [s.id, `${s.count} items`]) }] : []
  },

  onLoad(context) {
    /** id -> { draw, order }. Insertion order is broken only by an explicit order. */
    const screens = new Map()
    /** kind -> { draw, describe }. The item vocabulary, and anyone may add to it. */
    const painters = new Map()

    /** Every item of every visible screen, back to front. */
    function items() {
      const out = []
      const ordered = [...screens.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      for (const entry of ordered) {
        let list = []
        // A screen that throws is skipped and named, never allowed to take the
        // rest of the screen stack down with it.
        try { list = typeof entry.draw === 'function' ? entry.draw(context) : entry.draw }
        catch (error) { console.error(`[screen] ${entry.id} failed to build`, error) }
        for (const item of [].concat(list || [])) if (item) out.push({ ...item, screen: entry.id })
      }
      return out
    }

    /** Which kind an item is: the first registered kind whose key it carries. */
    const kindOf = item => [...painters.keys()].find(kind => item[kind] !== undefined) || null

    const screen = {
      /** What a screen is designed against. The reference, and it never changes. */
      design: { ...DESIGN },

      /**
       * What it is being laid out in right now.
       *
       * The same height as the design box and as wide as the viewport actually
       * is, so nothing is letterboxed: an experience bar anchored across the top
       * touches both edges of a wide window and a narrow one. Equal to `design`
       * until something measures a canvas, which is what a headless world reads.
       */
      box: { ...DESIGN },

      palette: { ...PALETTE },
      painters,

      /**
       * Put a screen up. `draw` is called every frame and returns its items, so
       * a screen shows live values without anyone pushing them at it.
       */
      show(id, draw, options = {}) {
        screens.set(id, { id, draw, order: options.order ?? screens.size })
        return id
      },

      hide(id) { return screens.delete(id) },
      isShown: id => screens.has(id),
      shown: () => [...screens.values()].map(entry => ({ id: entry.id, count: safeCount(entry, context) })),

      /**
       * Add an item kind. `draw(g, item, screen)` paints it and `describe(item)`
       * says what it reads as, so a new kind is legible headless from the day it
       * is added rather than the day somebody remembers.
       */
      painter(kind, painter) {
        painters.set(kind, typeof painter === 'function' ? { draw: painter } : painter)
        return kind
      },

      items,

      /**
       * What the screen says, in words. The one thing a headless run can check,
       * and the reason a screen is data rather than paint.
       */
      read() {
        const out = []
        for (const item of items()) {
          const painter = painters.get(kindOf(item))
          for (const line of [].concat(painter?.describe?.(item) ?? [])) if (line != null) out.push(line)
        }
        return out
      },

      // ---- layout, shared with every painter ----
      boxAt: (item, size) => boxAt(item, size, screen.box),
      textAt: item => textAt(item, screen.box),
      roundedRect
    }

    context.screen = screen

    screen.painter('dim', { draw: drawDim, describe: () => [] })
    screen.painter('panel', { draw: drawPanel, describe: () => [] })
    screen.painter('bar', {
      draw: drawBar,
      describe: item => [`bar ${Math.round(fraction(item.bar) * 100)}%`]
    })
    screen.painter('text', { draw: drawText, describe: item => [String(item.text)] })

    // A screen belongs to the run that put it up. Left standing, a result card
    // would sit over the next level with nothing able to take it down.
    context.bus.on('level:loaded', () => screens.clear())
    context.bus.on('play:stopped', () => screens.clear())
  },

  systems: [{
    // Frame, because it only draws. Nothing here may change the simulation.
    phase: 'frame',
    run(world, seconds, context) {
      const layer = ensureLayer(context)
      if (!layer) return
      // Measured BEFORE the screens are asked what they hold, so a screen that
      // sizes itself from `screen.box` is laying out in this frame's box rather
      // than in the one before it.
      const scale = measure(layer, context.screen)
      const list = context.screen.items()

      // Repaint only when the picture changed. A screen that redraws every
      // frame is an easy way to make a 60fps game run at 40.
      const key = `${JSON.stringify(list)}|${layer.canvas.clientWidth}x${layer.canvas.clientHeight}`
      if (key === layer.last) return
      layer.last = key
      paint(layer, list, context.screen, scale)
    }
  }],

  commands: [
    { id: 'screen.read', label: 'What the screen says', run: context => context.screen.read() },
    { id: 'screen.list', label: 'Which screens are up', run: context => context.screen.shown() }
  ]
}

/** How many items a screen offers, without letting a broken one throw here. */
function safeCount(entry, context) {
  try {
    const list = typeof entry.draw === 'function' ? entry.draw(context) : entry.draw
    return [].concat(list || []).filter(Boolean).length
  } catch { return 0 }
}

// ------------------------------------------------------------------ the layer
/**
 * A 2D canvas sitting exactly on the viewport, and its own — never shared.
 *
 * Its own element because the Transform Tool rewrites the shell's overlay
 * wholesale, so anything drawn into a shared container disappears. No document
 * means no drawing, and that is not an error: a headless world builds every
 * item above this line and simply has nothing to show them on.
 */
function ensureLayer(context) {
  if (typeof document === 'undefined') return null

  const existing = context.screen._layer
  if (existing && document.contains(existing.canvas)) return existing

  const host = context.shell?.viewport
  if (!host) return null

  const canvas = existing?.canvas || document.createElement('canvas')
  canvas.className = 'screen-layer'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.prepend(canvas)
  // The GL canvas is first, the HUD after it, and a screen sits over both.
  const gl = host.querySelector('#gl')
  if (gl) gl.after(canvas)

  const layer = { canvas, g: canvas.getContext('2d'), last: null }
  context.screen._layer = layer
  return layer
}

// ------------------------------------------------------------------- painting
/**
 * How big the box is this frame, and how much the canvas is scaled by.
 *
 * Uniform scale, so a screen keeps its proportions in any window rather than
 * stretching into one. The box then grows to whatever is left over instead of
 * being letterboxed inside it — a HUD anchored to an edge has to be ON the
 * edge, and a black bar down each side of a game is nobody's design.
 */
function measure(layer, screen) {
  const width = layer.canvas.clientWidth
  const height = layer.canvas.clientHeight
  const scale = Math.min(width / screen.design.width, height / screen.design.height) || 1
  screen.box.width = width / scale
  screen.box.height = height / scale
  return scale
}

function paint(layer, list, screen, scale) {
  const { canvas, g } = layer
  const ratio = Math.min(devicePixelRatio || 1, 2)
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio
    canvas.height = height * ratio
  }

  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, width, height)
  g.save()
  g.scale(scale, scale)

  for (const item of list) {
    for (const [kind, painter] of screen.painters) {
      if (item[kind] === undefined) continue
      try { painter.draw?.(g, item, screen) }
      catch (error) { console.error(`[screen] a ${kind} could not be drawn`, error) }
      break
    }
  }

  g.restore()
}

/**
 * A wash over everything behind, so a choice reads as a choice.
 *
 * The whole live box, which is the whole viewport — a wash that stopped at the
 * design box would leave two bright bars down the sides of a paused game.
 */
function drawDim(g, item, screen) {
  g.fillStyle = item.color || screen.palette.dim
  g.globalAlpha = item.dim
  g.fillRect(0, 0, screen.box.width, screen.box.height)
  g.globalAlpha = 1
}

function drawPanel(g, item, screen) {
  const size = item.size || [320, 180]
  const [x, y] = screen.boxAt(item, size)
  roundedRect(g, x, y, size[0], size[1], item.radius ?? 14)
  g.fillStyle = item.fill || screen.palette.panel
  g.fill()
  if (item.edge !== false) {
    g.strokeStyle = item.edge || screen.palette.edge
    g.lineWidth = item.edgeWidth ?? 2
    g.stroke()
  }
}

function drawBar(g, item, screen) {
  const size = item.size || [420, 14]
  const [x, y] = screen.boxAt(item, size)
  const radius = item.radius ?? size[1] / 2

  roundedRect(g, x, y, size[0], size[1], radius)
  g.fillStyle = item.back || screen.palette.track
  g.fill()

  const filled = size[0] * fraction(item.bar)
  // A sliver of a bar still has to read as a bar, so the fill keeps its round
  // ends rather than collapsing into a dot at low values.
  if (filled > 0.5) {
    g.save()
    roundedRect(g, x, y, size[0], size[1], radius)
    g.clip()
    roundedRect(g, x, y, Math.max(filled, radius * 2), size[1], radius)
    g.fillStyle = item.color || screen.palette.accent
    g.fill()
    g.restore()
  }
}

function drawText(g, item, screen) {
  const size = item.size || 20
  const [x, y, align] = screen.textAt(item)
  g.font = `${item.weight || 600} ${size}px ${item.font || FONT}`
  g.textAlign = align
  g.textBaseline = item.baseline || 'top'

  const text = String(item.text)
  // A dark outline, so one screen stays readable over a bright meadow and a
  // dark cave without the author choosing a colour per level.
  if (item.outline !== false) {
    g.lineWidth = Math.max(2, size / 6)
    g.strokeStyle = item.outline || 'rgba(0, 0, 0, 0.7)'
    g.lineJoin = 'round'
    g.strokeText(text, x, y)
  }
  g.fillStyle = item.color || screen.palette.ink
  g.fillText(text, x, y)
}

// -------------------------------------------------------------------- layout
/**
 * Where a box goes. `at` positions the box's own corner, measured from the
 * corner the anchor names — so `anchor: 'top-right', at: [-24, 24]` sits the
 * box's top-right corner 24 in from the top right, which is what anybody
 * placing it would mean.
 */
function boxAt(item, size, design) {
  const anchor = item.anchor || 'top-left'
  const [ax = 0, ay = 0] = item.at || []
  const x = anchor.includes('right') ? design.width + ax - size[0]
    : anchor.includes('left') ? ax
      : design.width / 2 + ax - size[0] / 2
  const y = anchor.includes('bottom') ? design.height + ay - size[1]
    : anchor.includes('top') ? ay
      : design.height / 2 + ay - size[1] / 2
  return [x, y]
}

/** The same rule for text, which aligns itself rather than having a width. */
function textAt(item, design) {
  const anchor = item.anchor || 'top-left'
  const [ax = 0, ay = 0] = item.at || []
  const x = anchor.includes('right') ? design.width + ax
    : anchor.includes('left') ? ax
      : design.width / 2 + ax
  const y = anchor.includes('bottom') ? design.height + ay
    : anchor.includes('top') ? ay
      : design.height / 2 + ay
  const align = item.align
    || (anchor.includes('right') ? 'right' : anchor.includes('left') ? 'left' : 'center')
  return [x, y, align]
}

export function roundedRect(g, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + width, y, x + width, y + height, r)
  g.arcTo(x + width, y + height, x, y + height, r)
  g.arcTo(x, y + height, x, y, r)
  g.arcTo(x, y, x + width, y, r)
  g.closePath()
}

const fraction = value => Math.max(0, Math.min(1, Number(value) || 0))
