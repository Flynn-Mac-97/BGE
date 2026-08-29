/**
 * Kernel: the dock frame.
 *
 * It owns almost nothing — a toolbar, four docks, a status line and the canvas.
 * Every panel inside it arrives from a plugin, including ours. An extension
 * point with nothing contributed to it renders nothing, so an unextended editor
 * stays as plain as it looks.
 */
import { makeUI } from './ui.js'

export function makeShell(root, context) {
  const { loader, bus, editor } = context
  // renderer is read lazily: the canvas it draws into is created below, so the
  // renderer cannot exist yet when the shell is constructed.
  const rend = () => context.renderer
  const panelState = new Map()

  const DEFAULT_LAYOUT = {
    left: 190,
    right: 236,
    centre: Math.min(560, Math.max(240, Math.round(root.getBoundingClientRect().width * 0.46))),
    bottom: 220
  }
  const layout = readLayout(DEFAULT_LAYOUT)

  root.innerHTML = `
    <div class="app">
      <div class="bar" id="bar"></div>
      <div class="mid" id="mid">
        <div class="dock left" id="dock-left"></div>
        <div class="dock-resizer vertical" id="resize-left" role="separator" tabindex="0" aria-label="Resize left panels" aria-orientation="vertical"></div>
        <div class="centre stage" id="centre">
          <div class="viewport" id="viewport"><canvas id="gl"></canvas><div class="viewport-ui" id="viewport-ui"></div></div>
          <div class="dock-resizer vertical" id="resize-centre" role="separator" tabindex="0" aria-label="Resize expanded centre panel" aria-orientation="vertical"></div>
          <div class="dock centre" id="dock-centre"></div>
        </div>
        <div class="dock-resizer vertical" id="resize-right" role="separator" tabindex="0" aria-label="Resize right panels" aria-orientation="vertical"></div>
        <div class="dock right" id="dock-right"></div>
      </div>
      <div class="dock-resizer horizontal" id="resize-bottom" role="separator" tabindex="0" aria-label="Resize bottom panels" aria-orientation="horizontal"></div>
      <div class="dock bottom" id="dock-bottom"></div>
      <div class="status" id="status"></div>
    </div>`

  const element = id => root.querySelector('#' + id)
  const frame = root.querySelector('.app')
  applyLayout()
  installResizer('resize-left', 'left', 'x', 1)
  installResizer('resize-right', 'right', 'x', -1)
  installResizer('resize-centre', 'centre', 'x', -1)
  installResizer('resize-bottom', 'bottom', 'y', -1)

  function boundsFor(key) {
    const box = frame.getBoundingClientRect()
    if (key === 'bottom') return [100, Math.max(100, Math.round(box.height * 0.65))]
    if (key === 'centre') return [240, Math.max(240, Math.round(box.width * 0.65))]
    return [120, Math.max(120, Math.min(480, Math.round(box.width * 0.45)))]
  }

  function resize(key, value, save = false) {
    const [least, most] = boundsFor(key)
    layout[key] = Math.round(Math.max(least, Math.min(most, Number(value) || DEFAULT_LAYOUT[key])))
    frame.style.setProperty(`--${key}-size`, `${layout[key]}px`)
    const handle = element('resize-' + key)
    handle?.setAttribute('aria-valuemin', String(least))
    handle?.setAttribute('aria-valuemax', String(most))
    handle?.setAttribute('aria-valuenow', String(layout[key]))
    if (save) saveLayout(layout)
    rend()?.resize()
  }

  function applyLayout() {
    for (const key of Object.keys(DEFAULT_LAYOUT)) resize(key, layout[key])
  }

  function resetLayout(key = null) {
    for (const name of key ? [key] : Object.keys(DEFAULT_LAYOUT)) resize(name, DEFAULT_LAYOUT[name])
    saveLayout(layout)
    return { ...layout }
  }

  function installResizer(id, key, axis, direction) {
    const handle = element(id)
    if (!handle) return
    handle.title = 'Drag to resize · double-click to reset'

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      const startPoint = axis === 'x' ? event.clientX : event.clientY
      const startSize = layout[key]
      handle.setPointerCapture?.(event.pointerId)
      frame.classList.add('resizing')
      handle.classList.add('active')

      const move = next => {
        const point = axis === 'x' ? next.clientX : next.clientY
        resize(key, startSize + (point - startPoint) * direction)
      }
      const done = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', done)
        handle.removeEventListener('pointercancel', done)
        handle.classList.remove('active')
        frame.classList.remove('resizing')
        saveLayout(layout)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', done)
      handle.addEventListener('pointercancel', done)
    })

    handle.addEventListener('dblclick', () => resetLayout(key))
    handle.addEventListener('keydown', event => {
      const backward = axis === 'x' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
      const forward = axis === 'x' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
      if (!backward && !forward && event.key !== 'Home') return
      event.preventDefault()
      if (event.key === 'Home') resetLayout(key)
      else resize(key, layout[key] + (backward ? -16 : 16) * direction, true)
    })
  }

  /**
   * Collapse the frame to the viewport, or put the docks back.
   *
   * This is the same split the engine makes everywhere: the kernel owns the
   * vocabulary and a plugin owns the policy. The frame lives here, so knowing
   * *how* to get out of the way lives here too — and nothing in this file knows
   * that play is the reason. `Play Focus` decides *when*, and a different plugin
   * could decide differently without the kernel changing.
   *
   * A class, never a rebuild. A dock that is destroyed loses its scroll
   * position, its search text and whatever its panel was holding, and the whole
   * point of stopping play is that you get back exactly what you had. Hidden is
   * recoverable; rebuilt is not — so nothing is removed and `draw()` is not
   * called, which is what makes coming back free.
   */
  function focus(on) {
    const wanted = !!on
    if (!frame) return false
    if (frame.classList.contains('focused') === wanted) return wanted
    frame.classList.toggle('focused', wanted)
    // The viewport just changed size and no window resize event says so. The
    // camera's aspect ratio is computed from the viewport, so a renderer left on
    // the old size draws the world stretched.
    rend()?.resize()
    return wanted
  }

  function panelsFor(dock) {
    return loader.contrib.panels
      .filter(p => p.dock === dock)
      .filter(p => !p.whenTool || p.whenTool === editor.tool)
      .filter(p => !p.when || p.when(context))
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
  }

  function drawPanel(p) {
    if (!panelState.has(p.id)) panelState.set(p.id, {})
    const state = panelState.get(p.id)

    const wrap = document.createElement('section')
    wrap.className = 'panel'
    wrap.dataset.panel = p.id

    const head = document.createElement('div')
    head.className = 'panel-head'
    head.innerHTML = `<span class="t">${p.title}</span>`
    // A panel from the project is credited to the plugin that added it. A
    // built-in one is not, because "Inspector Panel · Inspector Panel" says
    // nothing twice.
    if (p.plugin && !p.builtin) {
      head.insertAdjacentHTML('beforeend', `<span class="by">${p.plugin}</span>`)
    }
    if (p.actions) {
      for (const a of p.actions) {
        const b = document.createElement('button')
        b.className = 'panel-act'
        b.textContent = a.label
        b.title = a.title || a.label
        b.onclick = () => { a.run(context); draw() }
        head.append(b)
      }
    }
    wrap.append(head)

    const bodyEl = document.createElement('div')
    bodyEl.className = 'panel-body' + (p.scroll === false ? '' : ' scroll')
    try {
      const ui = makeUI(state, () => draw())
      const node = p.render(ui, { ...context, state })
      if (node) bodyEl.append(node)
    } catch (e) {
      loader.fail(p.plugin, e)
      bodyEl.innerHTML = `<div class="u-empty">panel failed — plugin disabled</div>`
    }
    wrap.append(bodyEl)
    return wrap
  }

  function drawDock(dock) {
    const host = element('dock-' + dock)
    const list = panelsFor(dock)
    host.innerHTML = ''
    host.classList.toggle('hidden', list.length === 0)
    if (dock === 'left' || dock === 'right') {
      element('mid').classList.toggle(`no-${dock}`, list.length === 0)
      element(`resize-${dock}`).classList.toggle('hidden', list.length === 0)
    }
    if (dock === 'centre') {
      element('centre').classList.toggle('no-panel', list.length === 0)
      element('resize-centre').classList.toggle('hidden', list.length === 0)
    }
    if (dock === 'bottom') {
      frame.classList.toggle('no-bottom', list.length === 0)
      element('resize-bottom').classList.toggle('hidden', list.length === 0)
    }
    for (const p of list) host.append(drawPanel(p))
  }

  function drawBar() {
    const bar = element('bar')
    bar.innerHTML = ''

    const play = document.createElement('button')
    play.className = 'play' + (context.loop.running ? ' on' : '')
    play.textContent = context.loop.running ? 'STOP' : 'PLAY'
    play.onclick = () => context.editor.togglePlay()
    bar.append(play)

    const path = document.createElement('span')
    path.className = 'path'
    path.innerHTML = `${context.editor.projectName} / <b>${context.editor.levelName}</b>`
    bar.append(path)

    // tool rail lives here, and only exists once something contributes a second tool
    const tools = loader.contrib.tools
    if (tools.length > 1) {
      const rail = document.createElement('span')
      rail.className = 'rail'
      for (const t of tools) {
        const b = document.createElement('button')
        b.className = 'tool' + (editor.tool === t.id ? ' on' : '')
        b.textContent = t.icon || t.id[0]
        b.title = `${t.label}${t.key ? ` (${t.key})` : ''} — ${t.plugin}`
        b.onclick = () => { editor.setTool(t.id); draw() }
        rail.append(b)
      }
      bar.append(rail)
    }

    // Toolbar entries contributed by plugins. This is what `menus` is for: a
    // way to reach something that is not always on screen, without a plugin
    // needing to touch the toolbar itself.
    for (const m of loader.contrib.menus) {
      const b = document.createElement('button')
      b.className = 'menu' + (m.on?.(context) ? ' on' : '')
      b.textContent = m.label
      b.title = `${m.title || m.label} — ${m.plugin}`
      b.onclick = () => { m.run(context); draw() }
      bar.append(b)
    }

    const end = document.createElement('span')
    end.className = 'end'
    const r = rend()
    end.textContent = r ? `${r.view.mode} · ${Math.round(r.view.zoom)}px/u` : ''
    bar.append(end)
  }

  function drawStatus() {
    const s = element('status')
    const sel = [...editor.selection]
    s.innerHTML = `<span>${sel.length ? sel.join(', ') : 'nothing selected'}</span>
      <span class="end">${context.files.pending ? 'saving…' : 'saved to disk'}</span>`
  }

  let queued = false

  function paint() {
    queued = false
    drawBar()
    for (const d of ['left', 'right', 'centre', 'bottom']) drawDock(d)
    drawStatus()
    rend()?.resize()
  }

  function draw() {
    if (queued) return
    queued = true
    // A backgrounded tab gets no animation frames, so coalescing through rAF
    // would mean the editor silently stops updating when it is not visible —
    // which is exactly the case an agent driving the browser runs in.
    if (document.hidden) paint()
    else requestAnimationFrame(paint)
  }

  bus.on('plugins:changed', draw)
  bus.on('selection:changed', draw)
  bus.on('world:changed', draw)
  bus.on('files:writing', drawStatus)
  addEventListener('resize', () => rend()?.resize())

  return {
    draw,
    // The element the whole frame hangs off. A plugin that wants the browser's
    // own chrome gone as well asks the Fullscreen API about this one.
    root,
    canvas: element('gl'),
    viewport: element('viewport'),
    overlay: element('viewport-ui'),
    focus,
    layout: () => ({ ...layout }),
    setLayout(values = {}) {
      for (const key of Object.keys(DEFAULT_LAYOUT)) {
        if (values[key] != null) resize(key, values[key])
      }
      saveLayout(layout)
      return { ...layout }
    },
    resetLayout,
    get focused() { return frame?.classList.contains('focused') === true }
  }
}

const LAYOUT_KEY = 'browser-game-engine.layout.v1'

function readLayout(fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') } }
  catch { return { ...fallback } }
}

function saveLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* storage may be blocked */ }
}
