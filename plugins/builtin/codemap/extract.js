/**
 * One JavaScript file's structure, read from its syntax tree.
 *
 * The tree comes from the plugin-master source reader, so the grammar, the
 * runtime and the parse are the engine's one path. This module asks the tree
 * what the file declares: its symbols, imports and exports. Everything returned
 * is plain records, so the scan can join files and the renderers can print them
 * without touching tree-sitter again.
 */

/** One-based first line of a node. */
const startLine = node => node.startPosition.row + 1

/** One-based last line of a node. */
const endLine = node => node.endPosition.row + 1

/** Remove one layer of matching quotes or backticks. */
const unquote = text => (/^['"`]/.test(text) ? text.slice(1, -1) : text)

/** The `name` field's text, or null when the declaration has no name. */
const declaredName = node => node.childForFieldName('name')?.text ?? null

/** Parameter source text; [] when the function takes none. */
function parameterNames(node) {
  const parameters = node.childForFieldName('parameters') ?? node.childForFieldName('parameter')
  if (!parameters) return []
  if (parameters.type === 'identifier') return [parameters.text]
  return parameters.namedChildren.map(child => child.text)
}

/** 'method', 'getter' or 'setter'. */
function methodKind(node) {
  // The grammar exposes no getter/setter field, so read the modifier tokens
  // before the name. Stop at the first named child: a method named `get` is not
  // a getter.
  for (let token = node.firstChild; token; token = token.nextSibling) {
    if (token.type === 'get') return 'getter'
    if (token.type === 'set') return 'setter'
    if (token.isNamed) break
  }
  return 'method'
}

/** `Parent.name` for a class member, or just `name` at the top level. */
const qualifiedName = (parent, name) => (parent ? `${parent}.${name}` : name)

/** Push one symbol; `params` and `parent` are left off rather than set empty. */
function recordSymbol(collected, { name, kind, parent, params, exported }, node, depth) {
  collected.symbols.push({
    name,
    kind,
    line: startLine(node),
    endLine: endLine(node),
    depth,
    ...(params === undefined ? {} : { params }),
    ...(parent ? { parent } : {}),
    ...(exported ? { exported: true } : {})
  })
}

/** `{ a as b }` records `a as b`; a bare `{ a }` records `a`. */
function importSpecifierName(specifier) {
  const name = specifier.childForFieldName('name')
  const alias = specifier.childForFieldName('alias')
  return alias && name ? `${name.text} as ${alias.text}` : specifier.text
}

/** One name list per import-clause form; a form with no entry contributes none. */
const IMPORT_CLAUSE_NAMES = {
  identifier: clause => [clause.text],
  // `* as ns` — the bound name is the clause's last named child.
  namespace_import: clause => [`* as ${clause.namedChildren.at(-1)?.text ?? ''}`],
  named_imports: clause =>
    clause.namedChildren.filter(child => child.type === 'import_specifier').map(importSpecifierName)
}

/** Every bound name an import clause declares. */
const importClauseNames = clause =>
  clause.namedChildren.flatMap(child => IMPORT_CLAUSE_NAMES[child.type]?.(child) ?? [])

/** The import record for one `import` statement. */
function readImportStatement(node) {
  const source = node.childForFieldName('source')
  const clause = node.namedChildren.find(child => child.type === 'import_clause')
  return {
    source: source ? unquote(source.text) : null,
    names: clause ? importClauseNames(clause) : [],
    line: startLine(node),
    kind: 'import'
  }
}

/** The module source of a `require('...')` call, or null for any other node. */
function requiredSource(node) {
  if (node?.type !== 'call_expression') return null
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'identifier' || fn.text !== 'require') return null
  const first = node.childForFieldName('arguments')?.namedChildren[0]
  return first?.type === 'string' ? unquote(first.text) : null
}

/** Push one export; `from` is left off for a local export rather than set null. */
function recordExport(collected, { name, kind, line, from }) {
  collected.exports.push({ name, kind, line, ...(from === null ? {} : { from }) })
}

/** `export ... from './x.js'`, or null for a local export. */
const exportedFromSource = node => {
  const source = node.childForFieldName('source')
  return source ? unquote(source.text) : null
}

/** Push a require binding; a call that is not `require(...)` is not an import. */
function recordRequire(collected, source, names, line) {
  if (source) collected.imports.push({ source, names, line, kind: 'require' })
}

const VARIABLE_DECLARATIONS = new Set(['lexical_declaration', 'variable_declaration'])

// `export const a = 1, b = 2` exports each binding by name.
function readVariableDeclarationExports(collected, declaration, from) {
  for (const declarator of declaration.namedChildren) {
    if (declarator.type !== 'variable_declarator') continue
    collected.exportedNodes.add(declarator)
    const name = declarator.childForFieldName('name')
    if (!name) continue
    collected.exportedNames.add(name.text)
    recordExport(collected, { name: name.text, kind: 'variable', line: startLine(declarator), from })
  }
}

// `export function f`, `export class C`, and `export default <named>`.
function readNamedDeclarationExport(collected, declaration, statement, from) {
  const name = declaration.childForFieldName('name')
  if (name) collected.exportedNames.add(name.text)
  recordExport(collected, {
    name: name?.text ?? 'default',
    kind: declaration.type.replace(/_declaration$/, ''),
    line: startLine(statement),
    from
  })
}

function readDeclarationExports(collected, statement, from) {
  const declaration = statement.childForFieldName('declaration')
  if (!declaration) return
  collected.exportedNodes.add(declaration)
  if (VARIABLE_DECLARATIONS.has(declaration.type)) {
    readVariableDeclarationExports(collected, declaration, from)
    return
  }
  readNamedDeclarationExport(collected, declaration, statement, from)
}

// `export { local as public }`; the public name is the alias when present.
function readExportSpecifier(collected, specifier, from) {
  const name = specifier.childForFieldName('name')
  const alias = specifier.childForFieldName('alias')
  const publicName = (alias ?? name)?.text
  if (publicName) {
    collected.exportedNames.add(publicName)
    recordExport(collected, { name: publicName, kind: 'export', line: startLine(specifier), from })
  }
  if (name) collected.exportedNames.add(name.text)
}

function readClauseExports(collected, statement, from) {
  const clause = statement.namedChildren.find(child => child.type === 'export_clause')
  if (!clause) return
  for (const specifier of clause.namedChildren) {
    if (specifier.type === 'export_specifier') readExportSpecifier(collected, specifier, from)
  }
}

function readDefaultExport(collected, statement, from) {
  const hasDeclaration = statement.childForFieldName('declaration') !== null
  const hasClause = statement.namedChildren.some(child => child.type === 'export_clause')
  // `export default <expression>` has neither a declaration nor a clause, so the
  // source text is the only signal that separates it from an empty statement.
  if (hasDeclaration || hasClause || !statement.text.startsWith('export default')) return
  recordExport(collected, { name: 'default', kind: 'default', line: startLine(statement), from })
}

/** Record every export one `export_statement` carries, then walk its declaration. */
function readExportStatement(collected, node, parent, depth) {
  const from = exportedFromSource(node)
  readDeclarationExports(collected, node, from)
  readClauseExports(collected, node, from)
  readDefaultExport(collected, node, from)
  // The declaration still declares a symbol; the export record is not the symbol.
  visitNode(collected, node.childForFieldName('declaration'), parent, depth)
}

/** `const f = () => {}` is a function and `const C = class {}` is a class. */
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function'])

function readDeclaratorSymbol(collected, { name, value, nameNode, parent, exported }, node, depth) {
  if (value && FUNCTION_VALUES.has(value.type)) {
    recordSymbol(collected, { name, kind: 'function', parent, params: parameterNames(value), exported }, node, depth)
    return
  }
  if (value?.type === 'class') {
    recordSymbol(collected, { name, kind: 'class', parent, exported }, node, depth)
    return
  }
  if (nameNode) recordSymbol(collected, { name, kind: 'variable', parent, exported }, node, depth)
}

// Record the function, then descend so nested declarations are still found.
function readFunctionDeclaration(collected, node, parent, depth) {
  const name = declaredName(node) ?? '<anonymous>'
  recordSymbol(
    collected,
    { name, kind: 'function', parent, params: parameterNames(node), exported: collected.exportedNodes.has(node) },
    node,
    depth
  )
  visitNode(collected, node.childForFieldName('body'), name, depth + 1)
}

// Descend at the same depth: methods are class members, not a nested scope.
function readClassDeclaration(collected, node, parent, depth) {
  const name = declaredName(node) ?? '<anonymous>'
  recordSymbol(collected, { name, kind: 'class', parent, exported: collected.exportedNodes.has(node) }, node, depth)
  visitNode(collected, node.childForFieldName('body'), name, depth)
}

// Qualify the method with its class; the body is a new scope.
function readMethodDefinition(collected, node, parent, depth) {
  const name = declaredName(node) ?? '<computed>'
  recordSymbol(
    collected,
    {
      name,
      kind: methodKind(node),
      parent,
      params: parameterNames(node),
      exported: collected.exportedNodes.has(node)
    },
    node,
    depth
  )
  visitNode(collected, node.childForFieldName('body'), qualifiedName(parent, name), depth + 1)
}

// Newer grammar versions emit `field_definition`, older ones
// `public_field_definition`; both are class fields.
function readFieldDefinition(collected, node, parent, depth) {
  const name = declaredName(node)
  if (name) recordSymbol(collected, { name, kind: 'field', parent }, node, depth)
  visitNode(collected, node.childForFieldName('value'), parent, depth)
}

// The enclosing declarator already recorded the symbol; descend only so nested
// declarations are still found.
function readFunctionBody(collected, node, parent, depth) {
  visitNode(collected, node.childForFieldName('body'), parent, depth + 1)
}

// The declarator owns the symbol; it also captures a `require()` binding.
function readVariableDeclarator(collected, node, parent, depth) {
  const nameNode = node.childForFieldName('name')
  const value = node.childForFieldName('value')
  const name = nameNode ? nameNode.text : '<anonymous>'
  const exported = collected.exportedNodes.has(node)

  readDeclaratorSymbol(collected, { name, value, nameNode, parent, exported }, node, depth)
  recordRequire(collected, requiredSource(value), nameNode ? [nameNode.text] : [], startLine(node))
  visitNode(collected, value, name, depth)
}

// A bare `require('x')` that is not bound to a variable.
function readExpressionStatement(collected, node, parent, depth) {
  const expression = node.namedChildren[0]
  recordRequire(collected, requiredSource(expression), [], startLine(node))
  visitNode(collected, expression, parent, depth)
}

/** Node type -> reader. A new node kind is a new entry here, not another branch. */
const NODE_READERS = {
  function_declaration: readFunctionDeclaration,
  generator_function_declaration: readFunctionDeclaration,
  class_declaration: readClassDeclaration,
  method_definition: readMethodDefinition,
  public_field_definition: readFieldDefinition,
  field_definition: readFieldDefinition,
  arrow_function: readFunctionBody,
  function_expression: readFunctionBody,
  function: readFunctionBody,
  generator_function: readFunctionBody,
  variable_declarator: readVariableDeclarator,
  import_statement: (collected, node) => collected.imports.push(readImportStatement(node)),
  export_statement: readExportStatement,
  expression_statement: readExpressionStatement
}

/** Read `node` with its own reader, or recurse into its named children. */
function visitNode(collected, node, parent, depth) {
  if (!node) return
  const reader = NODE_READERS[node.type]
  if (reader) {
    reader(collected, node, parent, depth)
    return
  }
  for (const child of node.namedChildren) visitNode(collected, child, parent, depth)
}

/**
 * The structure of one JavaScript source.
 *
 * A file that will not parse is still mapped: it reports `parseErrors` and
 * whatever symbols the grammar recovered, because a broken file is exactly the
 * one a caller may need to find.
 *
 * @param {object} tree A tree-sitter tree from the plugin-master source reader.
 * @param {string} file The path to record, as the caller spells it.
 * @returns {object} `{ file, language, lines, imports, exports, symbols, parseErrors }`.
 */
export function extractFile(tree, file) {
  const syntax = tree.rootNode
  const collected = { symbols: [], imports: [], exports: [], exportedNodes: new Set(), exportedNames: new Set() }

  visitNode(collected, syntax, null, 0)
  // `export { x }` may export a declaration that never carried `export`.
  for (const symbol of collected.symbols) {
    if (!symbol.exported && collected.exportedNames.has(symbol.name)) symbol.exported = true
  }

  return {
    file,
    language: 'javascript',
    lines: endLine(syntax),
    imports: collected.imports,
    exports: collected.exports,
    symbols: collected.symbols,
    parseErrors: syntax.hasError
  }
}
