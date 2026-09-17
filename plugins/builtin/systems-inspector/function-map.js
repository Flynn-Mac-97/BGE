/** A module expands into a focused call graph; other functions remain selectable below it. */
export function functionMap(analysis, file, selected = '') {
  const functions = analysis?.functions || [], calls = analysis?.calls || []
  const current = functions.find(item => item.id === selected)
  const nodes = [], edges = []
  const node = (id, title, group, x, y, action) => {
    const item = { id, title, group, x, y, width: 260, height: 76, action }
    nodes.push(item)
    return item
  }
  const centre = node('focus', current?.name || 'Module top level', current ? `Selected function · L${current.line}` : 'Selected scope', 390, 110, { function: selected })
  const callers = calls.filter(call => call.target && call.target === selected)
  const outgoing = calls.filter(call => call.owner === (selected || null))
  const incomingGroups = Map.groupBy(callers, call => call.owner || '')
  const outgoingGroups = Map.groupBy(outgoing, call => call.target || call.imported?.path + ':' + call.name || call.name)
  const connect = (from, to, sites, incoming) => {
    const x1 = from.x + from.width, x2 = to.x
    const y1 = from.y + 38, y2 = to.y + 38
    const middle = (x1 + x2) / 2
    edges.push({ from: from.id, to: to.id, label: sites.length === 1 ? `L${sites[0].line}` : `${sites.length} sites`,
      points: [[x1,y1],[middle,y1],[middle,y2],[x2,y2]], labelAt:[incoming ? x1 + 5 : x2 - 60, y2 - 9],
      sites: sites.map(call => ({ id: call.id, line: call.line })), unresolved: sites.every(call => !call.target && !call.imported) })
  }
  let index = 0
  for (const [owner, sites] of incomingGroups) {
    const definition = functions.find(item => item.id === owner)
    const caller = node(`caller:${owner}`, definition?.name || 'Module top level', 'Caller in this file', 30, 110 + index++ * 100, { function: owner })
    connect(caller, centre, sites, true)
  }
  index = 0
  for (const sites of outgoingGroups.values()) {
    const call = sites[0]
    const definition = functions.find(item => item.id === call.target)
    const target = node(`target:${call.id}`, definition?.name || call.name, call.target ? 'Local function' : call.imported ? 'Imported function ↗' : 'Unresolved call', 750, 110 + index++ * 100,
      call.target ? { function: call.target } : call.imported ? { definition: call.id } : { site: call.id })
    connect(centre, target, sites, false)
  }
  const bottom = 230 + Math.max(incomingGroups.size, outgoingGroups.size, 1) * 100
  functions.forEach((item, index) => node(`function:${item.id}`, item.name, `Function · L${item.line}`, 30 + (index % 3) * 340, bottom + 55 + Math.floor(index / 3) * 92, { function: item.id }))
  const height = bottom + 80 + Math.ceil(functions.length / 3) * 92
  return { width: 1040, height, nodes, edges, plugins: [], selected: 'focus',
    groups: [{ title: file, x: 15, y: 15, width: 1010, height: bottom - 30 },
      { title: 'ALL FUNCTIONS IN THIS MODULE · CLICK TO FOLLOW CONNECTIONS', x: 15, y: bottom, width: 1010, height: height - bottom - 5 }],
    note: analysis?.error || 'Caller → selected function → calls. Click a node for its definition; click an arrow for call-site lines. Dashed arrows are unresolved. Callers cover this file only.' }
}
