/**
 * The symbol projections the report views share.
 *
 * Four views show the same symbols at different sizes: the tree and markdown
 * lists show every visible symbol, while the system and dependency views show
 * only the ones that give a module its shape. One projection here keeps the
 * four from drifting apart.
 */

/** `Parent.name` for a class member, or just `name` at the top level. */
export const qualifiedSymbolName = symbol =>
  symbol.parent ? `${symbol.parent}.${symbol.name}` : symbol.name

/** `(a, b)` for a function or method, or nothing for a symbol that takes none. */
export const symbolSignature = symbol => (symbol.params ? `(${symbol.params.join(', ')})` : '')

/** Top-level declarations and class members; nested locals only when asked. */
export const visibleSymbols = (file, includeLocals) =>
  includeLocals ? file.symbols : file.symbols.filter(symbol => !symbol.depth)

// Kinds that always give a module its shape; fields stay out.
const SHAPE_KINDS = new Set(['class', 'function', 'method'])

// An exported variable is part of a module's public surface; an unexported one
// is a local detail the map should not flood.
const isShapeSymbol = symbol =>
  SHAPE_KINDS.has(symbol.kind) || (symbol.kind === 'variable' && symbol.exported === true)

/** The symbols a module-level view shows, in declaration order. */
const shapeSymbols = (file, includeLocals) =>
  visibleSymbols(file, includeLocals).filter(isShapeSymbol)

// One-letter tags keep symbol lines scannable; each view's header carries the legend.
const KIND_TAGS = { class: 'C', function: 'F', method: 'M', variable: 'V' }

/** One symbol line for the system and dependency views. */
function moduleSymbolLine(symbol) {
  const tag = KIND_TAGS[symbol.kind]
  return `${tag} ${qualifiedSymbolName(symbol)}${symbolSignature(symbol)}${symbol.exported ? ' export' : ''}`
}

/** Every symbol line a module-level view shows. */
export const moduleSymbolLines = (file, includeLocals) =>
  shapeSymbols(file, includeLocals).map(moduleSymbolLine)
