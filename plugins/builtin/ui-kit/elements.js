/**
 * UI Kit elements: what the panel can show of the Game UI kit. Each record is
 * `{ id, title, classes, options, sample }`. `classes` are the kit classes the
 * element is styled by; `options` are the values the reader can change, each
 * `{ key, kind, label, value, ... }` with `kind` one of `text`, `choice`,
 * `number` or `switch`; `sample(kit, values)` is the element's HTML.
 */

const text = (key, label, value) => ({ key, kind: 'text', label, value })
const choice = (key, label, choices, value = choices[0]) => ({ key, kind: 'choice', label, choices, value })
const number = (key, label, min, max, value) => ({ key, kind: 'number', label, min, max, value })
const toggle = (key, label, value = false) => ({ key, kind: 'switch', label, value })

const element = (id, title, classes, options, sample) => ({ id, title, classes, options, sample })

/** Every element, in the order the panel lists them. */
export const ELEMENTS = [
  element('button', 'Button', ['ui-button'], [text('label', 'Label', 'Confirm'), choice('kind', 'Kind', ['default', 'primary', 'danger', 'quiet']), toggle('isDisabled', 'Disabled')],
    (kit, values) => kit.button(values.label, { kind: values.kind === 'default' ? undefined : values.kind, isDisabled: values.isDisabled })),
  element('toggle', 'Toggle', ['ui-toggle'], [text('label', 'Label', 'Show hints'), toggle('isOn', 'On', true)],
    (kit, values) => kit.toggle(values.label, { isOn: values.isOn })),
  element('slider', 'Slider', ['ui-slider', 'ui-field', 'ui-field-label', 'ui-field-row'], [text('label', 'Label', 'Volume'), number('value', 'Value', 0, 100, 40)],
    (kit, values) => kit.slider(values.label, { value: values.value, min: 0, max: 100, step: 1 })),
  element('select', 'Select', ['ui-select', 'ui-field', 'ui-field-label'], [text('label', 'Label', 'Quality')],
    (kit, values) => kit.select(values.label, { value: 'high', options: ['low', 'medium', 'high'] })),
  element('textInput', 'Text input', ['ui-input', 'ui-field', 'ui-field-label'], [text('label', 'Label', 'Name'), text('placeholder', 'Placeholder', 'Type here')],
    (kit, values) => kit.textInput(values.label, { value: '', placeholder: values.placeholder })),
  element('tabs', 'Tabs', ['ui-tabs', 'ui-tab'], [number('count', 'Tabs', 2, 6, 3)],
    (kit, values) => kit.tabs(Array.from({ length: values.count }, (_, index) => ({ label: `Tab ${index + 1}`, value: `tab-${index}` })), { value: 'tab-0' })),
  element('bar', 'Bar', ['ui-bar', 'ui-bar-head', 'ui-bar-track', 'ui-bar-fill', 'ui-bar-trail'], [number('value', 'Value', 0, 100, 72), choice('kind', 'Kind', ['default', 'health', 'good'])],
    (kit, values) => kit.bar(values.value, { max: 100, label: 'Health', kind: values.kind === 'default' ? undefined : values.kind, trail: false })),
  element('ring', 'Ring', ['ui-ring', 'ui-ring-label'], [number('value', 'Value', 0, 100, 60), choice('kind', 'Kind', ['default', 'health', 'good'])],
    (kit, values) => kit.ring(values.value, { max: 100, kind: values.kind === 'default' ? undefined : values.kind })),
  element('pips', 'Pips', ['ui-pips', 'ui-pip'], [number('value', 'Full', 0, 8, 5), number('max', 'Total', 1, 8, 8)],
    (kit, values) => kit.pips(values.value, { max: values.max, glyph: '♥', emptyGlyph: '♡' })),
  element('slot', 'Slot', ['ui-slot', 'ui-slot-glyph', 'ui-slot-count'], [text('glyph', 'Glyph', '⚔'), number('count', 'Count', 0, 99, 3), toggle('isSelected', 'Selected')],
    (kit, values) => kit.slot({ glyph: values.glyph, count: values.count, isSelected: values.isSelected })),
  element('badge', 'Badge', ['ui-badge'], [text('label', 'Label', 'New'), choice('tone', 'Tone', ['default', 'accent', 'good', 'danger'])],
    (kit, values) => kit.badge(values.label, { tone: values.tone === 'default' ? undefined : values.tone })),
  element('panel', 'Panel', ['ui-panel', 'ui-panel-title'], [text('title', 'Title', 'Inventory')],
    (kit, values) => kit.panel(kit.text('Panels group a screen.'), { title: values.title })),
  element('heading', 'Heading', ['ui-heading'], [text('label', 'Text', 'Wave 3'), number('level', 'Level', 1, 3, 2)],
    (kit, values) => kit.heading(values.label, { level: values.level })),
  element('keyHint', 'Key hint', ['ui-key'], [text('key', 'Key', 'E'), text('label', 'Action', 'Open')],
    (kit, values) => kit.keyHint(values.key, values.label))
]

/** The element with this id, or undefined. */
export const elementOf = id => ELEMENTS.find(candidate => candidate.id === id)

/** The starting value of every option of one element, by key. */
export const defaultsOf = entry => Object.fromEntries(entry.options.map(option => [option.key, option.value]))
