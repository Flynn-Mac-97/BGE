/** Collapse cycles before ranking so recursive calls cannot push columns forever. */
function components(nodes, edges) {
  const links = new Map(nodes.map(node => [node.id, []]))
  for (const edge of edges) links.get(edge.from)?.push(edge.to)
  const seen = new Map(), low = new Map(), active = new Set(), stack = [], groups = []
  function visit(id) {
    seen.set(id, seen.size); low.set(id, seen.get(id)); stack.push(id); active.add(id)
    for (const target of links.get(id)) {
      if (!seen.has(target)) { visit(target); low.set(id, Math.min(low.get(id), low.get(target))) }
      else if (active.has(target)) low.set(id, Math.min(low.get(id), seen.get(target)))
    }
    if (low.get(id) !== seen.get(id)) return
    const group = []
    let member
    do { member = stack.pop(); active.delete(member); group.push(member) } while (member !== id)
    groups.push(group.sort())
  }
  for (const node of nodes) if (!seen.has(node.id)) visit(node.id)
  return groups
}

export function layoutCalls(input, connections) {
  const nodes = [...input].sort((first, second) => first.id.localeCompare(second.id))
  const ids = new Set(nodes.map(node => node.id))
  const edges = connections.filter(edge => ids.has(edge.from) && ids.has(edge.to))
  const groups = components(nodes, edges)
  const groupOf = new Map(groups.flatMap((group, index) => group.map(id => [id, index])))
  const targets = groups.map(() => new Set()), incoming = groups.map(() => 0), ranks = groups.map(() => 0)
  for (const edge of edges) {
    const from = groupOf.get(edge.from), to = groupOf.get(edge.to)
    if (from !== to && !targets[from].has(to)) { targets[from].add(to); incoming[to]++ }
  }
  const ready = incoming.flatMap((count, index) => count ? [] : [index])
  for (let index = 0; index < ready.length; index++) {
    const from = ready[index]
    for (const to of targets[from]) {
      ranks[to] = Math.max(ranks[to], ranks[from] + 1)
      if (--incoming[to] === 0) ready.push(to)
    }
  }
  const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]))
  const measured = nodes.map(node => ({
    ...node,
    width: Math.max(300, (Math.max(node.title.length, ...(node.functions || []).map(item => item.name.length + 5)) * 8) + 32),
    height: 82 + Math.max(1, node.functions?.length || 0) * 24,
    rank: ranks[groupOf.get(node.id)],
    cycle: groups[groupOf.get(node.id)].length > 1 || edges.some(edge => edge.from === node.id && edge.to === node.id),
    disconnected: !connected.has(node.id)
  }))
  const columns = new Map()
  for (const node of measured.filter(node => !node.disconnected)) {
    const column = columns.get(node.rank) || []
    column.push(node); columns.set(node.rank, column)
  }
  let x = 40, bottom = 40
  const placed = new Map()
  for (const [rank, column] of [...columns].sort(([first], [second]) => first - second)) {
    const parentPosition = node => {
      const parents = edges.filter(edge => edge.to === node.id).map(edge => placed.get(edge.from)).filter(Boolean)
      return parents.length ? parents.reduce((sum, parent) => sum + parent.y, 0) / parents.length : 0
    }
    const callsFrom = node => edges.filter(edge => edge.from === node.id).length
    column.sort((first, second) => parentPosition(first) - parentPosition(second) || callsFrom(second) - callsFrom(first) || first.id.localeCompare(second.id))
    let y = 40
    for (const node of column) {
      Object.assign(node, { x, y, rank }); placed.set(node.id, node)
      y += node.height + 64
    }
    bottom = Math.max(bottom, y)
    x += Math.max(...column.map(node => node.width)) + 180
  }
  let y = bottom + 100
  const isolated = measured.filter(node => node.disconnected)
  for (let index = 0; index < isolated.length; index += 3) {
    let x = 40
    const row = isolated.slice(index, index + 3)
    for (const node of row) { Object.assign(node, { x, y }); x += node.width + 80 }
    y += Math.max(...row.map(node => node.height)) + 64
  }
  return measured
}
