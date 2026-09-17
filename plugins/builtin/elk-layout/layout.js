import ELK from 'elkjs/lib/elk.bundled.js'

export function ports(node) {
  return [
    { id: node.id + ':in', x: 0, y: 38, width: 0, height: 0 },
    { id: node.id + ':out', x: node.width, y: 38, width: 0, height: 0 },
    ...(node.functions || []).flatMap((item, index) => [
      { id: node.id + ':in:' + index, x: 0, y: 90 + index * 24, width: 0, height: 0 },
      { id: node.id + ':out:' + index, x: node.width, y: 90 + index * 24, width: 0, height: 0 }
    ])
  ]
}

export function endpoints(edge, nodes) {
  const from = nodes.get(edge.from), to = nodes.get(edge.to)
  const owners = (from.functions || []).filter(item => item.line <= edge.evidence?.line && item.endLine >= edge.evidence?.line)
  const owner = owners.sort((first, second) => second.start - first.start)[0]
  const source = from.functions?.indexOf(owner) ?? -1
  const target = to.functions?.findIndex(item => item.line === edge.target?.line) ?? -1
  return { sourcePort: from.id + ':out' + (source >= 0 ? ':' + source : ''), targetPort: to.id + ':in' + (target >= 0 ? ':' + target : '') }
}

export async function arrange(graph) {
  const nodes = graph.nodes.map(node => ({ ...node, width: node.width || 300, height: node.height || 100 }))
  if (!nodes.length) return { nodes: [], edges: [] }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const edges = graph.edges.filter(edge => byId.has(edge.from) && byId.has(edge.to)).map(edge => ({ ...edge, ...endpoints(edge, byId) }))
  const engine = new ELK()
  {
    const result = await engine.layout({
      id: 'root', layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '70', 'elk.layered.spacing.nodeNodeBetweenLayers': '180',
        'elk.padding': '[top=40,left=40,bottom=40,right=40]'
      },
      children: nodes.map(node => ({ id: node.id, width: node.width, height: node.height, ports: ports(node), layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } })),
      edges: edges.map(edge => ({ id: edge.id, sources: [edge.sourcePort], targets: [edge.targetPort] }))
    })
    const positions = new Map(result.children.map(node => [node.id, node]))
    const routes = new Map(result.edges.map(edge => [edge.id, edge.sections]))
    return {
      nodes: nodes.map(node => ({ ...node, x: positions.get(node.id).x, y: positions.get(node.id).y })),
      edges: edges.map(edge => ({ ...edge, sections: routes.get(edge.id) || [] }))
    }
  }
}
