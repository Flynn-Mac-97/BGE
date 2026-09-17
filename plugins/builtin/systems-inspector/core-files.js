import { parse } from 'acorn'
import { inspectCalls, relativeSource } from './calls.js'

function importsIn(file, text) {
  if (file === 'index.html') return [...text.matchAll(/(?:src|href)="\/(engine\/[^"?]+)"/g)].map(match => ({ path: './' + match[1], line: text.slice(0, match.index).split('\n').length, kind: 'loads' }))
  if (!/\.(js|mjs)$/.test(file)) return []
  const tree = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const imports = []
  function visit(node) {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && typeof node.source?.value === 'string') {
      imports.push({ path: node.source.value, line: node.loc.start.line, kind: node.type === 'ImportExpression' ? 'import()' : 'imports' })
    }
    for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) if (child?.type) visit(child)
  }
  visit(tree)
  return imports
}

/** Inventory membership comes from disk; edges come from literal imports in those files. */
const prepared = new WeakMap()

export function coreFilesMap(catalog, plugins = [], mode = 'calls') {
  let cached = prepared.get(catalog)
  if (!cached) { cached = new Map(); prepared.set(catalog, cached) }
  if (cached.has(mode)) return { ...cached.get(mode), plugins }
  const nodes = [], edges = [], groups = [], failures = [...(catalog.errors || [])]
  const buckets = [
    { title: 'BROWSER ENTRY', accepts: file => ['index.html', 'engine/index.js'].includes(file) },
    { title: 'ENGINE JAVASCRIPT · .js', accepts: file => file.endsWith('.js') },
    { title: 'ENGINE MODULES · .mjs', accepts: file => file.endsWith('.mjs') },
    { title: 'ENGINE STYLES', accepts: () => true }
  ]
  let remaining = [...catalog.files], y = 15
  for (const bucket of buckets) {
    const priority = ['index.html', 'engine/index.js', 'engine/start-world.js', 'engine/files.js', 'engine/plugin-import.js', 'engine/shell.js', 'engine/render.js', 'engine/world.js', 'engine/loop.js', 'engine/loader.js', 'engine/bus.js']
    const rank = file => priority.includes(file) ? priority.indexOf(file) : priority.length
    const files = remaining.filter(item => bucket.accepts(item.file)).sort((a, b) => rank(a.file) - rank(b.file))
    remaining = remaining.filter(item => !bucket.accepts(item.file))
    if (!files.length) continue
    const height = 65 + Math.ceil(files.length / 3) * 110
    groups.push({ title: bucket.title, x: 15, y, width: 1010, height })
    files.forEach((item, index) => nodes.push({ id: `file:${item.file}`, title: item.file.replace('engine/', ''), group: item.file === 'engine/index.js' ? 'Browser main · boot()' : item.file === 'engine/start-world-node.mjs' ? 'Headless world entry' : 'Engine Core',
      detail: `Source file: ${item.file}. Use Call lines to trace function calls or Import lines to inspect dependencies.`, source: { scope: 'engine', file: item.file, anchor: item.file === 'engine/index.js' ? 'async function boot()' : undefined },
      x: 30 + (index % 3) * 340, y: y + 50 + Math.floor(index / 3) * 110, width: 280, height: 76 }))
    y += height + 25
  }
  const byFile = new Map(nodes.map(node => [node.source.file, node]))
  const analyses = new Map(catalog.files.filter(item => /\.(js|mjs)$/.test(item.file)).map(item => [item.file, inspectCalls(item.text)]))
  for (const item of catalog.files) {
    let imports
    try { imports = importsIn(item.file, item.text) }
    catch (error) { failures.push(`${item.file}: ${error.message}`); continue }
    if (mode === 'calls' && item.file !== 'index.html') {
      imports = []
      const analysis = analyses.get(item.file)
      for (const call of analysis?.calls || []) {
        if (!call.imported) continue
        const target = relativeSource({ scope:'engine', file:item.file }, call.imported.path)
        const resolved = target && analyses.get(target.file)?.exports[call.imported.name]
        if (!resolved) continue
        const owner = analysis.functions.find(fn => fn.id === call.owner)?.name || 'module'
        imports.push({ path:call.imported.path, line:call.line, kind:`${owner} → ${call.imported.name}` })
      }
    }
    const targets = new Map()
    for (const imported of imports) {
      const values = targets.get(imported.path) || []
      values.push(imported)
      targets.set(imported.path, values)
    }
    let route = 0
    for (const sites of targets.values()) {
      const imported = sites[0]
      const target = relativeSource({ scope: 'engine', file: item.file }, imported.path)
      const from = byFile.get(item.file), to = target && byFile.get(target.file)
      if (!to) continue
      const x1 = from.x + from.width, y1 = from.y + 38
      const x2 = to.x + to.width, y2 = to.y + 38
      const lane = Math.max(x1,x2) + 14 + (route++ % 3) * 8
      edges.push({ from: from.id, to: to.id,
        label: imported.kind + (sites.length > 1 ? ` +${sites.length - 1}` : ''),
        labelAt:[to.x + 8, to.y - 7], points:[[x1,y1],[lane,y1],[lane,y2],[x2,y2]],
        sites: sites.map(site => ({ id: `${from.id}#${site.line}`, line:site.line, label:`${site.kind} · L${site.line}` })) })
    }
  }
  const result = { phase: 'architecture', width:1040, height:y, nodes, groups, edges, plugins, focusEdges:true,
    basis: `${catalog.files.length} core files · ${edges.length} ${mode === 'calls' ? 'call and startup connections' : 'import connections'}. Select or hover a node to trace its connections on this map; click a line for source. ${mode === 'calls' ? 'Labels name caller → function. Dynamic calls and calls through objects are not resolved.' : 'Lines represent imports, not execution.'} ${failures.join('; ')}` }
  cached.set(mode, result)
  return result
}
