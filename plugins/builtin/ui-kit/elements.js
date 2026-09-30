/**
 * UI Kit elements: the Game UI kit's components as the gallery shows them.
 *
 * Each record is `{ id, title, group, classes, props, call }`. `classes` are
 * the kit classes that style it, so its CSS can start from the kit's rules.
 * `props` are what a person can change, each `{ key, kind, label, value }`
 * with `kind` one of `text`, `choice` (with `choices`), `number` (with `min`
 * and `max`) or `switch`. `call(values)` is `[kitFunction, ...arguments]`:
 * the gallery runs it to draw the element and prints it as the code a game
 * writes, so the picture and the code cannot disagree.
 */
import { escapeHtml } from '../game-ui/components.js'

const text = (key, label, value) => ({ key, kind: 'text', label, value })
const choice = (key, label, choices, value = choices[0]) => ({ key, kind: 'choice', label, choices, value })
const number = (key, label, min, max, value) => ({ key, kind: 'number', label, min, max, value })
const toggle = (key, label, value = false) => ({ key, kind: 'switch', label, value })

const element = (id, title, group, classes, props, call) => ({ id, title, group, classes, props, call })

/** `undefined` for the choice that means "the kit's own", so the printed call leaves it out. */
const unlessDefault = value => (value === 'default' ? undefined : value)

/** The groups, in the order the gallery shows them. */
export const GROUPS = ['Controls', 'Values', 'Text and layout', 'Feedback']

