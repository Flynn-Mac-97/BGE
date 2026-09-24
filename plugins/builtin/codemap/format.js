/**
 * The markdown report.
 *
 * `codemap.scan` returns the map itself as JSON; this reads the same records
 * and frames them for a reader.
 */
import { qualifiedSymbolName, symbolSignature, visibleSymbols } from './symbols.js'

/** One (file, visible symbols) pair per file. */
function* filesWithSymbols(codemap, includeLocals) {
  for (const file of codemap.files) yield { file, symbols: visibleSymbols(file, includeLocals) }
}

const markdownSymbolLine = symbol =>
  `- \`${symbol.kind}\` **${qualifiedSymbolName(symbol)}**${symbolSignature(symbol)} — line ${symbol.line}${symbol.exported ? ' _(exported)_' : ''}`

function markdownFileLines(file, symbols) {
  if (!symbols.length) return []
  const lines = [`### \`${file.file}\``, '']
  for (const symbol of symbols) lines.push(markdownSymbolLine(symbol))
  lines.push('')
  return lines
}

/** Markdown report; the summary table counts every symbol, the section honours `includeLocals`. */
export function formatMarkdown(codemap, { includeLocals = false } = {}) {
  const lines = [
    '# Codemap',
    '',
    `Root: \`${codemap.root}\`  `,
    `Generated: ${codemap.generatedAt}`,
    '',
    '| File | Symbols | Imports | Exports |',
    '| --- | ---: | ---: | ---: |'
  ]
  for (const file of codemap.files) {
    lines.push(`| \`${file.file}\` | ${file.symbols.length} | ${file.imports.length} | ${file.exports.length} |`)
  }
  lines.push('', '## Symbols', '')
  for (const { file, symbols } of filesWithSymbols(codemap, includeLocals)) lines.push(...markdownFileLines(file, symbols))
  return lines.join('\n')
}
