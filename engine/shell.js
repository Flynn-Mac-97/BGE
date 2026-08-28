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

  root.innerHTML = `
    <div class="app">
      <div class="bar" id="bar"></div>
      <div class="mid">
        <div class="dock left" id="dock-left"></div>
        <div class="centre" id="centre">
          <div class="viewport" id="viewport"><canvas id="gl"></canvas><div class="viewport-ui" id="viewport-ui"></div></div>
          <div class="dock centre" id="dock-centre"></div>
        </div>
        <div class="dock right" id="dock-right"></div>
      </div>
      <div class="dock bottom" id="dock-bottom"></div>
      <div class="status" id="status"></div>
    </div>`

  const element = id => root.querySelector('#' + id)

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
    canvas: element('gl'),
    viewport: element('viewport'),
    overlay: element('viewport-ui')
  }
}
