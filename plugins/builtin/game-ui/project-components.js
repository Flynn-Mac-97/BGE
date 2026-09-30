/**
 * Game UI project components: any UI component a game designs, as one HTML
 * file in `assets/ui/components/<name>.html`. Pure text in, records out; the
 * plugin reads the files.
 *
 * A file is a header comment, markup, and an optional `<style>` block:
 *
 *   <!--
 *   about: A quest offer: its title, the reward, and a button to take it.
 *   props:
 *     title: The Lost Crown
 *     reward: 250
 *     tone: accent | good | danger
 *   -->
 *   <article class="quest-card" data-tone="{{tone}}">
 *     <h3>{{title}}</h3> <p>{{reward}} gold</p>
 *     <button ui-action="accept" ui-value="{{title}}">Accept</button>
 *   </article>
 *   <style> .quest-card { ... } </style>
 *
 * `{{name}}` is a prop as escaped text and `{{{name}}}` is a prop as HTML, for
 * children made by other kit calls. A prop whose default lists choices with
 * `|` takes the first as its default. `ui-action` makes any element a control
 * that raises that action, the same as `kit.target`; `ui-value` is its value.
 *
 * A component record is `{ name, about, props, template, css }`, and a prop is
 * `{ key, kind, value, choices }` with `kind` `text` or `choice`.
 */
import { escapeHtml } from './components.js'

/** Where a game's components are, as an asset folder, and the ending of each file. */
export const COMPONENT_FOLDER = 'ui/components'
export const COMPONENT_ENDING = '.html'

/** A component name is a file name: lower case, digits and dashes. */
export const isComponentName = name => /^[a-z][a-z0-9-]*$/.test(String(name ?? ''))

const HEADER = /^\s*<!--([\s\S]*?)-->/
const STYLE = /<style>([\s\S]*?)<\/style>/g

const makeProp = (key, text) => {
  const choices = text.split('|').map(choice => choice.trim()).filter(Boolean)
  if (choices.length > 1) return { key, kind: 'choice', value: choices[0], choices }
  return { key, kind: 'text', value: text.trim(), choices: [] }
}

/** `about` and the props, from the header comment's lines. */
function headerOf(text) {
  const lines = (text.match(HEADER)?.[1] ?? '').split('\n')
  const about = lines.find(line => /^\s*about:/.test(line))?.replace(/^\s*about:/, '').trim() ?? ''
  const start = lines.findIndex(line => /^\s*props:\s*$/.test(line))
  const propLines = start === -1 ? [] : lines.slice(start + 1).filter(line => /^\s+[\w-]+:/.test(line))
  const props = propLines.map(line => {
    const [, key, value] = line.match(/^\s+([\w-]+):(.*)$/)
    return makeProp(key, value)
  })
  return { about, props }
}

/** One component record from its file's text. */
export function parseComponent(name, text) {
  const body = text.replace(HEADER, '')
  return {
    name,
    ...headerOf(text),
    template: body.replace(STYLE, '').trim(),
    css: [...body.matchAll(STYLE)].map(([, css]) => css.trim()).join('\n')
  }
}

/** Each prop's default, by key. */
export const defaultPropsOf = component => Object.fromEntries(component.props.map(prop => [prop.key, prop.value]))

/** `ui-action` and `ui-value` written as the attributes the kit's routing and focus read. */
function withControls(html) {
  return html.replace(/<([a-z][a-z0-9-]*)([^>]*?)\sui-action="([^"]*)"([^>]*)>/g, (whole, name, before, action, after) => {
    const attributes = `${before}${after}`
    const value = attributes.match(/\sui-value="([^"]*)"/)?.[1]
    const rest = attributes.replace(/\sui-value="[^"]*"/, '')
    const isNative = name === 'button' || name === 'a'
    const reachable = isNative ? '' : ' role="button" tabindex="0"'
    const valued = value === undefined ? '' : ` data-value="${value}"`
    return `<${name}${rest} data-ui-control="target" data-ui="${action}" data-action="${action}" data-trigger="click"${valued}${reachable}>`
  })
}

/** The component's HTML for these props, over its defaults. */
export function renderComponent(component, props = {}) {
  const values = { ...defaultPropsOf(component), ...props }
  const filled = component.template
    .replace(/\{\{\{\s*([\w-]+)\s*\}\}\}/g, (whole, key) => String(values[key] ?? ''))
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, key) => escapeHtml(values[key]))
  return withControls(filled)
}

/**
 * Every component file in the project, parsed, by name. `files` is the Game UI
 * file door: `tree()` and `read(path)`. A file that fails to read is left out.
 */
export async function readComponents(files) {
  const prefix = `assets/${COMPONENT_FOLDER}/`
  const paths = (await files.tree())
    .map(item => item.path)
    .filter(path => path.startsWith(prefix) && path.endsWith(COMPONENT_ENDING) && isComponentName(path.slice(prefix.length, -COMPONENT_ENDING.length)))
  const read = async path => {
    const name = path.slice(prefix.length, -COMPONENT_ENDING.length)
    try {
      return [name, parseComponent(name, await files.read(path))]
    } catch {
      return null
    }
  }
  return new Map((await Promise.all(paths.map(read))).filter(Boolean))
}

/** A new component's file text: a working example to change. */
export const componentTemplate = (name, about = 'What this component shows, in one sentence.') => `<!--
about: ${about}
props:
  title: Title
  detail: One line under the title.
  tone: accent | good | danger
-->
<section class="${name}" data-tone="{{tone}}">
  <h3 class="${name}-title">{{title}}</h3>
  <p class="${name}-detail">{{detail}}</p>
  <button class="ui-button" ui-action="${name}-pick" ui-value="{{title}}">Choose</button>
</section>
<style>
.${name} { display: grid; gap: var(--ui-space); padding: calc(var(--ui-space) * 2); background: var(--ui-surface); border: 1px solid var(--ui-edge); border-left: 3px solid var(--ui-accent); }
.${name}[data-tone="good"] { border-left-color: var(--ui-good); }
.${name}[data-tone="danger"] { border-left-color: var(--ui-danger); }
.${name}-title { margin: 0; font-size: 1.1em; }
.${name}-detail { margin: 0; color: var(--ui-quiet); }
</style>
`
