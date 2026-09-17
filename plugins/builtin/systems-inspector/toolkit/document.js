import { cycles } from './analysis.js'

const clone = value => JSON.parse(JSON.stringify(value))
const kinds = ['system','function','event','data','decision','note']
const relations = ['depends','calls','data','event','contains','flow']
export function validateDocument(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('Expected a version 1 systems design document')
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new Error('Document title must contain 1–200 characters')
  if (value.nodes.length > 500 || value.edges.length > 2000 || JSON.stringify(value).length > 2_000_000) throw new Error('Diagram exceeds the document limit')
  const ids = new Set()
  for (const node of value.nodes) {
    if (typeof node.id !== 'string' || !/^[\w:-]{1,180}$/.test(node.id) || ids.has(node.id)) throw new Error('Node IDs must be unique and valid')
    ids.add(node.id)
    if (!kinds.includes(node.kind) || typeof node.title !== 'string' || !node.title.trim() || node.title.length > 200) throw new Error('Each node needs a supported kind and title')
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 1e6 || Math.abs(node.y) > 1e6) throw new Error('Node positions must be finite')
    for (const key of ['description','inputs','outputs','constraints','acceptance','group']) if (node[key] != null && (typeof node[key] !== 'string' || node[key].length > 20000)) throw new Error(`Invalid node ${key}`)
    if (node.source && (typeof node.source.file !== 'string' || !Number.isInteger(node.source.line) || node.source.line < 1 || typeof node.source.fingerprint !== 'string')) throw new Error('Invalid source evidence')
  }
  const edgeIds = new Set()
  for (const edge of value.edges) {
    if (!edge.id || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || !relations.includes(edge.kind)) throw new Error('Invalid, duplicate or dangling edge')
    edgeIds.add(edge.id)
    if (typeof edge.label !== 'string' || edge.label.length > 1000) throw new Error('Invalid edge label')
  }
  for (const key of ['purpose','constraints','decisions','acceptance']) if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > 50000)) throw new Error(`Invalid document ${key}`)
  return clone(value)
}
export function newDocument(title = 'Untitled design') { return { version:1, title, purpose:'', constraints:'', decisions:'', acceptance:'', nodes:[], edges:[] } }
export function applyEdit(document, edit) {
  const next = clone(document)
  if (edit.type === 'document') Object.assign(next,edit.values)
  else if (edit.type === 'add-node') next.nodes.push({ kind:'system', x:40, y:40, description:'', inputs:'', outputs:'', constraints:'', acceptance:'', group:'Design', ...edit.node })
  else if (edit.type === 'node') { const node = next.nodes.find(node => node.id === edit.id); if (!node) throw new Error('Node not found'); Object.assign(node,edit.values) }
  else if (edit.type === 'remove-node') { next.nodes = next.nodes.filter(node => node.id !== edit.id); next.edges = next.edges.filter(edge => edge.from !== edit.id && edge.to !== edit.id) }
  else if (edit.type === 'add-edge') next.edges.push({ kind:'depends', label:'depends on', ...edit.edge })
  else if (edit.type === 'edge') { const edge = next.edges.find(edge => edge.id === edit.id); if (!edge) throw new Error('Edge not found'); Object.assign(edge,edit.values) }
  else if (edit.type === 'remove-edge') next.edges = next.edges.filter(edge => edge.id !== edit.id)
  else if (edit.type === 'layout') for (const node of next.nodes) Object.assign(node,edit.positions[node.id] || {})
  else throw new Error('Unknown edit')
  return validateDocument(next)
}
export function documentFindings(document, files = []) {
  const findings = []
  for (const node of document.nodes) {
    if (!node.description?.trim()) findings.push({kind:'design',node:node.id,message:`${node.title}: responsibility is not specified`})
    if (node.source) {
      const file = files.find(file => file.id === node.source.file)
      if (!file) findings.push({kind:'missing-evidence',node:node.id,message:`${node.title}: linked source is absent from this scan`})
      else if (node.source.fingerprint !== file.fingerprint) findings.push({kind:'changed-evidence',node:node.id,message:`${node.title}: source changed since this design was linked`})
    }
  }
  if (!document.acceptance?.trim()) findings.push({kind:'design',message:'No document acceptance criteria yet'})
  for (const cycle of cycles(document.nodes,document.edges.filter(edge => edge.kind === 'depends'))) findings.push({kind:'cycle',message:'Dependency cycle: ' + cycle.join(' → ')})
  return findings
}
const escape = text => String(text || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
export function exportMermaid(document) {
  const aliases = new Map(document.nodes.map((node,index) => [node.id,`n${index}`]))
  return ['flowchart LR', ...document.nodes.map(node => `  ${aliases.get(node.id)}["${escape(node.title).replaceAll('\n',' ')}"]`), ...document.edges.map(edge => `  ${aliases.get(edge.from)} -->|"${escape(edge.label).replaceAll('\n',' ')}"| ${aliases.get(edge.to)}`)].join('\n')
}
export function exportSVG(document) {
  const nodes = document.nodes
  const minX = Math.min(0,...nodes.map(node=>node.x)) - 20, minY = Math.min(0,...nodes.map(node=>node.y)) - 20
  const width = Math.max(500,...nodes.map(node=>node.x+280)) - minX, height = Math.max(300,...nodes.map(node=>node.y+120)) - minY
  const edges = document.edges.map(edge=>{
    const from=nodes.find(node=>node.id===edge.from),to=nodes.find(node=>node.id===edge.to)
    return `<path d="M${from.x+240},${from.y+38} L${to.x},${to.y+38}" fill="none" stroke="#64748b" marker-end="url(#arrow)"/><text x="${(from.x+240+to.x)/2}" y="${(from.y+to.y)/2+28}" font-size="12">${escape(edge.label)}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#64748b"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f8fafc"/><g font-family="sans-serif" fill="#0f172a">${edges}${nodes.map(node=>`<g transform="translate(${node.x},${node.y})"><rect width="240" height="76" rx="8" fill="#fff" stroke="#64748b"/><text x="12" y="23" font-size="11">${escape(node.kind)}</text><text x="12" y="49" font-size="15">${escape(node.title.slice(0,29))}</text></g>`).join('')}</g></svg>`
}
export function implementationBrief(document, files = []) {
  validateDocument(document)
  const output = [`# ${document.title}`, '', '## Purpose', document.purpose || '(Specify the intended outcome.)', '', '## Constraints',document.constraints || '(None recorded.)', '', '## Design decisions',document.decisions || '(None recorded.)', '', '## Acceptance criteria',document.acceptance || '(Required before implementation.)', '', '## Components']
  for (const node of document.nodes) output.push(`\n### ${node.title} [${node.kind}]`,node.description || '(Responsibility unspecified.)',`Inputs: ${node.inputs || 'unspecified'}`,`Outputs: ${node.outputs || 'unspecified'}`,`Constraints: ${node.constraints || 'none recorded'}`,`Acceptance: ${node.acceptance || 'unspecified'}`,node.source ? `Code evidence: ${node.source.file}:${node.source.line} · fingerprint ${node.source.fingerprint}` : 'Proposed concept; no code evidence linked.')
  output.push('\n## Relationships')
  for (const edge of document.edges) output.push(`- ${document.nodes.find(node=>node.id===edge.from).title} → ${document.nodes.find(node=>node.id===edge.to).title}: ${edge.label} (${edge.kind})`)
  output.push('\n## Review before coding', ...documentFindings(document,files).map(finding=>'- '+finding.message), '\nUse the diagram as design intent. Verify linked source before editing. Static evidence does not prove runtime execution. Keep proposed changes separate from observed code; satisfy the acceptance criteria and report tests.')
  return output.join('\n')
}
