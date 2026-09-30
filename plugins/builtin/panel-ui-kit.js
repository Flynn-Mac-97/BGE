/**
 * UI Kit panel: every Game UI component in one live gallery, the kit's own
 * and the game's (`assets/ui/components/*.html`), drawn with the game's theme.
 * Pick one to change its props, copy the line that shows it, read its
 * accessibility findings, and edit its CSS or its file. Expand draws the panel
 * over the whole editor. The commands (ui-kit/commands.js) give an agent the
 * same components as JSON.
 */
import { parseComponent } from './game-ui/project-components.js'
import { auditHtml, auditTokens } from './ui-kit/audit.js'
import { catalogueOf, defaultsOf } from './ui-kit/catalogue.js'
import { auditComponents, createComponent, expandPanel, getComponent, listComponents, setKitCss } from './ui-kit/commands.js'
import { blockOf, rulesOf, withBlock } from './ui-kit/element-css.js'
import { GALLERY_CSS, galleryHtml } from './ui-kit/gallery.js'
import { newComponent, readTheme, saveComponent, saveKitCss } from './ui-kit/store.js'

/** What the gallery is drawn over: the game's dark or light world, one choice away. */
const BACKDROPS = { night: '#0b0d10', dusk: '#2a2f3a', day: '#e9e4d8' }

/** The game's components with any unsaved source drafts put in, so the gallery shows an edit as it is typed. */
const componentsWithDrafts = (context, state) =>
  context.gameUi.components.list().map(component => (state.drafts[component.name] === undefined ? component : parseComponent(component.name, state.drafts[component.name])))

/** The sheet the gallery adopts: the kit, the game's components, the theme with every unsaved kit CSS draft in it, then the chrome. */
function gallerySheet(context, state) {
  const componentCss = componentsWithDrafts(context, state).map(component => component.css).join('\n')
  const kitDrafts = Object.entries(state.drafts).filter(([id]) => state.kinds[id] === 'kit')
  const theme = kitDrafts.reduce((text, [id, css]) => withBlock(text, id, css), state.theme)
  return `${context.gameUi.theme.sheet(`${componentCss}\n${theme}`)}\n${GALLERY_CSS}`
}

const entriesOf = (context, state) => {
  const query = (state.query ?? '').toLowerCase()
  return catalogueOf(context.gameUi.kit, componentsWithDrafts(context, state)).filter(entry => `${entry.id} ${entry.title} ${entry.group}`.toLowerCase().includes(query))
}

/** An entry's values: what the person set, over its defaults. */
const valuesOf = (state, entry) => (state.values[entry.id] ??= defaultsOf(entry))

/** One control for one prop. Each change redraws the gallery in place, not the panel. */
function propControl(ui, prop, values, changed) {
  const change = value => {
    values[prop.key] = value
    changed()
  }
  const controls = {
    text: () => ui.field({ k: prop.label, v: values[prop.key], onChange: change }),
    number: () => ui.slider({ k: prop.label, min: prop.min, max: prop.max, step: 1, value: values[prop.key], onChange: change }),
    choice: () => ui.select({ k: prop.label, options: prop.choices, value: values[prop.key], onChange: change }),
    switch: () => ui.toggle({ label: prop.label, value: values[prop.key], onChange: change })
  }
  return controls[prop.kind]()
}

/** Findings as lines, or one line saying there are none. */
const findingLines = (ui, findings) =>
  findings.length ? findings.map(finding => ui.text(`✗ ${finding.message}`)) : [ui.text('✓ No accessibility findings', { dim: true })]

/** The text box for an entry: a kit element's CSS, or a game component's whole file. */
function editorOf(ui, context, state, entry, refresh) {
  const isGame = entry.kind === 'game'
  if (isGame && state.sources[entry.id] === undefined) {
    context.files.read(entry.file).then(source => {
      state.sources[entry.id] = source
      context.redraw()
    })
    return [ui.empty(`reading ${entry.file}`)]
  }
  const saved = isGame ? state.sources[entry.id] : blockOf(state.theme, entry.id) || rulesOf(context.gameUi.theme.sheet(''), entry.classes)
  const text = state.drafts[entry.id] ?? saved
  const keep = async write => {
    await write()
    delete state.drafts[entry.id]
    context.redraw()
  }
  const save = isGame
    ? () => keep(async () => { await saveComponent(context, entry.file, state.drafts[entry.id] ?? text); state.sources[entry.id] = state.drafts[entry.id] ?? text })
    : () => keep(async () => { state.theme = await saveKitCss(context, entry.id, state.drafts[entry.id] ?? text) })
  const reset = isGame ? () => keep(async () => {}) : () => keep(async () => { state.theme = await saveKitCss(context, entry.id, '') })
  return [
    ui.meta(isGame ? entry.file : 'CSS, saved into assets/ui/theme.css'),
    ui.textarea({ value: text, label: isGame ? `${entry.id} source` : `${entry.id} CSS`, onChange: value => { state.drafts[entry.id] = value; refresh() } }),
    ui.row([ui.button('Save', save, { primary: true }), ui.button(isGame ? 'Revert' : 'Reset', reset, { confirm: isGame ? 'Drop edits?' : 'Drop saved CSS?' })])
  ]
}

