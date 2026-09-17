import { makeSystemsMap } from './ui-systems-map.js'

/** Shared diagram/source primitive. It owns layout and interaction, not engine inspection. */
export function makeFlowInspector(options) {
  /** Build one element with a class and, when given, its text. */
  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    node.className = className
    if (text != null) node.textContent = text
    return node
  }
  /** One clickable action in the vocabulary's button style, with an optional tooltip. */
  const button = (text, action, title = text) => {
    const node = element('button', 'u-btn', text)
    node.type = 'button'
    node.title = title
    node.addEventListener('click', action)
    return node
  }
  const root = element('div', 'u-flow-inspector' + (options.fullscreen ? ' is-fullscreen' : ''))
  root.setAttribute('role', options.fullscreen ? 'dialog' : 'region')
  root.setAttribute('aria-label', 'Systems Inspector')
  if (options.fullscreen) root.setAttribute('aria-modal', 'true')
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); options.onClose?.() }
    if (event.key === 'Tab' && options.fullscreen) {
      const targets = [...root.querySelectorAll('button, select, [tabindex="0"], summary')].filter(node => node.getClientRects().length)
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  })
  const controls = element('div', 'u-flow-controls')
  controls.append(element('strong', 'u-flow-heading', 'Systems Inspector'))
  for (const phase of ['architecture', 'fixed', 'frame']) {
    const choose = button(phase === 'architecture' ? 'Systems Map' : phase === 'fixed' ? 'Simulation step' : 'Presentation', () => options.onPhase(phase))
    choose.setAttribute('aria-pressed', String(options.phase === phase))
    controls.append(choose)
  }
  if (options.onMapMode) {
    for (const mode of ['calls', 'imports']) {
      const choose = button(mode === 'calls' ? 'Call lines' : 'Import lines', () => options.onMapMode(mode))
      choose.setAttribute('aria-pressed', String(options.mapMode === mode && !options.calls))
      controls.append(choose)
    }
  }
  controls.append(button('Refresh', options.onRefresh), button(options.fullscreen ? 'Dock view' : 'Fullscreen', options.onFullscreen), button('Close ×', options.onClose))
  root.append(controls, element('p', 'u-flow-basis', options.basis))
  const split = element('div', 'u-flow-split')
  const graph = element('nav', 'u-flow-graph')
  graph.setAttribute('aria-label', 'Program flow')
  /**
   * Draw a flow into `container`, one node after another, recursing into a
   * node's children only while it is expanded.
   */
  const draw = (nodes, container, nested = false) => {
    nodes.forEach((node, index) => {
      if (index > 0) container.append(element('div', 'u-flow-arrow', nested ? '↓ next' : '↓'))
      const block = element('div', 'u-flow-node' + (options.selected === node.id ? ' selected' : ''))
      block.dataset.flowNode = node.id
      block.append(element('div', 'u-flow-group', node.group))
      const select = button(node.title, () => options.onSelect(node.id))
      select.setAttribute('aria-current', String(options.selected === node.id))
      block.append(select)
      if (node.id === 'pause') block.append(element('p', 'u-flow-condition', 'Paused → skip time / timers / hit stop; continue with 0 seconds'))
      if (node.id === 'hit-stop') block.append(element('p', 'u-flow-condition', 'Held → end this simulation step'))
      if (node.children) {
        const expanded = options.expanded.has(node.id)
        const toggle = button(`${expanded ? '− Hide' : '+ Expand'} ${node.children.length}`, () => options.onExpand(node.id))
        toggle.setAttribute('aria-expanded', String(expanded))
        toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${node.title}`)
        block.append(toggle)
        if (expanded) {
          const children = element('div', 'u-flow-children')
          if (!node.children.length) children.append(element('p', 'u-flow-basis', 'None registered.'))
          draw(node.children, children, true)
          block.append(children)
        }
      }
      container.append(block)
    })
  }
  if (options.architecture) {
    graph.classList.add('architecture')
    graph.setAttribute('aria-label', 'Systems map')
    graph.append(makeSystemsMap({ ...options.architecture, selected: options.mapSelected || options.selected, onSelect: options.onMapSelect || options.onSelect, onSite: options.onMapSite }))
  } else draw(options.nodes, graph)
  const source = element('section', 'u-flow-source')
  source.setAttribute('aria-label', 'Source code')
  source.append(element('h3', '', options.title), element('p', 'u-flow-detail', options.detail))
  if (options.dependencies?.length) {
    const dependencies = element('div', 'u-flow-dependencies')
    dependencies.append(element('strong', '', 'Declared dependencies'))
    for (const dependency of options.dependencies) {
      dependencies.append(dependency.exists ? button(dependency.name, () => options.onSelect(`plugin:${dependency.name}`)) : element('span', '', `${dependency.name} (not enabled)`))
    }
    source.append(dependencies)
  }
  const file = element('div', 'u-flow-file')
  file.append(element('span', '', options.file))
  if (options.onCalls && !options.calls) file.append(button('Local function detail', options.onCalls))
  if (options.onBack) file.append(button('Back to caller file', options.onBack))
  if (options.onFile) file.append(button('Full file', options.onFile))
  source.append(file, element('p', 'u-flow-basis', options.status))
  const code = element('pre', 'u-flow-code')
  code.tabIndex = 0
  code.setAttribute('aria-label', 'Read-only source code')
  let selectedLine
  options.source.split('\n').forEach((text, index) => {
    const row = element('span', 'u-flow-code-line' + (index + 1 === options.line ? ' current' : ''))
    const number = options.onCodeLine ? button(String(index + 1), () => options.onCodeLine(index + 1), `Inspect function at line ${index + 1}`) : element('span', '', String(index + 1))
    number.className = 'u-flow-line-number'
    row.append(number, document.createTextNode(text.replace(/\r$/, '')))
    if (index + 1 === options.line) selectedLine = row
    code.append(row)
  })
  source.append(code)
  split.append(graph, source)
  root.append(split)
  requestAnimationFrame(() => {
    if (options.fullscreen && root.isConnected && !root.contains(document.activeElement)) controls.querySelector('button')?.focus()
    if (selectedLine && root.isConnected) code.scrollTop = Math.max(0, selectedLine.offsetTop - 45)
  })
  return root
}
