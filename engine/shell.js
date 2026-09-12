/**
 * Kernel: the dock frame.
 *
 * It owns almost nothing — a toolbar, four docks, a status line and the canvas.
 * Every panel inside it arrives from a plugin, including ours. An extension
 * point with nothing contributed to it renders nothing, so an unextended editor
 * stays as plain as it looks.
 *
 * It also owns the one keyboard listener. A shortcut is a claim on a key that
 * every other plugin shares, so only the place that can see every contribution
 * at once can honour it and say when two of them want the same key.
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
    // An untitled project never writes its level, so claiming "saved to disk"
    // would be a lie a person only finds out about by losing work.
    const saved = editor.projectUntitled
      ? 'untitled · edits held, name it to keep them'
      : (context.files.pending ? 'saving…' : 'saved to disk')
    s.innerHTML = `<span>${sel.length ? sel.join(', ') : 'nothing selected'}</span>
      <span>AI: run agent.context, not screenshots</span>
      <span class="end">${saved}</span>`
  }

  /**
   * Every key a command or a tool has claimed, read off the same contributions
   * the toolbar above walks.
   *
   * A command is dispatched through `context.run`, the path a button and the CLI
   * already take, so anything that path does keeps happening for a key press
   * too. A tool is switched the way its rail button switches it — `key` was
   * already declared on a tool and already shown in its tooltip, so the only
   * missing part was the one that made the tooltip true.
   */
  const declaredShortcuts = () => [
    ...loader.contrib.commands.map(command => ({
      key: command.key, what: 'command', name: command.id, plugin: command.plugin,
      run: () => context.run(command.id)
    })),
    ...loader.contrib.tools.map(tool => ({
      key: tool.key, what: 'tool', name: tool.id, plugin: tool.plugin,
      run: () => editor.setTool(tool.id)
    }))
  ].filter(entry => entry.key != null)

  // Said once each. Contributions are rebuilt whenever a plugin is enabled or
  // the tool changes, and the same collision repeated on every rebuild would
  // bury the rest of the log.
  //
  // Held until `shell:ready`, because the shell is built inside startWorld
  // before makeInspect installs the capture that puts a console.error into the
  // engine log. Collisions are declared at plugin load, so they all happen in
  // exactly that window — reporting them eagerly meant the normal case was
  // announced to a log nobody was keeping, and the dedupe then guaranteed it
  // was never said again. Silence is the enemy, and this was the silence.
  const saidAlready = new Set()
  let pending = []
  const say = message => console.error('[shortcut]', message)
  const reportShortcut = message => {
    if (saidAlready.has(message)) return
    saidAlready.add(message)
    if (pending) pending.push(message)
    else say(message)
  }
  bus.on('shell:ready', () => {
    const held = pending || []
    pending = null
    for (const message of held) say(message)
  })

  let shortcuts = new Map()
  const gatherShortcuts = () => { shortcuts = collectShortcuts(declaredShortcuts(), reportShortcut) }
  gatherShortcuts()
  bus.on('plugins:changed', gatherShortcuts)

  /**
   * The one keydown listener in the engine.
   *
   * Three built-ins each opened their own, and a plugin's listener cannot see
   * that another plugin already took the key, nor share the guard that keeps a
   * shortcut out of a text field. A command declares; the kernel listens.
   */
  addEventListener('keydown', event => {
    // Held keys repeat at the operating system's rate. Without this, holding a
    // key bound to a command that saves runs sixty whole-level writes a second,
    // all racing each other.
    if (event.repeat) return
    // Something nearer the key already answered it. Every focusable widget in
    // `ui.*` — a list row, a tree row, a grid cell — is a role=button that
    // handles Enter and Space and calls preventDefault without stopping the
    // bubble, so without this a global `space` binding fires as well as the
    // row the person actually pressed.
    if (event.defaultPrevented) return
    if (typingIn(event.target)) return
    // The editor's shortcuts are the editor's. While the game runs it owns the
    // keyboard, and a stray `v` must reach the game rather than switch the tool
    // behind it.
    if (context.loop?.running) return
    const wanted = shortcuts.get(shortcutFromEvent(event))
    if (!wanted) return
    // Only once something has actually claimed the key. Swallowing every
    // keystroke would take Ctrl+Z away from the browser and from anything this
    // guard does not cover.
    event.preventDefault()
    // A command may be async — `context.save` is — so a rejected promise has to
    // be caught as well as a thrown error, or the failure this reports is only
    // ever the synchronous half. Redraw after it settles, not before, or the
    // repaint shows the world as it was.
    let running
    try { running = wanted.run() } catch (error) {
      console.error(`[shortcut] ${wanted.what} "${wanted.name}" failed`, error)
      draw()
      return
    }
    Promise.resolve(running)
      .catch(error => console.error(`[shortcut] ${wanted.what} "${wanted.name}" failed`, error))
      .finally(draw)
  })

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
    // What is bound right now, so an agent can ask which keys are taken instead
    // of pressing them to find out.
    shortcuts: () => [...shortcuts].map(([key, entry]) =>
      ({ key, kind: entry.what, id: entry.name, plugin: entry.plugin })),
    get focused() { return frame?.classList.contains('focused') === true }
  }
}

