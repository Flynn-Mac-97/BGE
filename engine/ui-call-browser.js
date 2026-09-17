/** Function relationships supplied by an inspector; this primitive does not parse code. */
export function makeCallBrowser(options) {
  /** Build one element with a class and, when given, its text. */
  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    node.className = className
    if (text != null) node.textContent = text
    return node
  }
  /** One clickable action in the vocabulary's button style. */
  const button = (text, action) => {
    const node = element('button', 'u-btn', text)
    node.type = 'button'
    node.addEventListener('click', action)
    return node
  }
  const root = element('div', 'u-call-browser')
  root.append(element('h3', '', 'Function calls'), element('p', 'u-flow-basis', 'Static source inspection. Called from covers this file only. A call site is a place in the code that invokes a function; it does not prove the call ran.'))
  if (options.error) { root.append(element('p', '', options.error)); return root }
  const picker = element('select', 'u-call-picker')
  picker.setAttribute('aria-label', 'Inspect function')
  const all = element('option', '', 'Module top level')
  all.value = ''
  picker.append(all)
  for (const item of options.functions) {
    const choice = element('option', '', `${item.name} · L${item.line}`)
    choice.value = item.id
    picker.append(choice)
  }
  picker.value = options.selected || ''
  picker.addEventListener('change', () => options.onFunction(picker.value))
  root.append(picker)
  const selected = options.functions.find(item => item.id === options.selected)
  const relationship = element('div', 'u-call-relationship')
  const incoming = element('section', 'u-call-column')
  incoming.append(element('h4', '', 'Called from →'))
  const callers = selected ? options.calls.filter(call => call.target === selected.id) : []
  if (!callers.length) incoming.append(element('p', 'u-flow-basis', 'No resolved callers in this file. External callers and callbacks may still exist.'))
  for (const call of callers) {
    const owner = options.functions.find(item => item.id === call.owner)
    incoming.append(button(`${owner?.name || 'Module top level'} · L${call.line}`, () => options.onSite(call.id)))
  }
  const outgoing = element('section', 'u-call-column')
  outgoing.append(element('h4', '', '→ Calls'))
  const calls = options.calls.filter(call => call.owner === (options.selected || null))
  if (!calls.length) outgoing.append(element('p', 'u-flow-basis', 'No direct call expressions in this function.'))
  for (const call of calls) {
    const row = element('div', 'u-call-item')
    row.append(button(`${call.name} · L${call.line}`, () => options.onSite(call.id)))
    if (call.target || call.imported) row.append(button('Definition ↗', () => options.onDefinition(call.id)))
    row.append(element('small', '', call.reason))
    outgoing.append(row)
  }
  relationship.append(incoming, outgoing)
  root.append(relationship)
  return root
}
