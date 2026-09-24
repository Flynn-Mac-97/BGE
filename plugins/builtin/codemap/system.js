/**
 * The system map: modules as boxes, grouped by dependency depth.
 *
 * Terminal-native, so it prints as plain text and box-drawing characters only.
 * A module's significant symbols sit above a divider; its outgoing dependencies
 * sit below it.
 */
import { moduleSymbolLines } from './symbols.js'

// Separates a box's symbol compartment from its dependency compartment. A
// sentinel can never collide with a real content line.
const DIVIDER = Symbol('system-divider')

// Cap the shared box width so one long path cannot push the diagram past a
// typical terminal; `padToWidth` ellipsizes whatever exceeds it.
const MAX_BOX_WIDTH = 66

function dependencyLines(file) {
  return (file.dependsOn ?? []).map(dependency => `→ ${dependency}`)
}

/** Symbols on top, dependencies below, honouring `includeLocals`. */
function fileContent(file, includeLocals) {
  const content = moduleSymbolLines(file, includeLocals)
  const dependencies = dependencyLines(file)
  if (dependencies.length) {
    if (content.length) content.push(DIVIDER)
    content.push(...dependencies)
  }
  return content
}

/**
 * The longest chain of dependencies below `file`, so dependents sort above
 * leaves. `visiting` breaks an import cycle instead of recursing for ever.
 */
function dependencyDepth(file, byPath, depths, visiting) {
  if (depths.has(file.file)) return depths.get(file.file)
  if (visiting.has(file.file)) return 0
  visiting.add(file.file)

  let depth = 0
  for (const dependency of file.dependsOn ?? []) {
    const target = byPath.get(dependency)
    if (target) depth = Math.max(depth, 1 + dependencyDepth(target, byPath, depths, visiting))
  }

  visiting.delete(file.file)
  depths.set(file.file, depth)
  return depth
}

/** Group files by dependency depth, deepest (most depended-upon) group last. */
function groupFilesByDepth(files) {
  const byPath = new Map(files.map(file => [file.file, file]))
  const depths = new Map()
  const groups = new Map()

  for (const file of files) {
    const depth = dependencyDepth(file, byPath, depths, new Set())
    if (!groups.has(depth)) groups.set(depth, [])
    groups.get(depth).push(file)
  }

  return [...groups.entries()].sort((left, right) => right[0] - left[0])
}

function padToWidth(text, width) {
  if (text.length > width) return `${text.slice(0, width - 1)}…`
  return text.padEnd(width)
}

/** Frame a box: title in the top border, one padded row per content line. */
function box(title, contentLines, width) {
  const shownTitle = title.length > width - 3 ? `${title.slice(0, width - 4)}…` : title
  const rule = '─'.repeat(Math.max(0, width - shownTitle.length - 3))
  const lines = [`┌─ ${shownTitle} ${rule}┐`]

  for (const content of contentLines) {
    if (content === DIVIDER) {
      lines.push(`├${'─'.repeat(width)}┤`)
      continue
    }
    lines.push(`│${padToWidth(content, width)}│`)
  }

  lines.push(`└${'─'.repeat(width)}┘`)
  return lines
}

/** One width for every box keeps the columns aligned like a class diagram. */
function boxWidth(boxes) {
  let width = 0
  for (const one of boxes) {
    width = Math.max(width, one.title.length + 3)
    for (const content of one.contentLines) {
      if (content !== DIVIDER) width = Math.max(width, content.length)
    }
  }
  return Math.min(width, MAX_BOX_WIDTH)
}

/**
 * UML-like system map: modules as boxes carrying their significant symbols,
 * grouped by dependency depth, with each module's outgoing dependencies listed
 * inside its box.
 */
export function formatSystem(codemap, { includeLocals = false } = {}) {
  const sections = groupFilesByDepth(codemap.files).map(([depth, files]) => ({
    depth,
    boxes: files.map(file => ({ title: file.file, contentLines: fileContent(file, includeLocals) }))
  }))
  const width = boxWidth(sections.flatMap(section => section.boxes))
  const stats = codemap.stats ?? {}

  const lines = [
    `system map — ${codemap.root}`,
    `files ${stats.files ?? codemap.files.length}  symbols ${stats.symbols ?? '?'}  imports ${stats.imports ?? '?'}  exports ${stats.exports ?? '?'}`,
    'C class  F function  M method  V variable  export = public  → depends on',
    'layer 0 = no local dependencies; higher layers depend on lower ones',
    ''
  ]
  for (const section of sections) {
    lines.push(`── layer ${section.depth} ${'─'.repeat(40)}`, '')
    for (const one of section.boxes) lines.push(...box(one.title, one.contentLines, width), '')
  }
  return lines.join('\n')
}
