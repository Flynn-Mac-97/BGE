/**
 * Every process the engine or a tool starts must state `windowsHide`.
 *
 * Windows passes the flag to the child as STARTUPINFO's SW_HIDE. A process
 * without it flashes a console window on every spawn and kill; a browser meant
 * to be seen obeys it and renders with nothing on screen. Nothing in a test run
 * sees either outcome, so the option is a defect that ships silently. This
 * check reads the source instead: one place that decides, and a failing line
 * that names the call to fix.
 *
 * `windowsHide: false` is allowed only in the files listed below, which open
 * the window a person looks at.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKOUT = fileURLToPath(new URL('..', import.meta.url))
const DIRECTORIES = ['bin', 'engine', 'plugins', 'tools']
const EXTRA_FILES = ['vite.config.js']
/** Files whose spawned process owns a window a person must see. */
const MAY_SHOW_A_WINDOW = new Set(['engine/open-page.mjs'])

/** The call names that start an operating-system process. */
const PROCESS_CALL = /(?<![\w.])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/g

/** Every `.mjs`, `.js` and `.cjs` file under a directory. */
function sourceFiles(directory) {
  const found = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) found.push(full)
  }
  return found
}

/** One call's text, from its name to the parenthesis that closes it. */
function callText(source, start) {
  let depth = 0
  for (let at = source.indexOf('(', start); at < source.length; at++) {
    if (source[at] === '(') depth += 1
    else if (source[at] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, at + 1)
    }
  }
  return source.slice(start)
}

/** Calls in one file that start a process without saying what its window does. */
function exposedCalls(file) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('child_process')) return []
  const relative = path.relative(CHECKOUT, file).split(path.sep).join('/')
  const mayShow = MAY_SHOW_A_WINDOW.has(relative)
  const exposed = []
  PROCESS_CALL.lastIndex = 0
  let match
  while ((match = PROCESS_CALL.exec(source)) !== null) {
    const text = callText(source, match.index)
    if (/windowsHide\s*:\s*true/.test(text)) continue
    if (mayShow && /windowsHide\s*:\s*false/.test(text)) continue
    const line = source.slice(0, match.index).split('\n').length
    exposed.push(`${relative}:${line}  ${text.split('\n')[0].trim().slice(0, 90)}`)
  }
  return exposed
}

test('every engine and tool process says what its window does', () => {
  const files = []
  for (const directory of DIRECTORIES) {
    const base = path.join(CHECKOUT, directory)
    if (fs.existsSync(base)) files.push(...sourceFiles(base))
  }
  files.push(...EXTRA_FILES.map(file => path.join(CHECKOUT, file)).filter(fs.existsSync))

  const exposed = files.flatMap(exposedCalls)
  assert.deepEqual(exposed, [], `these calls do not say whether their window shows:\n${exposed.join('\n')}`)
})
