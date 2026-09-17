import { dia, shapes } from '@joint/core'

function fileShape(node, selected) {
  const width = node.width || 240, height = node.height || 76
  const markup = [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'group' }, { tagName: 'text', selector: 'title' }]
  const attrs = {
    root: { role: 'button', tabindex: 0, 'aria-label': node.title || node.id },
    body: { width, height, fill: selected ? '#242c3c' : '#202127', stroke: selected ? '#88b4ff' : '#626875', strokeWidth: selected ? 2 : 1, rx: 3 },
    group: { x: 12, y: 23, text: node.group || node.kind || 'System', fill: '#aaaeb9', fontSize: 11 },
    title: { x: 12, y: 48, text: node.title || node.id, fill: '#f1f3f9', fontSize: 14, fontWeight: 600 }
  }
  const ports = [{ id: node.id + ':in', group: 'row', args: { x: 0, y: 38 } }, { id: node.id + ':out', group: 'row', args: { x: width, y: 38 } }]
  if (node.functions) {
    markup.push({ tagName: 'path', selector: 'divider' })
    attrs.divider = { d: `M0 64 H${width}`, stroke: '#626875' }
    if (!node.functions.length) { markup.push({ tagName: 'text', selector: 'empty' }); attrs.empty = { x: 12, y: 90, text: 'No functions declared', fill: '#aaaeb9', fontSize: 12 } }
    node.functions.forEach((item, index) => {
      const selector = 'function' + index
      markup.push({ tagName: 'text', selector })
      attrs[selector] = { x: 12, y: 90 + index * 24, text: item.name + '()', fill: '#d7e4ff', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', 'data-line': item.line, role: 'button', tabindex: 0, 'aria-label': `${node.title}: ${item.name}, line ${item.line}` }
      ports.push({ id: node.id + ':in:' + index, group: 'row', args: { x: 0, y: 90 + index * 24 } }, { id: node.id + ':out:' + index, group: 'row', args: { x: width, y: 90 + index * 24 } })
    })
  }
  return new dia.Element({ id: node.id, type: 'standard.Rectangle', position: { x: node.x || 0, y: node.y || 0 }, size: { width, height }, markup, attrs,
    ports: { groups: { row: { position: { name: 'absolute' }, attrs: { circle: { r: 2, fill: '#93acd5', stroke: 'none', magnet: false } } } }, items: ports }
  })
}

export function mount(element, options) {
  element.style.cssText = 'height:100%;min-height:450px;position:relative;overflow:hidden;background:#15171d'
  element.setAttribute('aria-label', 'JointJS systems diagram')
  const surface = document.createElement('div')
  element.append(surface)
  const graph = new dia.Graph({}, { cellNamespace: shapes })
  const paper = new dia.Paper({ el: surface, model: graph, cellViewNamespace: shapes, width: 800, height: 600, gridSize: 10,
    background: { color: '#15171d' }, interactive: { elementMove: !!options.editable, linkMove: false }, async: false,
    // A tiny pointer drift must still count as a click; the default of 0 loses clicks on large file nodes.
    clickThreshold: 8, magnetThreshold: 'onleave'
  })
  const nodes = options.nodes.map(node => fileShape(node, node.id === options.selected))
  const links = options.edges.map(edge => {
    const related = !options.selected || edge.from === options.selected || edge.to === options.selected || edge.id === options.selectedEdge
    const section = edge.sections?.[0]
    const link = new shapes.standard.Link({ id: edge.id,
      source: { id: edge.from, port: edge.sourcePort || edge.from + ':out' }, target: { id: edge.to, port: edge.targetPort || edge.to + ':in' },
      vertices: section?.bendPoints || [],
      attrs: { root: { role: 'button', tabindex: 0, 'aria-label': edge.label || edge.kind || 'Connection' }, line: { stroke: related ? '#8ab4f8' : '#484d59', strokeWidth: edge.id === options.selectedEdge ? 3 : 1.5, targetMarker: { type: 'path', d: 'M 9 -4 0 0 9 4 z' } } }
    })
    if (!section) link.router('manhattan', { padding: 15 })
    link.connector('rounded', { radius: 8 })
    if (related && edge.label) link.labels([{ attrs: { text: { text: edge.label, fill: '#d7e4ff', fontSize: 11 }, rect: { fill: '#15171d', stroke: 'none' } } }])
    return link
  })
  graph.resetCells([...links, ...nodes])
  const view = options.view || { x: 0, y: 0, scale: .7 }
  const update = () => { paper.scale(view.scale); paper.translate(-view.x * view.scale, -view.y * view.scale) }
  update()
  const resize = new ResizeObserver(() => paper.setDimensions(element.clientWidth, Math.max(450, element.clientHeight)))
  resize.observe(element)
  const openNode = (cell, event) => {
    const line = Number(event.target.closest('[data-line]')?.getAttribute('data-line'))
    if (line) options.onFunction?.(cell.model.id, line)
    else options.onSelect?.(cell.model.id)
  }
  paper.on('element:pointerclick', openNode)
  paper.on('link:pointerclick', cell => options.onEdge?.(cell.model.id))
  paper.on('element:pointerup', cell => {
    if (!options.editable) return
    const position = cell.model.position(), original = options.nodes.find(node => node.id === cell.model.id)
    if (original && (position.x !== original.x || position.y !== original.y)) options.onMove?.(cell.model.id, position.x, position.y)
  })
  const keyboard = event => {
    if (!['Enter', ' '].includes(event.key)) return
    const cell = paper.findView(event.target)
    if (!cell) return
    event.preventDefault(); event.stopPropagation()
    if (cell.model.isLink()) options.onEdge?.(cell.model.id)
    else openNode(cell, event)
  }
  element.addEventListener('keydown', keyboard)
  let pan
  paper.on('blank:pointerdown', event => { pan = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y } })
  const move = event => { if (pan) { view.x = pan.viewX - (event.clientX - pan.x) / view.scale; view.y = pan.viewY - (event.clientY - pan.y) / view.scale; update() } }
  const end = () => { pan = null }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end)
  const zoom = event => {
    event.preventDefault()
    const bounds = element.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top
    const previous = view.scale
    view.scale = Math.max(.05, Math.min(3, previous * Math.exp(-event.deltaY * .001)))
    view.x += x / previous - x / view.scale; view.y += y / previous - y / view.scale; update()
  }
  element.addEventListener('wheel', zoom, { passive: false })
  const controls = document.createElement('div'); controls.className = 'sw-zoom'
  const button = (label, run) => { const button = document.createElement('button'); button.className = 'u-btn'; button.textContent = label; button.onclick = run; controls.append(button) }
  button('−', () => { view.scale = Math.max(.05, view.scale / 1.25); update() })
  button('+', () => { view.scale = Math.min(3, view.scale * 1.25); update() })
  button('Fit diagram', () => {
    const bounds = graph.getBBox(); if (!bounds) return
    view.x = bounds.x - 30; view.y = bounds.y - 30
    view.scale = Math.max(.02, Math.min(1, element.clientWidth / (bounds.width + 60), element.clientHeight / (bounds.height + 60))); update()
  })
  button('Selected file', () => { const node = options.nodes.find(node => node.id === options.selected); if (node) { view.x = node.x - 30; view.y = node.y - 30; view.scale = .8; update() } })
  element.append(controls)
  return { dispose() { resize.disconnect(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); element.removeEventListener('wheel', zoom); element.removeEventListener('keydown', keyboard); paper.remove(); graph.clear() } }
}
