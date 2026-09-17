import { parse } from 'acorn'

/** First version: direct calls in one linear entry function; callback bodies stay separate. */
export function programFlow(analysis) {
  const empty = message => ({ nodes: [], edges: [], message })
  if (!analysis) return empty('Scan source to find the browser entry point.')
  const html = analysis.files.find(file => file.path.endsWith('.html'))
  const moduleId = analysis.edges.find(edge => edge.kind === 'import' && edge.from === html?.id && /\.(m?js)$/.test(edge.to))?.to
  const file = analysis.files.find(file => file.id === moduleId)
  if (!file) return empty('No browser entry script found. File Relationships is still available.')
  const info = analysis.info.get(file.id)
  const invocation = info.calls.find(call => call.owner === null && call.target)
  const entry = info.functions.find(item => item.id === invocation?.target)
  if (!entry) return empty('No direct local entry-function call found. Use File Relationships to inspect this module.')
  const tree = parse(file.text, { ecmaVersion: 'latest', sourceType: 'module' })
  const declaration = tree.body.find(node => node.start === entry.start)
  if (!declaration?.body?.body) return empty('This entry function needs a detailed flow view.')
  if (declaration.body.body.some(node => !['VariableDeclaration','ExpressionStatement','FunctionDeclaration','EmptyStatement','ReturnStatement'].includes(node.type))) {
    return empty('This entry contains branches or loops. Use Visual Script for its detailed flow.')
  }
  const nodes = [], edges = []
  // A call step points at its call site. Its definition is the function it runs, so a reader can jump from the call to what it does.
  const definitionOf = call => {
    if (call.target) { const fn = info.functions.find(item => item.id === call.target); return fn ? { file: file.id, line: fn.line } : null }
    return analysis.edges.find(edge => edge.kind === 'call' && edge.from === file.id && edge.evidence.line === call.line)?.target || null
  }
  const add = (title, group, source, definition = null) => {
    const node = { id: 'startup:' + nodes.length, title, group, kind: 'flow', source, definition, x: 40 + nodes.length * 340, y: 60, width: 280, height: 86 }
    const previous = nodes.at(-1)
    nodes.push(node)
    if (previous) edges.push({ id: 'startup-edge:' + edges.length, from: previous.id, to: node.id, kind: 'flow', label: '', evidence: source })
  }
  add(html.path, 'Page entry', { file: html.id, line: 1 })
  add(file.path, 'Entry script', { file: file.id, line: invocation.line })
  add(entry.name + '()', 'Start function', { file: file.id, line: entry.line })
  const returned = declaration.body.body.find(node => node.type === 'ReturnStatement')
  const calls = [], byStart = new Map(info.calls.filter(call=>call.owner===entry.id).map(call=>[call.start,call]))
  let conditional = false
  const visit = node => {
    if (/Function/.test(node.type)) return
    if (['ConditionalExpression','LogicalExpression','ChainExpression'].includes(node.type)) conditional = true
    for (const value of Object.values(node)) for (const child of Array.isArray(value)?value:[value]) if(child?.type)visit(child)
    const call = byStart.get(node.start)
    if (['CallExpression','NewExpression'].includes(node.type) && call && !/^(console\.|document\.)/.test(call.name)) calls.push(call)
  }
  for (const statement of declaration.body.body) { visit(statement); if(statement===returned)break }
  if(conditional)return empty('This entry has conditional expressions. Use Visual Script to inspect its branches.')
  for (const call of calls) {
    const awaited = /await\s*$/.test(file.text.slice(Math.max(entry.start, call.start - 20), call.start))
    const scheduled = /^(setInterval|setTimeout|requestAnimationFrame)$/.test(call.name) || /\.on$/.test(call.name)
    const argument = /^\s*\(\s*(['"])([^'"]+)\1/.exec(file.text.slice(call.end))
    const title = call.name + '(' + (argument ? JSON.stringify(argument[2]) : '') + ')'
    add(title, scheduled ? 'Register / schedule callback' : awaited ? 'Await completion' : 'Call', { file: file.id, line: call.line }, definitionOf(call))
  }
  add(entry.name + '() completes', 'End of startup function', { file: file.id, line: entry.endLine })
  return { nodes, edges, message: 'Direct startup calls in source order. Assignments, browser utilities and callback bodies are omitted; calls are not expanded.' }
}