const MODIFIERS = ['ctrl', 'shift', 'alt']

/**
 * A key event in the contract's spelling: ctrl, shift, alt, then the key,
 * lowercased and joined by '+'.
 *
 * Meta counts as ctrl, so one declaration covers Windows and macOS. A plugin
 * should not have to know which machine it is running on, and a plugin that
 * tried would get it wrong on the other one.
 */
export function shortcutFromEvent(event) {
  const parts = []
  if (event.ctrlKey || event.metaKey) parts.push('ctrl')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')
  parts.push(String(event.key ?? '').toLowerCase())
  return parts.join('+')
}

/**
 * A declared shortcut in that same spelling, or null when it is not one.
 *
 * Modifiers are put back into the contract's order rather than refused out of
 * it: 'shift+ctrl+z' means exactly what 'ctrl+shift+z' means. A part that is not
 * a modifier at all is a different matter — 'meta+z' would otherwise quietly
 * bind the bare letter z, and the author would never learn why.
 */
export function readShortcut(declaration) {
  if (typeof declaration !== 'string' || declaration === '') return null
  const parts = declaration.toLowerCase().split('+')
  const key = parts.pop()
  if (!key) return null
  if (parts.some(part => !MODIFIERS.includes(part))) return null
  // ' ' is what the space bar reports and 'space' is what an author writes.
  // Both mean the space bar, and a declaration that reads well but never fires
  // is found by pressing it and getting nothing.
  return [...MODIFIERS.filter(m => parts.includes(m)), key === 'space' ? ' ' : key].join('+')
}

/**
 * Whether a keystroke belongs to whoever is typing.
 *
 * A shortcut must not fire into a field and must not be swallowed on the way
 * there: Ctrl+Z in a text box is the text box's undo. Both hand-rolled guards in
 * the built-ins test the same two tags; a contentEditable element is the same
 * mistake under another name.
 */
/**
 * Is this element taking text, so a shortcut must stay out of it?
 *
 * Not every `input` is typing. `ui.slider` builds `input type="range"`, and it
 * keeps focus after a drag — a tag-name test therefore turned every shortcut
 * off for as long as someone had touched a slider, silently. Only the types
 * that swallow a character count.
 */
const TEXT_INPUT = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'])

export const typingIn = element =>
  element?.tagName === 'TEXTAREA' ||
  element?.isContentEditable === true ||
  (element?.tagName === 'INPUT' && TEXT_INPUT.has((element.type || 'text').toLowerCase()))

/**
 * The lookup a key press is matched against, plus a named report for every
 * declaration that could not go into it.
 *
 * The first declaration keeps a contested key, because a working shortcut that
 * stopped working is worse than a new one that never started. What is not
 * allowed is choosing quietly: two plugins claiming Ctrl+Z is a real mistake,
 * and it is invisible from inside either of them.
 */
export function collectShortcuts(declarations, report = () => {}) {
  const table = new Map()
  for (const entry of declarations) {
    const shortcut = readShortcut(entry.key)
    if (!shortcut) {
      report(`${entry.what} "${entry.name}" (${entry.plugin}) declares key ${JSON.stringify(entry.key)}` +
        ' — a shortcut is ctrl, shift and alt in that order, then the key, so nothing was bound')
      continue
    }
    const taken = table.get(shortcut)
    if (taken) {
      report(`"${shortcut}" is claimed twice: ${taken.what} "${taken.name}" (${taken.plugin}) keeps it,` +
        ` ${entry.what} "${entry.name}" (${entry.plugin}) will never fire — one of the two has to change`)
      continue
    }
    table.set(shortcut, entry)
  }
  return table
}

const LAYOUT_KEY = 'browser-game-engine.layout.v1'

function readLayout(fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') } }
  catch { return { ...fallback } }
}

function saveLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)) } catch { /* storage may be blocked */ }
}
