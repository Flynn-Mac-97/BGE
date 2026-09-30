/**
 * UI Kit commands: the agent's door to every component. Each answers small
 * JSON and all but `uikit.expand` run headless, so an agent lists, reads, audits
 * and writes components from a terminal and edits the files directly.
 */
import { auditHtml, auditTokens } from './audit.js'
import { defaultsOf } from './catalogue.js'
import { blockOf, rulesOf } from './element-css.js'
import { loadEntries, newComponent, readTheme, saveKitCss } from './store.js'

/** The id an argument names: a bare string, or `{ id }`. */
const idOf = argument => (typeof argument === 'string' ? argument : argument?.id)

/** The entry an id names, or an error that says how to list them. */
async function entryOf(context, id) {
  const entry = (await loadEntries(context)).find(candidate => candidate.id === id)
  if (!entry) throw new Error(`no UI component "${id}"; uikit.list names them`)
  return entry
}

/** The CSS an entry is styled by: a game file's own `<style>`, a kit element's saved block, else the kit's rules for it. */
async function cssOf(context, entry) {
  if (entry.kind === 'game') return { css: context.gameUi.components.list().find(component => component.name === entry.id)?.css ?? '', isSaved: true }
  const saved = blockOf(await readTheme(context), entry.id)
  return { css: saved || rulesOf(context.gameUi.theme.sheet(''), entry.classes), isSaved: Boolean(saved) }
}

const summaryOf = entry => ({ id: entry.id, kind: entry.kind, group: entry.group, title: entry.title, about: entry.about, file: entry.file || undefined, props: defaultsOf(entry) })

/** `uikit.list`: every component, as a summary. */
export const listComponents = async context => (await loadEntries(context)).map(summaryOf)

/** `uikit.get`: one component's code, HTML, CSS, source and findings, drawn with `props` over its defaults. */
export async function getComponent(context, argument) {
  const entry = await entryOf(context, idOf(argument))
  const values = { ...defaultsOf(entry), ...(argument?.props ?? {}) }
  const html = entry.render(values)
  const source = entry.kind === 'game' ? await context.files.read(entry.file) : undefined
  return { ...summaryOf(entry), code: entry.code(values), html, ...(await cssOf(context, entry)), source, findings: auditHtml(html) }
}

/** `uikit.new`: a new game component file from the template. */
export async function createComponent(context, argument) {
  const id = idOf(argument)
  return { id, file: await newComponent(context, id, argument?.about) }
}

/** `uikit.set`: a kit element's CSS, into the theme. */
export async function setKitCss(context, { id, css }) {
  const entry = await entryOf(context, id)
  if (entry.kind !== 'kit') throw new Error(`"${id}" is a game component: edit ${entry.file} instead`)
  await saveKitCss(context, id, css ?? '')
  return { id, isSaved: Boolean(css?.trim()) }
}

/** `uikit.audit`: theme contrast and every component's findings; `ok` when there are none. */
export async function auditComponents(context, argument) {
  const backdrop = argument?.backdrop ?? '#000000'
  const components = (await loadEntries(context))
    .map(entry => ({ id: entry.id, findings: auditHtml(entry.render(defaultsOf(entry))) }))
    .filter(result => result.findings.length)
  const theme = auditTokens(context.gameUi.theme.tokens(), backdrop)
  return { ok: !theme.length && !components.length, theme, components }
}

/** `uikit.expand`: draw the panel over the whole editor, or dock it again. */
export function expandPanel(context) {
  if (!context.shell?.expandPanel) return { expanded: false, why: 'this is a headless world — there is no panel' }
  const isExpanded = context.shell.panels().some(panel => panel.id === 'ui-kit' && panel.dock === 'expanded')
  return { expanded: context.shell.expandPanel(isExpanded ? null : 'ui-kit') === 'ui-kit' }
}
