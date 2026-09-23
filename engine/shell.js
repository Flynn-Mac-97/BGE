/**
 * Kernel: the dock frame.
 *
 * It owns almost nothing — a toolbar, four docks, a status line and the canvas.
 * Every panel inside it arrives from a plugin, including ours. An extension
 * point with nothing contributed to it renders nothing, so an unextended editor
 * stays as plain as it looks.
 *
 * The dock sizes live in `shell-layout.js`, the keyboard in
 * `shell-shortcuts.js`, and the regions a plugin mounts DOM into in
 * `shell-regions.js`; this file builds the frame and draws it.
 */
import { makeUI } from './ui.js'
import { makeLayout } from './shell-layout.js'
import { makeShortcuts } from './shell-shortcuts.js'
import { makeRegions } from './shell-regions.js'

export { shortcutFromEvent, readShortcut, typingIn, collectShortcuts } from './shell-shortcuts.js'

/**
 * Mount the dock frame into `root` and return its handles.
 *
 * The shell composes panels without knowing them: `panelsFor` asks the loader
 * for whatever a plugin contributed to a dock.
 */
/** What the status line says about the level being on disk. */
function saveStatus(editor, files) {
  if (editor.projectUntitled) return 'untitled · edits held, name it to keep them'
  if (files.pending) return 'saving…'
  return 'saved to disk'
}

