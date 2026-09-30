/**
 * UI Kit catalogue: the kit's elements and the game's own components as one
 * list of entries, so the gallery, the inspector and the commands read one
 * shape.
 *
 * An entry is `{ id, kind, title, group, about, file, classes, props,
 * render(values), code(values) }`. `kind` is `kit` (a Game UI kit function) or
 * `game` (a file in `assets/ui/components/`, where `file` names it). `props`
 * are `{ key, kind, label, value, choices, min, max }`. `render` gives the
 * HTML for a set of prop values and `code` the line a game writes to show it.
 */
import { COMPONENT_ENDING, COMPONENT_FOLDER, renderComponent } from '../game-ui/project-components.js'
import { ELEMENTS, GROUPS } from './elements.js'

/** The group every game component is shown under. */
export const GAME_GROUP = 'This game'

/** The groups in gallery order: the game's own first. */
export const GROUP_ORDER = [GAME_GROUP, ...GROUPS]

const makeEntry = ({ id, kind, title, group, about = '', file = '', classes = [], props, render, code }) =>
  ({ id, kind, title, group, about, file, classes, props, render, code })

/** A value written as JavaScript: strings quoted, objects with bare keys, `undefined` fields left out. */
export function sourceOf(value) {
  if (Array.isArray(value)) return `[${value.map(sourceOf).join(', ')}]`
  if (value && typeof value === 'object') {
    const fields = Object.entries(value).filter(([, field]) => field !== undefined)
    return fields.length ? `{ ${fields.map(([key, field]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${sourceOf(field)}`).join(', ')} }` : '{}'
  }
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return String(value)
}

/** One kit element as an entry. `kit` is `context.gameUi.kit`. */
function kitEntry(element, kit) {
  return makeEntry({
    ...element,
    kind: 'kit',
    about: `kit.${element.call(defaultsOf(element))[0]} from the Game UI kit`,
    render: values => {
      const [name, ...args] = element.call(values)
      return kit[name](...args)
    },
    code: values => {
      const [name, ...args] = element.call(values)
      return `kit.${name}(${args.map(sourceOf).join(', ')})`
    }
  })
}

/** One of the game's components as an entry. */
function gameEntry(component) {
  return makeEntry({
    id: component.name,
    kind: 'game',
    title: component.name,
    group: GAME_GROUP,
    about: component.about,
    file: `assets/${COMPONENT_FOLDER}/${component.name}${COMPONENT_ENDING}`,
    props: component.props.map(prop => ({ ...prop, label: prop.key })),
    render: values => renderComponent(component, values),
    code: values => `context.gameUi.component(${sourceOf(component.name)}, ${sourceOf(values)})`
  })
}

/** Each prop's starting value, by key. */
export const defaultsOf = entry => Object.fromEntries(entry.props.map(prop => [prop.key, prop.value]))

/** Every entry: the game's components (records from `gameUi.components.list()`), then the kit's elements. */
export const catalogueOf = (kit, components) => [...components.map(gameEntry), ...ELEMENTS.map(element => kitEntry(element, kit))]
