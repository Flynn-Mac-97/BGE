/**
 * Group scanned files into subsystems and draw the dependencies between them.
 * The main parts of a codebase are its large modules. Each becomes a subsystem;
 * smaller files fold into the largest module they import. A file imported by
 * everyone (a shared utility) stays its own part rather than swallowing the core.
 */

// Keep plugins apart from the engine and from each other; group engine and tool files by their top folder.
function regionOf(node) {
  const parts = node.path.split('/')
  if (parts[0] === 'plugins' && parts[1] === 'builtin') return 'plugins/builtin/' + (parts[2] || '').replace(/\.[^.]+$/, '')
  return node.path.includes('/') ? parts[0] : 'root'
}

export function architectureView(nodes, edges) {
  if (!nodes.length) return { nodes: [], edges: [], message: 'No files in this scope to group.' }
  const ids = new Set(nodes.map(node => node.id))
  const importEdges = edges.filter(edge => edge.kind === 'import' && ids.has(edge.from) && ids.has(edge.to))
  const nodeById = new Map(nodes.map(node => [node.id, node]))

  // Anchors are the parts worth naming: a large file, or a file many others import.
  const isAnchor = node => (node.lines || 0) >= 150 || (node.fanIn || 0) >= 8
  const anchors = new Set()
  const regions = new Map()
  for (const node of nodes) {
    const region = regionOf(node)
    if (!regions.has(region)) regions.set(region, [])
    regions.get(region).push(node)
  }
  // Every region shows at least one part, so a small plugin still appears.
  for (const members of regions.values()) {
    const picked = members.filter(isAnchor)
    if (picked.length) for (const node of picked) anchors.add(node.id)
    else anchors.add([...members].sort(byWeight)[0].id)
  }

  const neighbours = new Map(nodes.map(node => [node.id, new Map()]))
  const link = (from, to) => neighbours.get(from).set(to, (neighbours.get(from).get(to) || 0) + 1)
  for (const edge of importEdges) { link(edge.from, edge.to); link(edge.to, edge.from) }
  const regionAnchors = new Map()
  for (const id of anchors) {
    const region = regionOf(nodeById.get(id))
    if (!regionAnchors.has(region)) regionAnchors.set(region, [])
    regionAnchors.get(region).push(nodeById.get(id))
  }

  // Fold each smaller file into the largest anchor it imports in its own region; the biggest module wins its helpers.
  const belongsTo = new Map()
  for (const node of nodes) {
    if (anchors.has(node.id)) { belongsTo.set(node.id, node.id); continue }
    const region = regionOf(node)
    const touched = [...neighbours.get(node.id).keys()].filter(id => anchors.has(id) && regionOf(nodeById.get(id)) === region).map(id => nodeById.get(id))
    const target = (touched.length ? touched : regionAnchors.get(region) || []).sort(byWeight)[0]
    belongsTo.set(node.id, target ? target.id : node.id)
  }

  const members = new Map()
  for (const node of nodes) {
    const key = belongsTo.get(node.id)
    if (!members.has(key)) members.set(key, [])
    members.get(key).push(node)
  }
  const subsystemOf = new Map(), subsystems = [], usedTitles = new Map()
  for (const [key, group] of [...members].sort((first, second) => second[1].length - first[1].length || first[0].localeCompare(second[0]))) {
    const anchor = nodeById.get(key)
    const lines = group.reduce((sum, node) => sum + (node.lines || 0), 0)
    let title = anchor.path.split('/').pop().replace(/\.[^.]+$/, '')
    const seen = (usedTitles.get(title) || 0) + 1; usedTitles.set(title, seen)
    if (seen > 1) title += ' #' + seen
    const id = 'sub:' + key
    for (const node of group) subsystemOf.set(node.id, id)
    subsystems.push({ id, title, group: `${group.length} ${group.length === 1 ? 'file' : 'files'} · ${lines} lines`,
      kind: 'system', members: group.map(node => node.id), source: anchor.source, width: 260, height: 82 })
  }
  const weight = new Map()
  for (const edge of importEdges) {
    const from = subsystemOf.get(edge.from), to = subsystemOf.get(edge.to)
    if (from && to && from !== to) { const key = from + ' ' + to; weight.set(key, (weight.get(key) || 0) + 1) }
  }
  const subsystemEdges = [...weight].map(([key, count], index) => {
    const [from, to] = key.split(' ')
    return { id: 'sub-edge:' + index, from, to, kind: 'import', label: count > 1 ? String(count) : '' }
  })
  return { nodes: subsystems, edges: subsystemEdges,
    message: `${subsystems.length} parts, built around the largest modules; smaller files fold into the module they most belong to.` }
}

function byWeight(first, second) {
  return (second.lines || 0) - (first.lines || 0) || (second.fanIn || 0) - (first.fanIn || 0) || first.id.localeCompare(second.id)
}