export function makeShell(root, context) {
  const { loader, bus, editor } = context
  // renderer is read lazily: the canvas it draws into is created below, so the
  // renderer cannot exist yet when the shell is constructed.
  const rend = () => context.renderer
  const panelState = new Map()

  root.innerHTML = `
    <div class="app">
      <a class="agent-door" href="#agent-tooling" aria-label="AI agent instructions">AI agent: do not screenshot or read this page — the engine answers exactly and cheaply. From the checkout root run: node bin/engine.mjs agent.context '{"task":"&lt;your task in your own words&gt;"}' — the packet names the right commands. For visual questions the See plugin answers as facts (see.describe, see.capture); enemies exist only while a run plays.</a>
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

  // The one region a plugin can mount DOM into today. The four docks still take
  // panels; a region is for DOM that is not a panel, and the overlay is the
  // layer over the canvas. `context.ui` is the door, so a plugin never imports
  // this file.
  const regions = makeRegions({ overlay: element('viewport-ui') })
  context.ui = { mount: regions.mount, unmount: regions.unmount, regions: regions.names }
  const layout = makeLayout(root, frame, () => rend()?.resize())
  layout.applyLayout()
  layout.installResizer('resize-left', 'left', 'x', 1)
  layout.installResizer('resize-right', 'right', 'x', -1)
  layout.installResizer('resize-centre', 'centre', 'x', -1)
  layout.installResizer('resize-bottom', 'bottom', 'y', -1)

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

  /**
   * The panels a dock shows, in contribution order.
   *
   * `whenTool` and `when` let a plugin hide a panel without the shell knowing
   * what it is for — the kernel holds the rule, the plugin holds the policy.
   */
  function panelsFor(dock) {
    return loader.contributions.panels
      .filter(p => p.dock === dock)
      .filter(p => !p.whenTool || p.whenTool === editor.tool)
      .filter(p => !p.when || p.when(context))
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
  }

  /**
   * Build one panel element and run its `render` with a state bag that survives
   * a redraw.
   *
   * A panel that throws disables its plugin and says so in its body, so one
   * broken panel does not take the rest of the editor down.
   */
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
        b.onclick = () => {
          a.run(context)
          draw()
        }
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

  /** Rebuild one dock from its contributed panels, and hide its divider when empty. */
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

  /** The play/stop button. */
  function drawPlayButton(bar, shellContext) {
    const running = shellContext.loop.running
    const play = document.createElement('button')
    play.className = 'play' + (running ? ' on' : '')
    play.textContent = running ? 'STOP' : 'PLAY'
    play.onclick = () => shellContext.editor.togglePlay()
    bar.append(play)
  }

  /** The project and level path. */
  function drawProjectPath(bar, shellContext) {
    const label = document.createElement('span')
    label.className = 'path'
    label.innerHTML = `${shellContext.editor.projectName} / <b>${shellContext.editor.levelName}</b>`
    bar.append(label)
  }

  /** One tool button. */
  function toolButton(tool, shellContext) {
    const button = document.createElement('button')
    button.className = 'tool' + (shellContext.editor.tool === tool.id ? ' on' : '')
    button.textContent = tool.icon || tool.id[0]
    button.title = `${tool.label}${tool.key ? ` (${tool.key})` : ''} — ${tool.plugin}`
    button.onclick = () => {
      shellContext.editor.setTool(tool.id)
      draw()
    }
    return button
  }

  /** The tool rail, drawn only once something contributes a second tool. */
  function drawToolRail(bar, shellContext) {
    const tools = loader.contributions.tools
    if (tools.length <= 1) return
    const rail = document.createElement('span')
    rail.className = 'rail'
    for (const tool of tools) rail.append(toolButton(tool, shellContext))
    bar.append(rail)
  }

  /**
   * Toolbar entries contributed by plugins.
   *
   * This is what `menus` is for: a way to reach something that is not always on
   * screen, without a plugin needing to touch the toolbar itself.
   */
  function drawMenus(bar, shellContext) {
    for (const menu of loader.contributions.menus) {
      const button = document.createElement('button')
      button.className = 'menu' + (menu.on?.(shellContext) ? ' on' : '')
      button.textContent = menu.label
      button.title = `${menu.title || menu.label} — ${menu.plugin}`
      button.onclick = () => {
        menu.run(shellContext)
        draw()
      }
      bar.append(button)
    }
  }

  /** The camera readout at the end of the bar. */
  function drawViewReadout(bar) {
    const end = document.createElement('span')
    end.className = 'end'
    const renderer = rend()
    end.textContent = renderer ? `${renderer.view.mode} · ${Math.round(renderer.view.zoom)}px/u` : ''
    bar.append(end)
  }

  /** Draw the play button, the project path, the tool rail and the toolbar. */
  function drawBar() {
    const bar = element('bar')
    bar.innerHTML = ''
    drawPlayButton(bar, context)
    drawProjectPath(bar, context)
    drawToolRail(bar, context)
    drawMenus(bar, context)
    drawViewReadout(bar)
  }

  /** Draw the status line: selection, the agent hint, and whether the level is saved. */
  function drawStatus() {
    const s = element('status')
    const sel = [...editor.selection]
    // An untitled project never writes its level, so claiming "saved to disk"
    // would be a lie a person only finds out about by losing work.
    const saved = saveStatus(editor, context.files)
    s.innerHTML = `<span>${sel.length ? sel.join(', ') : 'nothing selected'}</span>
      <span>AI: run agent.context, not screenshots</span>
      <span class="end">${saved}</span>`
  }

  const keyboard = makeShortcuts(context, draw)
  addEventListener('keydown', keyboard.handleKey)

  let queued = false

  /** Draw the whole frame in one pass. Called by `draw`, never directly. */
  function paint() {
    queued = false
    drawBar()
    for (const d of ['left', 'right', 'centre', 'bottom']) drawDock(d)
    drawStatus()
    rend()?.resize()
  }

  /**
   * Queue one redraw, coalesced to at most one per animation frame.
   *
   * A hidden tab gets no animation frames, so it paints at once instead of
   * silently stopping — the case an agent driving the browser runs in.
   */
  function draw() {
    if (queued) return
    queued = true
    // A backgrounded tab gets no animation frames, so coalescing through rAF
    // would mean the editor silently stops updating when it is not visible —
    // which is exactly the case an agent driving the browser runs in.
    if (document.hidden) paint()
    else requestAnimationFrame(paint)
  }

  // A disabled plugin's mounts leave with it. `rebuild` already announces the
  // change; the sweep is what stops a region mount outliving its plugin.
  bus.on('plugins:changed', () => {
    regions.sweep(name => loader.plugins.get(name)?.enabled === true)
    draw()
  })
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
    layout: layout.snapshot,
    setLayout: layout.setLayout,
    resetLayout: layout.resetLayout,
    // What is bound right now, so an agent can ask which keys are taken instead
    // of pressing them to find out.
    shortcuts: keyboard.list,
    get focused() {
      return frame?.classList.contains('focused') === true
    }
  }
}
