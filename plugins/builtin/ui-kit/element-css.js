/**
 * UI Kit element CSS: one element's rules, kept in the game's `theme.css`
 * between two comment marks, so a game keeps the elements it uses and nothing
 * else. Pure text in, text out.
 */

const startMark = id => `/* ui-kit:${id} */`
const endMark = id => `/* /ui-kit:${id} */`

/** The rules saved for one element in the theme text, or '' when it has none. */
export function blockOf(themeCss, id) {
  const start = themeCss.indexOf(startMark(id))
  const end = themeCss.indexOf(endMark(id))
  if (start === -1 || end < start) return ''
  return themeCss.slice(start + startMark(id).length, end).trim()
}

/** The theme text with one element's block replaced, added, or (for empty rules) removed. */
export function withBlock(themeCss, id, rules) {
  const start = themeCss.indexOf(startMark(id))
  const end = themeCss.indexOf(endMark(id))
  const hasBlock = start !== -1 && end > start
  const before = hasBlock ? themeCss.slice(0, start) : themeCss
  const after = hasBlock ? themeCss.slice(end + endMark(id).length) : ''
  const block = rules.trim() ? `${startMark(id)}\n${rules.trim()}\n${endMark(id)}` : ''
  return `${before.trimEnd()}\n\n${block}\n${after.trimStart()}`.trim() + '\n'
}

/** One single-line rule `a { b: c; d: e; }` written over several lines. */
function expandedRule(line) {
  const open = line.indexOf('{')
  const declarations = line
    .slice(open + 1, line.lastIndexOf('}'))
    .split(';')
    .map(declaration => declaration.trim())
    .filter(Boolean)
  return `${line.slice(0, open).trim()} {\n${declarations.map(declaration => `  ${declaration};`).join('\n')}\n}`
}

/** Every single-line rule of the kit's sheet that styles one of these classes, written out to edit. */
export function rulesOf(baseCss, classes) {
  const mentions = line => classes.some(name => new RegExp(`\\.${name}(?![\\w-])`).test(line.split('{')[0]))
  return baseCss
    .split('\n')
    .filter(line => line.includes('{') && line.trimEnd().endsWith('}') && mentions(line))
    .map(expandedRule)
    .join('\n')
}
