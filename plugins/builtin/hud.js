/**
 * Heads Up Display — text and bars on screen, drawn by the engine.
 *
 * Not CSS, deliberately. A DOM overlay would be a second renderer with its own
 * coordinates, invisible to `snapshot()`, absent from a canvas screenshot, and
 * different again inside a sandboxed iframe. Drawing it into the same canvas
 * keeps one scene, one coordinate system, one thing to inspect.
 *
 * Declared in the level, so it is visible in the file rather than buried in
 * code that runs once:
 *
 *   "hud": [
 *     { "text": "SCORE {score}", "at": [12, 12] },
 *     { "text": "{coins} LEFT", "at": [-12, 12], "anchor": "top-right" },
 *     { "bar": "{health}", "max": 3, "at": [12, 34], "size": [90, 8] }
 *   ]
 *
 * `{name}` reads `world.state.name` — the same shared state game code already
 * writes to — so a HUD needs no wiring at all.
 *
 * Rendered through a 2D canvas into a texture. Real fonts, no bitmap font to
 * ship, and it costs one texture upload on the frames where the text changed.
 */
export default {
  name: 'Heads Up Display',
  needs: [],

  onLoad(context) {
    const hud = {
      items: [],          // from the level
      extra: [],          // added by game code
      visible: true,
      add: item => { hud.extra.push(item); return item },
      clear: () => { hud.extra.length = 0 }
    }
    context.hud = hud

    context.bus.on('level:loaded', async name => {
      try {
        const raw = JSON.parse(await context.files.read(`levels/${name}.json`))
        hud.items = raw.hud || []
      } catch { hud.items = [] }
      hud.extra.length = 0
    })
  },

  systems: [{
    phase: 'frame',
    run(world, seconds, context) {
      const hud = context.hud
      const layer = ensureLayer(context)
      if (!layer) return

      // Only playing shows the HUD. While editing it would sit on top of the
      // thing you are trying to select.
      const on = hud.visible && (context.loop.running || hud.always)
      const items = on ? [...hud.items, ...hud.extra] : []

      // Hidden by clearing, never by `display:none`. A hidden canvas measures
      // zero, and the first paint after it reappears would size itself to
      // nothing and cache that — a blank HUD that never repaints.
      const key = [
        JSON.stringify(items),
        JSON.stringify(world.state),
        layer.canvas.clientWidth,
        layer.canvas.clientHeight
      ].join('|')

      // Redraw only when something changed. A HUD that repaints every frame is
      // an easy way to make a 60fps game run at 40.
      if (key === layer.last) return
      layer.last = key

      paint(layer, items, world.state)
    }
  }],

  commands: [
    {
      id: 'hud.read',
      label: 'What the HUD says',
      run: context => [...context.hud.items, ...context.hud.extra]
        .map(i => (i.text ? fill(i.text, context.world.state) : `bar ${fill(String(i.bar), context.world.state)}/${i.max ?? 1}`))
    },
    {
      id: 'hud.toggle',
      label: 'Show the HUD while editing',
      run: context => { context.hud.always = !context.hud.always; return { always: !!context.hud.always } }
    }
  ]
}

// ------------------------------------------------------------------ the layer
/**
 * A 2D canvas sitting exactly on the viewport.
 *
 * The GL canvas cannot draw text without shipping a font atlas, and a HUD is
 * the one thing in a game that is genuinely 2D and screen-space. This is a
 * sibling canvas, not a DOM overlay of styled elements: still one rectangle of
 * pixels, still capturable, still nothing for a plugin to style.
 */
function ensureLayer(context) {
  const existing = context.hud._layer
  // Still attached? Reuse it. `document.contains` rather than a plain cache
  // check because another plugin can legitimately rebuild the viewport, and a
  // detached canvas measures zero and paints nothing — silently.
  if (existing && document.contains(existing.canvas)) return existing

  // Its own element, not the gizmo's overlay: Transform Tool rewrites
  // `shell.overlay` wholesale every redraw, which deleted this canvas. Two
  // plugins drawing into one container is a shared-mutable-DOM bug waiting to
  // happen, so each gets its own.
  const host = context.shell?.viewport
  if (!host) return null

  const canvas = existing?.canvas || document.createElement('canvas')
  canvas.className = 'hud-layer'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  // Before the gizmo overlay in document order, so selection handles stay on top.
  host.prepend(canvas)
  // The GL canvas is first; keep the HUD after it.
  const gl = host.querySelector('#gl')
  if (gl) gl.after(canvas)

  const layer = { canvas, g: canvas.getContext('2d'), last: null }
  context.hud._layer = layer
  return layer
}

function paint(layer, items, state) {
  const { canvas, g } = layer
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }

  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  for (const item of items) {
    const [ax, ay] = place(item, w, h)
    if (item.bar != null) drawBar(g, item, ax, ay, state)
    else drawText(g, item, ax, ay, state)
  }
}

/** Anchor decides which corner `at` is measured from. */
function place(item, w, h) {
  const [x = 0, y = 0] = item.at || [12, 12]
  const anchor = item.anchor || 'top-left'
  return [
    anchor.includes('right') ? w + x : x,
    anchor.includes('bottom') ? h + y : y
  ]
}

function drawText(g, item, x, y, state) {
  const size = item.size || 16
  g.font = `${item.weight || 600} ${size}px ui-monospace, monospace`
  g.textBaseline = 'top'
  g.textAlign = (item.anchor || '').includes('right') ? 'right' : 'left'

  const text = fill(item.text, state)

  // A dark outline, so the same HUD stays readable over a bright sky and a
  // dark cave without the author choosing a colour per level.
  g.lineWidth = Math.max(2, size / 6)
  g.strokeStyle = item.outline || 'rgba(0,0,0,0.75)'
  g.lineJoin = 'round'
  g.strokeText(text, x, y)
  g.fillStyle = item.color || '#ffffff'
  g.fillText(text, x, y)
}

function drawBar(g, item, x, y, state) {
  const [w, h] = item.size || [90, 8]
  const value = Number(fill(String(item.bar), state)) || 0
  const frac = Math.max(0, Math.min(1, value / (item.max ?? 1)))
  const left = (item.anchor || '').includes('right') ? x - w : x

  g.fillStyle = 'rgba(0,0,0,0.55)'
  g.fillRect(left - 1, y - 1, w + 2, h + 2)
  g.fillStyle = item.color || '#ffffff'
  g.fillRect(left, y, w * frac, h)
}

/** `SCORE {score}` against world.state. A missing key reads as 0, not undefined. */
const fill = (template, state) =>
  String(template).replace(/\{(\w+)\}/g, (_, k) => (state?.[k] ?? 0))
