/**
 * UI Kit panel: every element of the Game UI kit, shown live. Open an element
 * to change its options and edit its CSS; Save keeps that CSS in the game's
 * `assets/ui/theme.css` between two marks (ui-kit/element-css.js), so a game
 * carries the rules of the elements it calls and no others.
 */
import { assetPath } from '../../engine/asset-path.js'
import { blockOf, rulesOf, withBlock } from './ui-kit/element-css.js'
import { ELEMENTS, defaultsOf, elementOf } from './ui-kit/elements.js'

const THEME_FILE = assetPath('ui/theme.css')

/** What a preview is drawn over: the kit is made for a dark or a light game, so both are one choice away. */
const BACKDROPS = { dark: '#0b0e18', light: '#ece7dc' }

async function readTheme(context) {
  try {
    return await context.files.read(THEME_FILE)
  } catch {
    return ''
  }
}

/** Write one element's rules into the theme file. Answers the theme text now in the file. */
async function saveRules(context, id, rules) {
  const theme = withBlock(await readTheme(context), id, rules)
  await context.files.write(THEME_FILE, theme)
  return theme
}

/** The stylesheet a preview adopts: the kit, the theme, and the rules being edited for one element. */
const sheetFor = (context, state, id, rules) => context.gameUi.theme.sheet(withBlock(state.theme, id, rules))

/** The rules an element starts from: what the game saved, or else the kit's own. */
const startRulesOf = (context, state, entry) => blockOf(state.theme, entry.id) || rulesOf(context.gameUi.theme.sheet(''), entry.classes)

/** One control for one option. Every kind but a choice and a switch updates the preview in place. */
function optionControl(ui, context, entry, option, values, preview) {
  const change = value => {
    values[option.key] = value
    preview.reshow(entry.sample(context.gameUi.kit, values))
  }
  const controls = {
    text: () => ui.field({ k: option.label, v: values[option.key], onChange: change }),
    number: () => ui.slider({ k: option.label, min: option.min, max: option.max, step: 1, value: values[option.key], onChange: change }),
    choice: () => ui.select({ k: option.label, options: option.choices, value: values[option.key], onChange: change }),
    switch: () => ui.toggle({ label: option.label, value: values[option.key], onChange: change })
  }
  return controls[option.kind]()
}

function elementFold(ui, context, state, entry) {
  const values = (state.values[entry.id] ??= defaultsOf(entry))
  const draft = state.drafts[entry.id] ?? startRulesOf(context, state, entry)
  const preview = ui.sandbox({ html: entry.sample(context.gameUi.kit, values), css: sheetFor(context, state, entry.id, draft), background: BACKDROPS[state.backdrop] })
  const editRules = rules => {
    state.drafts[entry.id] = rules
    preview.restyle(sheetFor(context, state, entry.id, rules))
  }
  const keep = async rules => {
    state.theme = await saveRules(context, entry.id, rules)
    delete state.drafts[entry.id]
    context.redraw()
  }
  const save = () => keep(state.drafts[entry.id] ?? draft)
  const reset = () => keep('')
  return ui.fold(
    entry.title,
    [
      preview,
      ...entry.options.map(option => optionControl(ui, context, entry, option, values, preview)),
      ui.textarea({ value: draft, placeholder: `.${entry.classes[0]} { }`, onChange: editRules }),
      ui.row([ui.button('Save', save, { primary: true }), ui.button('Reset', reset, { confirm: 'Drop saved CSS?' })])
    ],
    {
      meta: blockOf(state.theme, entry.id) ? 'edited' : '',
      open: Boolean(state.open[entry.id]),
      onToggle: isOpen => { state.open[entry.id] = isOpen }
    }
  )
}

export default {
  name: 'UI Kit Panel',
  about: 'browse every Game UI kit element, change its options, and edit and save its CSS',
  category: 'editor',
  needs: ['Game UI'],

  panels: [
    {
      id: 'ui-kit',
      title: 'UI kit',
      dock: 'right',
      order: 40,
      minHeight: 800,

      render(ui, context) {
        const state = context.state
        state.values ??= {}
        state.drafts ??= {}
        state.open ??= {}
        state.backdrop ??= 'dark'
        if (state.theme === undefined) {
          readTheme(context).then(theme => {
            state.theme = theme
            context.redraw()
          })
          return ui.empty('reading the theme')
        }
        return ui.stack([
          ui.text('Open an element, change it, edit its CSS. Save writes it to assets/ui/theme.css.', { dim: true }),
          ui.select({ k: 'Backdrop', options: Object.keys(BACKDROPS), value: state.backdrop, onChange: name => { state.backdrop = name } }),
          ...ELEMENTS.map(entry => elementFold(ui, context, state, entry))
        ])
      }
    }
  ],

  commands: [
    {
      id: 'uikit.list',
      label: 'UI kit elements',
      run: () => ELEMENTS.map(({ id, title, classes }) => ({ id, title, classes }))
    },
    {
      id: 'uikit.css',
      label: 'UI kit element CSS',
      run: async (context, argument) => {
        const id = typeof argument === 'string' ? argument : argument?.element
        const entry = elementOf(id)
        if (!entry) throw new Error(`no UI kit element "${id}"; uikit.list names them`)
        const saved = blockOf(await readTheme(context), id)
        return { element: id, isSaved: Boolean(saved), css: saved || rulesOf(context.gameUi.theme.sheet(''), entry.classes) }
      }
    },
    {
      id: 'uikit.set',
      label: 'Save UI kit element CSS',
      run: async (context, { element, css }) => {
        if (!elementOf(element)) throw new Error(`no UI kit element "${element}"; uikit.list names them`)
        await saveRules(context, element, css ?? '')
        return { element, isSaved: Boolean(css?.trim()) }
      }
    }
  ]
}