/** The selected entry: what it is, its props, the code that shows it, its findings, and its editor. */
function inspectorOf(ui, context, state, entry, refresh) {
  if (!entry) return ui.empty('pick a component')
  const values = valuesOf(state, entry)
  const code = ui.textarea({ value: entry.code(values), readOnly: true, rows: 3, label: `${entry.id} code` })
  const findings = ui.stack(findingLines(ui, auditHtml(entry.render(values))))
  const changed = () => {
    code.value = entry.code(values)
    findings.replaceChildren(...findingLines(ui, auditHtml(entry.render(values))))
    refresh()
  }
  return ui.stack([
    ui.section(entry.title, [ui.text(entry.about, { dim: true })]),
    ui.section('Props', entry.props.map(prop => propControl(ui, prop, values, changed))),
    ui.section('Code', [code]),
    ui.section('Accessibility', [findings]),
    ui.section(entry.kind === 'game' ? 'Source' : 'CSS', editorOf(ui, context, state, entry, refresh))
  ])
}

/** Search, backdrop and a new component. */
function toolbarOf(ui, context, state) {
  const create = async () => {
    const id = (state.newName ?? '').trim()
    try {
      await newComponent(context, id, '')
      state.selectedId = id
      state.newName = ''
      state.note = ''
    } catch (error) {
      state.note = error.message
    }
    context.redraw()
  }
  return ui.stack([
    ui.row([
      ui.search({ bind: 'query', placeholder: 'find a component' }),
      ui.select({ k: 'Backdrop', options: Object.keys(BACKDROPS), value: state.backdrop, onChange: name => { state.backdrop = name } })
    ]),
    ui.row([ui.field({ k: 'New file', v: state.newName ?? '', onChange: name => { state.newName = name } }), ui.button('Create', create, { small: true })]),
    state.note ? ui.text(state.note) : null
  ])
}

/** The panel's body. */
function renderPanel(ui, context) {
  const state = context.state
  Object.assign(state, { values: state.values ?? {}, drafts: state.drafts ?? {}, sources: state.sources ?? {}, kinds: state.kinds ?? {}, backdrop: state.backdrop ?? 'night' })
  if (state.theme === undefined) {
    Promise.all([readTheme(context), context.gameUi.components.load()]).then(([theme]) => {
      state.theme = theme
      context.redraw()
    })
    return ui.empty('reading the theme and components')
  }
  const entries = entriesOf(context, state)
  for (const entry of entries) state.kinds[entry.id] = entry.kind
  const selected = entries.find(entry => entry.id === state.selectedId) ?? entries[0]
  const gallery = ui.sandbox({
    html: galleryHtml(entries, { valuesOf: entry => valuesOf(state, entry), selectedId: selected?.id }),
    css: gallerySheet(context, state),
    background: BACKDROPS[state.backdrop],
    onPick: id => { state.selectedId = id; context.redraw() }
  })
  gallery.style.setProperty('--kit-backdrop', BACKDROPS[state.backdrop])
  const refresh = () => {
    gallery.reshow(galleryHtml(entriesOf(context, state), { valuesOf: entry => valuesOf(state, entry), selectedId: selected?.id }))
    gallery.restyle(gallerySheet(context, state))
  }
  const tokens = auditTokens(context.gameUi.theme.tokens())
  const themeNote = tokens.length ? ui.section('Theme contrast', tokens.map(finding => ui.text(`✗ ${finding.message}`))) : null
  const inspector = ui.stack([themeNote, inspectorOf(ui, context, state, selected, refresh)])
  if (context.isExpanded) {
    // The gallery scrolls on its own here, and a pick redraws it: keep its place.
    gallery.addEventListener('scroll', () => { state.galleryScroll = gallery.scrollTop })
    requestAnimationFrame(() => { gallery.scrollTop = state.galleryScroll ?? 0 })
    return ui.stack([toolbarOf(ui, context, state), ui.columns([gallery, inspector], { widths: 'minmax(0, 1fr) 400px' })])
  }
  // Docked, a pick redraws the panel at its top, so the picked component's inspector comes first.
  return ui.stack([toolbarOf(ui, context, state), inspector, gallery])
}

export default {
  name: 'UI Kit Panel',
  about: 'every Game UI component in one gallery: change its props, copy its code, check it, and edit its CSS or file',
  category: 'editor',
  needs: ['Game UI'],

  panels: [
    {
      id: 'ui-kit',
      title: 'UI kit',
      dock: 'right',
      order: 40,
      minHeight: 800,
      expandable: true,
      render: renderPanel
    }
  ],

  // The agent's door: each answers small JSON with no browser but uikit.expand (ui-kit/commands.js).
  commands: [
    { id: 'uikit.list', label: 'UI components', run: listComponents },
    { id: 'uikit.get', label: 'One UI component: code, HTML, CSS, source and findings', run: getComponent },
    { id: 'uikit.new', label: 'New UI component file', run: createComponent },
    { id: 'uikit.set', label: 'Save a kit element’s CSS into the theme', run: setKitCss },
    { id: 'uikit.audit', label: 'Accessibility audit of the theme and every UI component', run: auditComponents },
    { id: 'uikit.expand', label: 'Show the UI kit over the whole editor, or dock it', run: expandPanel }
  ]
}
