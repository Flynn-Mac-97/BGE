import { inspectCalls } from './javascript.js'
import { parse } from 'acorn'

export function fingerprint(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0') + ':' + text.length
}
export const fileId = file => `${file.scope || 'source'}:${file.path || file.file}`
export function resolvePath(from, specifier, available) {
  if (!specifier.startsWith('.')) return null
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  const base = parts.join('/')
  return [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js'].find(path => available.has(path)) || null
}
function moduleInfo(text) {
  const imports = [], reexports = []
  let tree
  try { tree = parse(text, { ecmaVersion:'latest', sourceType:'module', locations:true }) }
  catch (error) { return { imports, reexports, error:error.message } }
  const visit = node => {
    if (node.source?.type === 'Literal' && ['ImportDeclaration','ImportExpression','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)) {
      imports.push({ path:node.source.value, line:node.loc.start.line, dynamic:node.type === 'ImportExpression' })
      if (node.type === 'ExportNamedDeclaration') for (const spec of node.specifiers) reexports.push({ name:spec.exported.name, imported:spec.local.name, path:node.source.value })
      if (node.type === 'ExportAllDeclaration') reexports.push({ name:'*', imported:'*', path:node.source.value })
    }
    if (node.type === 'CallExpression' && node.callee.name === 'require' && typeof node.arguments[0]?.value === 'string') imports.push({ path:node.arguments[0].value, line:node.loc.start.line })
    for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) if (child?.type) visit(child)
  }
  visit(tree)
  return { imports, reexports }
}

/** Accept plain files; no host, engine, network or filesystem is required. */
export function analyzeFiles(input) {
  const files = input.map(file => ({ ...file, path:file.path || file.file, id:fileId(file), fingerprint:fingerprint(file.text) }))
  const nodes = [], edges = [], findings = [], byId = new Map(files.map(file => [file.id,file])), info = new Map()
  for (const file of files) {
    const javascript = /\.(js|mjs|cjs)$/.test(file.path)
    const calls = javascript ? inspectCalls(file.text) : { functions:[], calls:[], exports:{} }
    const module = javascript ? moduleInfo(file.text) : { imports:[], reexports:[] }
    if (file.path.endsWith('.html')) for (const match of file.text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (!match[1].includes('://')) module.imports.push({ path:match[1].startsWith('/') ? '.' + match[1] : match[1], line:file.text.slice(0,match.index).split('\n').length })
    }
    info.set(file.id, { ...module, ...calls })
    nodes.push({ id:file.id, title:file.path.split('/').pop(), group:file.group || file.scope || 'Source', kind:'module', path:file.path, scope:file.scope || 'source', source:{file:file.id,line:1,fingerprint:file.fingerprint}, lines:file.text.split('\n').length, functions:calls.functions })
    if (calls.error || module.error) findings.push({ kind:'parse', node:file.id, message:`${file.path}: ${calls.error || module.error}` })
    for (const fn of calls.functions) if (fn.endLine - fn.line > 100) findings.push({ kind:'large-function', node:file.id, line:fn.line, message:`${fn.name}: ${fn.endLine-fn.line+1} lines` })
  }
  const targetFile = (file, path) => {
    const available = new Set(files.filter(other => other.scope === file.scope).map(other => other.path))
    const resolved = resolvePath(file.path, path, available)
    return resolved ? byId.get(`${file.scope || 'source'}:${resolved}`) : null
  }
  const exported = (file, name, seen = new Set()) => {
    const key = file.id + '#' + name
    if (seen.has(key)) return null
    seen.add(key)
    const data = info.get(file.id)
    const id = data.exports[name]
    if (id) return { file, function:data.functions.find(fn => fn.id === id) }
    for (const reexport of data.reexports) if (reexport.name === name || reexport.name === '*') {
      const target = targetFile(file,reexport.path)
      const result = target && exported(target,reexport.imported === '*' ? name : reexport.imported,seen)
      if (result) return result
    }
    return null
  }
  for (const file of files) {
    const data = info.get(file.id)
    for (const imported of data.imports) {
      const target = targetFile(file,imported.path)
      if (target) edges.push({ id:`import:${file.id}:${imported.line}:${target.id}`, from:file.id, to:target.id, kind:'import', label:imported.dynamic ? 'dynamic import' : 'imports', evidence:{file:file.id,line:imported.line}, confidence:'literal' })
      else if (imported.path.startsWith('.')) findings.push({ kind:'missing-import', node:file.id, line:imported.line, message:`Import outside this scan or missing: ${imported.path}` })
    }
    for (const call of data.calls) {
      const owner = data.functions.find(fn => fn.id === call.owner)
      const target = call.imported && targetFile(file,call.imported.path)
      const resolved = target && exported(target,call.imported.name)
      if (resolved?.function) edges.push({ id:`call:${file.id}:${call.id}`, from:file.id, to:resolved.file.id, kind:'call', label:`${owner?.name || 'module'} → ${resolved.function.name}`, evidence:{file:file.id,line:call.line}, target:{file:resolved.file.id,line:resolved.function.line}, confidence:'lexical' })
    }
    const unresolved = data.calls.filter(call => !call.target && !call.imported).length
    if (unresolved) findings.push({ kind:'unresolved', node:file.id, message:`${unresolved} dynamic/external call sites; no destination inferred.` })
  }
  const imports = edges.filter(edge => edge.kind === 'import')
  for (const cycle of cycles(nodes,imports)) findings.push({ kind:'cycle', node:cycle[0], message:'Import cycle: ' + cycle.join(' → ') })
  for (const node of nodes) {
    node.fanIn = new Set(imports.filter(edge => edge.to === node.id).map(edge => edge.from)).size
    node.fanOut = new Set(imports.filter(edge => edge.from === node.id).map(edge => edge.to)).size
    if (node.fanIn >= 8 || node.fanOut >= 8) findings.push({ kind:'coupling', node:node.id, message:`${node.title}: ${node.fanIn} incoming / ${node.fanOut} outgoing module dependencies` })
  }
  return { nodes, edges, findings, files, info }
}

export function cycles(nodes, edges) {
  const adjacency = new Map(nodes.map(node => [node.id,[]]))
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to)
  const seen = new Set(), active = new Set(), path = [], result = []
  function visit(id) {
    if (active.has(id)) { result.push([...path.slice(path.indexOf(id)),id]); return }
    if (seen.has(id)) return
    seen.add(id); active.add(id); path.push(id)
    for (const target of adjacency.get(id) || []) visit(target)
    active.delete(id); path.pop()
  }
  for (const node of nodes) visit(node.id)
  return result
}

export function layout(nodes) {
  const groups = [...new Set(nodes.map(node => node.group || 'Design'))].sort()
  let y = 40
  const result = []
  for (const group of groups) {
    const members = nodes.filter(node => (node.group || 'Design') === group)
    members.forEach((node,index) => result.push({ ...node, x:40 + index % 4 * 300, y:y + Math.floor(index/4)*120, width:240, height:76 }))
    y += Math.ceil(members.length/4)*120 + 60
  }
  return result
}
