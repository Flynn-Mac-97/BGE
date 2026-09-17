/** Render labelled relationships. All engine-specific data comes from the plugin. */
export function makeSystemsMap(options) {
  const namespace = 'http://www.w3.org/2000/svg'
  /** Build one SVG node. Attributes are stringified; `text` sets the text content. */
  const svgNode = (tag, attributes = {}, text) => {
    const node = document.createElementNS(namespace, tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
    if (text) node.textContent = text
    return node
  }
  const wrapper = document.createElement('div')
  wrapper.className = 'u-systems-map'
  const svg = svgNode('svg', { viewBox: `0 0 ${options.width} ${options.height}`, role: 'group', 'aria-label': 'Systems relationship diagram' })
  const definitions = svgNode('defs')
  const marker = svgNode('marker', { id: 'systems-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' })
  marker.append(svgNode('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'currentColor' }))
  definitions.append(marker); svg.append(definitions)
  const siteList = document.createElement('div')
  siteList.className = 'u-map-sites'
  siteList.setAttribute('aria-label', 'Call sites')
  wrapper.append(siteList)
  for (const group of options.groups) {
    svg.append(svgNode('rect', { x:group.x,y:group.y,width:group.width,height:group.height,rx:12,class:'u-map-boundary' }))
    svg.append(svgNode('text', { x:group.x+16,y:group.y+24,class:'u-map-group' },group.title))
  }
  for (const edge of options.edges) {
    const path = edge.points.map(([x,y],index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ')
    const group = svgNode('g', { class:'u-map-edge' + (edge.unresolved ? ' unresolved' : ''), 'data-from':edge.from, 'data-to':edge.to })
    group.append(svgNode('path', { d:path, fill:'none', 'marker-end':'url(#systems-arrow)' }))
    const middle = edge.labelAt || edge.points[Math.floor((edge.points.length-1)/2)]
    const text = svgNode('text', { x:middle[0],y:middle[1],class:'u-map-edge-label' },edge.label)
    group.append(text)
    if (edge.sites?.length && options.onSite) {
      group.setAttribute('role', 'button')
      group.setAttribute('tabindex', '0')
      group.setAttribute('aria-label', `${edge.label}: ${edge.sites.map(site => 'line ' + site.line).join(', ')}`)
      const hit = svgNode('path', { d:path, fill:'none', stroke:'transparent', 'stroke-width':18, class:'u-map-edge-hit' })
      group.append(hit)
      group.append(svgNode('rect', { x:middle[0]-8, y:middle[1]-20, width:Math.max(90, edge.label.length*10), height:32, fill:'transparent', 'pointer-events':'all' }))
      const open = () => {
        siteList.replaceChildren()
        for (const site of edge.sites) {
          const button = document.createElement('button')
          button.className = 'u-btn'
          button.textContent = site.label || `Call site · line ${site.line}`
          button.addEventListener('click', () => options.onSite(site.id))
          siteList.append(button)
        }
        if (edge.sites.length === 1) options.onSite(edge.sites[0].id)
        else siteList.querySelector('button')?.focus()
      }
      group.addEventListener('click', open)
      group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } })
    }
    svg.append(group)
  }
  for (const node of options.nodes) {
    const group = svgNode('g', { role:'button',tabindex:0,'aria-label':node.title,'aria-pressed':String(node.id===options.selected),class:'u-map-node'+(node.id===options.selected?' selected':''),transform:`translate(${node.x},${node.y})` })
    group.append(svgNode('rect', { width:node.width,height:node.height,rx:8 }))
    group.append(svgNode('text', { x:14,y:25,class:'u-map-group' },node.group))
    const title = svgNode('text', { x:14,y:51,class:'u-map-title' },node.title.length > 27 ? node.title.slice(0,24) + '…' : node.title)
    group.append(title, svgNode('title', {}, node.title))
    group.addEventListener('mouseenter',()=>highlight(node.id))
    group.addEventListener('focus',()=>highlight(node.id))
    group.addEventListener('click',()=>options.onSelect(node.id))
    group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();options.onSelect(node.id)}})
    svg.append(group)
  }
  /** Show only the edges touching `id`, when the caller asked for focus behaviour. */
  function highlight(id) {
    if (!options.focusEdges) return
    for (const edge of svg.querySelectorAll('.u-map-edge')) {
      const related = edge.dataset.from === id || edge.dataset.to === id
      edge.style.display = related ? '' : 'none'
      edge.style.pointerEvents = related ? '' : 'none'
      edge.querySelector('text').style.visibility = related ? 'visible' : 'hidden'
    }
  }
  highlight(options.selected)
  wrapper.append(svg)
  if (!options.plugins?.length) return wrapper
  const list = document.createElement('details')
  list.className='u-map-plugin-list'
  list.open = options.selected === 'plugins' || options.selected.startsWith('plugin:')
  const summary=document.createElement('summary')
  summary.textContent=`Inspect plugins (${options.plugins.length})`
  list.append(summary)
  for(const plugin of options.plugins){
    const button=document.createElement('button')
    button.className='u-btn'
    button.textContent=plugin.title
    button.addEventListener('click',()=>options.onSelect(plugin.id))
    list.append(button)
  }
  wrapper.append(list)
  return wrapper
}
