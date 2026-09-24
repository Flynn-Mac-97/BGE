/**
 * The dependency tree: modules as a rooted forest, arrows pointing at
 * dependencies. Terminal-native; a cycle or a repeat is labelled rather than
 * recursed.
 */
import { moduleSymbolLines } from './symbols.js'

// Repeats are labelled, never recursed: `seen` is shared across the whole
// render, so a diamond or a cycle expands once and each later arrival is
// marked. The depth cut uses a different label because "reached again" and "cut
// short" differ.
const ALREADY_SEEN = '(already seen)'
const DEPTH_LIMIT = '(depth limit)'

const dependenciesOf = file => file.dependsOn ?? []

/** How many modules point at each module; drives which modules are entry points. */
function countDependents(files) {
  const dependents = new Map(files.map(file => [file.file, 0]))
  for (const file of files) {
    for (const dependency of dependenciesOf(file)) {
      if (dependents.has(dependency)) dependents.set(dependency, dependents.get(dependency) + 1)
    }
  }
  return dependents
}

/**
 * One node per module. `seen`, `depth` and the options sit on the caller's
 * context, so the traversal carries no hidden state and a repeated module ends
 * the walk.
 */
function buildDependencyNode(fileKey, context) {
  const file = context.byPath.get(fileKey)
  const node = {
    file: fileKey,
    note: '',
    symbols: context.includeSymbols ? moduleSymbolLines(file, context.includeLocals) : [],
    children: []
  }

  if (context.seen.has(fileKey)) {
    node.note = ALREADY_SEEN
    return node
  }
  context.seen.add(fileKey)

  const dependencies = dependenciesOf(file)
  if (context.depth >= context.maxDepth) {
    if (dependencies.length) node.note = DEPTH_LIMIT
    return node
  }

  node.children = dependencies.map(dependency => buildDependencyNode(dependency, { ...context, depth: context.depth + 1 }))
  return node
}

/**
 * Entry points are modules nothing depends on. If none exist — a graph that is
 * entirely cyclic — every module becomes a root so the view still shows them.
 */
function buildDependencyForest(files, context) {
  const orderedKeys = files.map(file => file.file).sort()
  const dependents = countDependents(files)
  const entryPoints = orderedKeys.filter(fileKey => dependents.get(fileKey) === 0)
  return (entryPoints.length ? entryPoints : orderedKeys).map(fileKey => buildDependencyNode(fileKey, context))
}

function renderDependencyNode(node, prefix, isLast, lines) {
  const connector = isLast ? '└── ' : '├── '
  lines.push(`${prefix}${connector}${node.file}${node.note ? `  ${node.note}` : ''}`)

  const childPrefix = `${prefix}${isLast ? '    ' : '│   '}`
  // Symbols are leaves and use a bullet so they never read as dependency edges.
  for (const symbolLine of node.symbols) lines.push(`${childPrefix}· ${symbolLine}`)
  node.children.forEach((child, index) => {
    renderDependencyNode(child, childPrefix, index === node.children.length - 1, lines)
  })
}

// Module keys are posix-relative; accept a Windows-style or `./`-prefixed
// spelling from the shell, then match exactly so focus stays predictable.
const normalizeModuleKey = fileKey => fileKey.replaceAll('\\', '/').replace(/^\.\//, '')

/**
 * Dependency tree: every module under its entry points, with the modules it
 * depends on as children. `maxDepth` cuts expansion, `includeSymbols` adds each
 * module's classes, functions and exported constants, and `focusModule`
 * re-roots the tree. Deterministic; a repeated module is labelled.
 */
export function formatDeps(
  codemap,
  { includeLocals = false, includeSymbols = false, maxDepth = Infinity, focusModule = null } = {}
) {
  const byPath = new Map(codemap.files.map(file => [file.file, file]))
  const focus = focusModule ? normalizeModuleKey(focusModule) : null
  if (focus && !byPath.has(focus)) {
    return [`dependency tree — ${codemap.root}`, `no module matched --root "${focusModule}"`, ''].join('\n')
  }

  const context = { byPath, seen: new Set(), includeLocals, includeSymbols, maxDepth, depth: 0 }
  const forest = focus ? [buildDependencyNode(focus, context)] : buildDependencyForest(codemap.files, context)
  const edgeCount = codemap.files.reduce((total, file) => total + dependenciesOf(file).length, 0)
  const stats = codemap.stats ?? {}
  const lines = [
    `dependency tree — ${codemap.root}`,
    `modules ${stats.files ?? codemap.files.length}  edges ${edgeCount}  depth ${maxDepth === Infinity ? 'full' : maxDepth}  symbols ${includeSymbols ? 'shown' : 'hidden'}`,
    'roots are entry points (modules nothing depends on); a repeat is labelled, not recursed',
    '',
    '.'
  ]
  // A virtual `.` root keeps the connector logic uniform for one or many roots.
  forest.forEach((node, index) => renderDependencyNode(node, '', index === forest.length - 1, lines))
  return lines.join('\n')
}
