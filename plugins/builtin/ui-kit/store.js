/**
 * UI Kit store: the files the UI kit reads and writes, for the panel and the
 * commands alike. A kit element's CSS is kept in the game's `theme.css`
 * between marks (element-css.js); a game component is its own file.
 */
import { assetPath } from '../../../engine/asset-path.js'
import { componentTemplate, isComponentName } from '../game-ui/project-components.js'
import { catalogueOf } from './catalogue.js'
import { withBlock } from './element-css.js'

/** The game's stylesheet, as a project path. */
export const THEME_FILE = assetPath('ui/theme.css')

/** The theme file's text, or '' when the game has none yet. */
export async function readTheme(context) {
  try {
    return await context.files.read(THEME_FILE)
  } catch {
    return ''
  }
}

/** Write one kit element's CSS into the theme; empty CSS takes it out. Answers the theme text now in the file. */
export async function saveKitCss(context, id, css) {
  const theme = withBlock(await readTheme(context), id, css)
  await context.files.write(THEME_FILE, theme)
  return theme
}

/** Every entry, after reading the game's component files again so a file just written is in it. */
export async function loadEntries(context) {
  await context.gameUi.components.load()
  return catalogueOf(context.gameUi.kit, context.gameUi.components.list())
}

/** Write a game component's file and read the components again. */
export async function saveComponent(context, file, source) {
  await context.files.write(file, source)
  await context.gameUi.components.load()
}

/** Write a new game component from the template. Refuses a bad name or one that is taken. Answers its path. */
export async function newComponent(context, id, about) {
  if (!isComponentName(id)) throw new Error(`"${id}" is not a component name: lower case letters, digits and dashes, starting with a letter`)
  const entries = await loadEntries(context)
  if (entries.some(entry => entry.id === id)) throw new Error(`there is already a component called "${id}"`)
  const file = assetPath(`ui/components/${id}.html`)
  await saveComponent(context, file, componentTemplate(id, about))
  return file
}
