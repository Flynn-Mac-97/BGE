/**
 * Code editor. Two states of one thing: expanded it splits the centre beside the
 * scene; collapsed it drops under the inspector, still live on the same file.
 *
 * Implemented as two panel registrations with a `when` predicate rather than a
 * panel that moves itself — the dock is declared, not imperative.
 */
const state = { file: null, scope: null, text: '', open: false, dirty: false }

async function openFile(context, target) {
  const value = typeof target === 'string' ? { path: target, scope: null } : target
  state.file = value.path
  state.scope = value.scope || null
  state.text = state.scope
    ? await context.files.readAgent(state.scope, state.file)
    : await context.files.read(state.file)
  state.dirty = false
  state.open = true
  context.redraw()
}

async function save(context) {
  if (!state.file || !state.dirty) return
  if (state.scope) await context.files.writeAgent(state.scope, state.file, state.text)
  else await context.files.write(state.file, state.text)
  state.dirty = false
  // A changed type used to mean reloading the page, which threw away the scene
  // you were looking at. Live File Updates swaps it in place instead — this save just
  // has to land on disk, and the watcher does the rest.
}

function pane(ui, context, big) {
  if (!state.file) return ui.empty('open a file from the Project panel')

  const wrap = document.createElement('div')
  wrap.className = 'code-pane'

  const tabs = document.createElement('div')
  tabs.className = 'code-tabs'
  const tab = document.createElement('button')
  tab.className = 'code-tab on'
  tab.textContent = state.file.split('/').pop() + (state.dirty ? ' •' : '')
  tabs.append(tab)

  const fold = document.createElement('button')
  fold.className = 'code-tab'
  fold.style.marginLeft = 'auto'
  fold.style.borderRight = '0'
  fold.textContent = big ? 'Collapse ×' : 'Expand ⤢'
  fold.title = big ? 'Collapse into the right column' : 'Expand to the centre'
  fold.onclick = () => { state.open = !big; context.redraw() }
  tabs.append(fold)
  wrap.append(tabs)

  const ta = document.createElement('textarea')
  ta.value = state.text
  ta.spellcheck = false
  ta.style.minHeight = big ? '0' : '150px'
  ta.addEventListener('input', () => { state.text = ta.value; state.dirty = true })
  ta.addEventListener('blur', () => save(context))
  ta.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(context) }
    if (event.key === 'Tab') {
      event.preventDefault()
      const s = ta.selectionStart
      ta.setRangeText('  ', s, ta.selectionEnd, 'end')
      state.text = ta.value; state.dirty = true
    }
  })
  wrap.append(ta)
  return ui.raw(wrap)
}

export default {
  name: 'Code Panel',

  category: 'editor',
  panels: [
    {
      id: 'code-expanded',
      title: 'Code',
      dock: 'centre',
      scroll: false,
      when: () => state.open && state.file,
      render: (ui, context) => pane(ui, context, true)
    },
    {
      id: 'code-collapsed',
      title: 'Code',
      dock: 'right',
      order: 90,
      scroll: false,
      when: () => !state.open && state.file,
      render: (ui, context) => pane(ui, context, false)
    }
  ],

  commands: [
    { id: 'code.open', label: 'Open a file', run: (context, path) => openFile(context, path) },
    { id: 'code.save', label: 'Save open file', run: context => save(context) },
    { id: 'code.toggle', label: 'Expand or collapse the editor', run: context => { state.open = !state.open; context.redraw() } }
  ],

  onLoad(context) {
    context.bus.on('open:file', path => {
      if (typeof path === 'string' && !/\.(png|jpg|jpeg|webp|gif|wav|mp3|ogg|glb|gltf)$/i.test(path)) {
        openFile(context, path)
      }
    })
    context.bus.on('open:agent-file', target => openFile(context, target))
  }
}