/** Every kit element the gallery shows. */
export const ELEMENTS = [
  element('button', 'Button', 'Controls', ['ui-button'],
    [text('label', 'Label', 'Deploy'), choice('kind', 'Kind', ['default', 'primary', 'danger', 'quiet']), toggle('isDisabled', 'Disabled')],
    values => ['button', values.label, { action: 'deploy', kind: unlessDefault(values.kind), isDisabled: values.isDisabled || undefined }]),
  element('toggle', 'Toggle', 'Controls', ['ui-toggle'], [text('label', 'Label', 'Subtitles'), toggle('isOn', 'On', true)],
    values => ['toggle', values.label, { action: 'subtitles', isOn: values.isOn }]),
  element('slider', 'Slider', 'Controls', ['ui-slider', 'ui-field', 'ui-field-label', 'ui-field-row'], [text('label', 'Label', 'Master volume'), number('value', 'Value', 0, 100, 70)],
    values => ['slider', values.label, { action: 'volume', value: values.value, min: 0, max: 100, step: 1 }]),
  element('select', 'Select', 'Controls', ['ui-select', 'ui-field', 'ui-field-label'], [text('label', 'Label', 'Difficulty'), choice('value', 'Value', ['story', 'normal', 'veteran'], 'normal')],
    values => ['select', values.label, { action: 'difficulty', value: values.value, options: ['story', 'normal', 'veteran'] }]),
  element('textInput', 'Text input', 'Controls', ['ui-input', 'ui-field', 'ui-field-label'], [text('label', 'Label', 'Callsign'), text('placeholder', 'Placeholder', 'Up to 12 letters')],
    values => ['textInput', values.label, { action: 'callsign', value: '', placeholder: values.placeholder }]),
  element('tabs', 'Tabs', 'Controls', ['ui-tabs', 'ui-tab'], [number('count', 'Tabs', 2, 5, 3)],
    values => ['tabs', ['Loadout', 'Map', 'Intel', 'Crew', 'Log'].slice(0, values.count), { action: 'tab', value: 'Loadout' }]),
  element('list', 'List', 'Controls', ['ui-list', 'ui-row-item'], [number('count', 'Rows', 1, 5, 3)],
    values => ['list', [{ label: 'Rifle', detail: '30 rounds', value: 'rifle' }, { label: 'Sidearm', detail: '12 rounds', value: 'sidearm' }, { label: 'Charge', detail: '2 left', value: 'charge' }, { label: 'Medkit', detail: '1 left', value: 'medkit' }, { label: 'Flare', detail: '4 left', value: 'flare' }].slice(0, values.count), { action: 'equip' }]),
  element('keybind', 'Key binding', 'Controls', ['ui-keybind', 'ui-keycap'], [text('label', 'Label', 'Interact'), text('code', 'Key code', 'KeyE')],
    values => ['keybind', values.label, values.code, { action: 'rebind' }]),

  element('bar', 'Bar', 'Values', ['ui-bar', 'ui-bar-head', 'ui-bar-track', 'ui-bar-fill', 'ui-bar-trail'], [number('value', 'Value', 0, 100, 72), choice('kind', 'Kind', ['default', 'health', 'good'])],
    values => ['bar', values.value, { max: 100, label: 'Armour', kind: unlessDefault(values.kind), trail: false }]),
  element('ring', 'Ring', 'Values', ['ui-ring', 'ui-ring-label'], [number('value', 'Value', 0, 100, 60), choice('kind', 'Kind', ['default', 'health', 'good'])],
    values => ['ring', values.value, { max: 100, kind: unlessDefault(values.kind) }]),
  element('pips', 'Pips', 'Values', ['ui-pips', 'ui-pip'], [number('value', 'Full', 0, 8, 3), number('max', 'Total', 1, 8, 5)],
    values => ['pips', values.value, { max: values.max, glyph: '■', emptyGlyph: '□' }]),
  element('slot', 'Slot', 'Values', ['ui-slot', 'ui-slot-glyph', 'ui-slot-count'], [text('glyph', 'Glyph', '✚'), text('label', 'Name', 'Medkit'), number('count', 'Count', 0, 99, 3), toggle('isSelected', 'Selected', true)],
    values => ['slot', { glyph: values.glyph, label: values.label, count: values.count, isSelected: values.isSelected, action: 'use', value: 'medkit' }]),
  element('badge', 'Badge', 'Values', ['ui-badge'], [text('label', 'Label', 'Rare'), choice('tone', 'Tone', ['default', 'accent', 'good', 'danger'], 'accent')],
    values => ['badge', values.label, { tone: unlessDefault(values.tone) }]),
  element('avatar', 'Avatar', 'Values', ['ui-avatar', 'ui-avatar-status'], [text('name', 'Name', 'Ada Vance'), choice('status', 'Status', ['online', 'away', 'busy'])],
    values => ['avatar', { name: values.name, status: values.status }]),

  element('panel', 'Panel', 'Text and layout', ['ui-panel', 'ui-panel-title'], [text('title', 'Title', 'Objectives'), text('body', 'Body', 'Reach the relay before the storm.')],
    values => ['panel', `<p class="ui-text">${escapeHtml(values.body)}</p>`, { title: values.title }]),
  element('heading', 'Heading', 'Text and layout', ['ui-heading'], [text('label', 'Text', 'Sector 7'), number('level', 'Level', 1, 3, 1)],
    values => ['heading', values.label, { level: values.level }]),
  element('text', 'Text', 'Text and layout', ['ui-text'], [text('label', 'Text', 'Signal lost. Hold position.'), choice('tone', 'Tone', ['default', 'quiet', 'accent', 'good', 'danger'])],
    values => ['text', values.label, { tone: unlessDefault(values.tone) }]),
  element('keyHint', 'Key hint', 'Text and layout', ['ui-key'], [text('key', 'Key', 'F'), text('label', 'Action', 'Open hatch')],
    values => ['keyHint', values.key, values.label]),

  element('toast', 'Toast', 'Feedback', ['ui-toast'], [text('label', 'Text', 'Checkpoint reached'), choice('tone', 'Tone', ['default', 'good', 'danger'], 'good')],
    values => ['toast', values.label, { tone: unlessDefault(values.tone) }]),
  element('dialogue', 'Dialogue', 'Feedback', ['ui-dialogue', 'ui-dialogue-box', 'ui-dialogue-speaker', 'ui-choices'], [text('speaker', 'Speaker', 'Warden'), text('line', 'Line', 'You came back. I did not think you would.')],
    values => ['dialogue', { speaker: values.speaker, text: values.line, choices: [{ label: 'I owe you', value: 'owe' }, { label: 'Leave', value: 'leave' }] }])
]

/** The element with this id, or undefined. */
export const elementOf = id => ELEMENTS.find(candidate => candidate.id === id)
