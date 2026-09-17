import { parse } from 'acorn'

const isFunction = node => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)
const children = node => Object.values(node).flatMap(value => Array.isArray(value) ? value : [value]).filter(value => value && typeof value.type === 'string')
const names = node => {
  if (!node || node.type === 'MemberExpression') return []
  if (node.type === 'Identifier') return [node.name]
  if (node.type === 'Property') return names(node.value)
  if (node.type === 'AssignmentPattern') return names(node.left)
  return children(node).flatMap(names)
}
const lookup = (scope, name) => {
  for (let current = scope; current; current = current.parent) if (current.bindings.has(name)) return current.bindings.get(name)
  return null
}

/** Resolve lexical calls only. Object dispatch and reassigned bindings need runtime evidence. */
export function inspectCalls(text) {
  let tree
  try { tree = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) }
  catch (error) { return { functions: [], calls: [], exports: {}, error: `Cannot parse this source: ${error.message}` } }
  const functions = [], pending = [], mutations = [], scopes = new WeakMap()
  const root = { parent: null, bindings: new Map(), functionScope: true }
  const bind = (scope, name, value) => scope.bindings.set(name, scope.bindings.has(name) ? null : value)
  function visit(node, scope, owner = null, parent = null) {
    scopes.set(node, scope)
    if (isFunction(node)) {
      const name = node.id?.name || (parent?.type === 'VariableDeclarator' ? parent.id.name : null) ||
        (['Property', 'MethodDefinition'].includes(parent?.type) ? text.slice(parent.key.start, parent.key.end) : null) || `callback at L${node.loc.start.line}`
      const record = { id: String(node.start), name, line: node.loc.start.line, column: node.loc.start.column, endLine: node.loc.end.line, start: node.start, end: node.end }
      functions.push(record)
      if (node.type === 'FunctionDeclaration' && node.id) bind(scope, node.id.name, { target: record.id })
      const inner = { parent: scope, bindings: new Map(), functionScope: true }
      if (node.type === 'FunctionExpression' && node.id) bind(inner, node.id.name, { target: record.id })
      for (const parameter of node.params) for (const name of names(parameter)) bind(inner, name, null)
      for (const parameter of node.params) visit(parameter, inner, record.id, node)
      visit(node.body, inner, record.id, node)
      return
    }
    if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassBody', 'StaticBlock'].includes(node.type)) {
      scope = { parent: scope, bindings: new Map(), functionScope: false }
      scopes.set(node, scope)
      if (node.type === 'CatchClause') for (const name of names(node.param)) bind(scope, name, null)
    }
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) {
      bind(scope, specifier.local.name, { imported: { path: node.source.value, name: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name || specifier.imported?.value || '*' } })
    }
    if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) {
      let destination = scope
      if (node.kind === 'var') while (!destination.functionScope) destination = destination.parent
      for (const name of names(declaration.id)) bind(destination, name,
        declaration.id.type === 'Identifier' && declaration.init && isFunction(declaration.init) ? { target: String(declaration.init.start) } : null)
    }
    if (node.type === 'ClassDeclaration' && node.id) bind(scope, node.id.name, null)
    if (['AssignmentExpression', 'UpdateExpression'].includes(node.type)) mutations.push({ scope, names: names(node.left || node.argument) })
    if (['CallExpression', 'NewExpression'].includes(node.type)) pending.push({ node, scope, owner })
    for (const child of children(node)) visit(child, scope, owner, node)
  }
  visit(tree, root)
  for (const mutation of mutations) for (const name of mutation.names) {
    const binding = lookup(mutation.scope, name)
    if (binding) binding.changed = true
  }
  const calls = pending.map(({ node, scope, owner }) => {
    let binding = node.callee.type === 'Identifier' ? lookup(scope, node.callee.name) : null
    if(node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.type === 'Identifier') {
      const namespace = lookup(scope,node.callee.object.name)
      if(namespace?.imported?.name === '*' && !namespace.changed) binding = { imported: { path:namespace.imported.path, name:node.callee.property.name } }
    }
    const resolved = binding && !binding.changed ? binding : null
    return { id: `call:${node.start}`, owner, name: text.slice(node.callee.start, node.callee.end), line: node.loc.start.line,
      column: node.callee.loc.start.column, start: node.callee.start, end: node.callee.end,
      target: resolved?.target || null, imported: resolved?.imported || null,
      reason: resolved?.target ? 'Local lexical binding' : resolved?.imported ? 'Imported binding' : 'Unresolved: dynamic, external, aliased or reassigned call' }
  })
  const exports = {}
  const exportedTarget = name => { const binding = lookup(root, name); return binding && !binding.changed ? binding.target : undefined }
  for (const statement of tree.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration
      exports.default = isFunction(declaration) ? (declaration.id ? exportedTarget(declaration.id.name) : String(declaration.start)) : exportedTarget(declaration.name)
    }
    if (statement.type === 'ExportNamedDeclaration' && !statement.source) {
      const declaration = statement.declaration
      if (declaration?.type === 'FunctionDeclaration') exports[declaration.id.name] = exportedTarget(declaration.id.name)
      if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) {
        for (const name of names(item.id)) exports[name] = exportedTarget(name)
      }
      for (const specifier of statement.specifiers) exports[specifier.exported.name || specifier.exported.value] = exportedTarget(specifier.local.name)
    }
  }
  return { functions, calls, exports, error: null }
}

/** The source reader applies the final scope and real-path checks. */
export function relativeSource(source, imported) {
  if (!source || !imported.startsWith('.')) return null
  const parts = source.file.split('/').slice(0, -1)
  for (const part of imported.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  const file = parts.join('/')
  return /\.(js|mjs|css|html)$/.test(file) ? { scope: source.scope, file } : null
}
