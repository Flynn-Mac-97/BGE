/**
 * Codemap: the structural views over this checkout's JavaScript.
 *
 * The parse is the plugin-master source reader, so the extractor is held to the
 * shape the outside tool answered: declarations, imports, exports and the
 * dependency edges between files. The last two tests hold the claims an agent
 * depends on: the shipped verb answers, and the codemap code reads nothing
 * outside this checkout.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { CHECKOUT, FIXTURE, temporaryProject } from './fixture-project.mjs'
import { contextFromDisk } from '../engine/agent-workspace-node.mjs'
import { makeSourceReader } from '../plugins/builtin/plugin-master/source-facts.js'
import { extractFile } from '../plugins/builtin/codemap/extract.js'
import { buildCodemap } from '../plugins/builtin/codemap/scan.js'
import { formatMarkdown } from '../plugins/builtin/codemap/format.js'
import { formatSystem } from '../plugins/builtin/codemap/system.js'
import { formatDeps } from '../plugins/builtin/codemap/deps.js'

const reader = await makeSourceReader()
const extract = (source, file = 'sample.js') => reader.withTree(file, source, tree => extractFile(tree, file))

const SAMPLE = `
  import { helper } from './helper.js';
  import defaultThing, { other as alias } from './mod.js';

  export const VERSION = '1.0.0';

  export function add(a, b) {
    return a + b;
  }

  export class Widget {
    constructor(name) {
      this.name = name;
    }
    get label() {
      return this.name;
    }
    render() {
      return this.name;
    }
  }

  const double = (x) => x * 2;
  class Inner {}
  export { Inner };
`

const find = (map, name, kind) => map.symbols.find(symbol => symbol.name === name && symbol.kind === kind)

test('extracts declarations, imports and exports from one file', async () => {
  const map = await extract(SAMPLE)

  for (const [name, kind] of [
    ['VERSION', 'variable'],
    ['add', 'function'],
    ['Widget', 'class'],
    ['constructor', 'method'],
    ['label', 'getter'],
    ['render', 'method'],
    ['double', 'function'],
    ['Inner', 'class']
  ]) {
    assert.ok(find(map, name, kind), `${kind} ${name}`)
  }

  assert.deepEqual(find(map, 'add', 'function').params, ['a', 'b'])
  assert.equal(find(map, 'add', 'function').exported, true)
  assert.equal(find(map, 'Inner', 'class').exported, true)
  assert.equal(find(map, 'double', 'function').exported, undefined)
  assert.equal(find(map, 'label', 'getter').parent, 'Widget')
  assert.equal(map.imports.length, 2)
  assert.equal(map.imports[0].source, './helper.js')
  assert.deepEqual(map.imports[1].names, ['defaultThing', 'other as alias'])
})

test('maps a CommonJS require and a file that will not parse', async () => {
  const required = await extract("const legacy = require('./legacy.cjs');")
  assert.equal(required.imports.length, 1)
  assert.equal(required.imports[0].source, './legacy.cjs')
  assert.equal(required.imports[0].kind, 'require')
  assert.deepEqual(required.imports[0].names, ['legacy'])

  // A file that will not parse is still a map: it reports the error rather
  // than throwing, because the broken file is the one a caller may need to find.
  const broken = await extract('function broken( {')
  assert.equal(broken.parseErrors, true)
  assert.ok(Array.isArray(broken.symbols))
})

test('a re-export and an extensionless import both resolve to a dependency edge', async () => {
  const root = await temporaryProject({
    'src/thing.js': 'export const thing = 1;\n',
    'src/index.js': "export { thing } from './thing.js';\n",
    'src/other.js': "import './thing';\n"
  })
  try {
    const map = await buildCodemap(root, reader)
    const byFile = Object.fromEntries(map.files.map(file => [file.file, file]))
    assert.deepEqual(byFile['src/index.js'].dependsOn, ['src/thing.js'])
    assert.deepEqual(byFile['src/other.js'].dependsOn, ['src/thing.js'])
    assert.equal(byFile['src/index.js'].exports[0].resolved, 'src/thing.js')
    assert.equal(byFile['src/index.js'].dependsOn.includes('src/index.js'), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

/** The workspace the three report views share. */
async function reportWorkspace() {
  return temporaryProject({
    'src/util.js': 'export function helper(value) { return value }\nexport class Box { open() { return true } }\n',
    'src/main.js': "import { helper } from './util.js';\nexport function run(value) {\n  function inner() { return value }\n  return helper(inner())\n}\n",
    'src/constants.js': 'export const DEFAULT_LIMIT = 10;\nconst internalLimit = 5;\n'
  })
}

test('the system map groups modules by layer and marks the exported constants', async () => {
  const root = await reportWorkspace()
  try {
    const output = formatSystem(await buildCodemap(root, reader))
    assert.match(output, /system map/)
    assert.match(output, /┌─ src\/main\.js /)
    assert.match(output, /F run\(value\) export/)
    assert.match(output, /M Box\.open\(\)/)
    assert.match(output, /→ src\/util\.js/)
    assert.match(output, /V DEFAULT_LIMIT export/)
    assert.doesNotMatch(output, /internalLimit/)
    // The dependent module sits in a higher layer, above the module it uses.
    assert.ok(output.indexOf('src/main.js') < output.indexOf('src/util.js'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('the dependency tree roots at entry points and labels repeats and depth cuts', async () => {
  const root = await temporaryProject({
    'app.js': "import './a.js';\nimport './b.js';\n",
    'a.js': "import './shared.js';\nexport function aFn() {}\n",
    'b.js': "import './shared.js';\n",
    'shared.js': "import './a.js';\nexport class Shared {}\nexport const SHARED_LIMIT = 1;\n"
  })
  try {
    const codemap = await buildCodemap(root, reader)
    const full = formatDeps(codemap)
    assert.match(full, /└── app\.js/)
    assert.match(full, /a\.js {2}\(already seen\)/)

    const shallow = formatDeps(codemap, { maxDepth: 1 })
    assert.match(shallow, /a\.js {2}\(depth limit\)/)
    assert.doesNotMatch(shallow, /shared\.js/)

    const symbols = formatDeps(codemap, { includeSymbols: true })
    assert.match(symbols, /· F aFn\(\)/)
    assert.match(symbols, /· C Shared/)
    assert.match(symbols, /· V SHARED_LIMIT export/)

    const focused = formatDeps(codemap, { focusModule: 'a.js' })
    assert.match(focused, /└── a\.js/)
    assert.doesNotMatch(focused, /app\.js/)
    assert.match(formatDeps(codemap, { focusModule: 'missing.js' }), /no module matched/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('the markdown report carries every file and its symbols', async () => {
  const root = await reportWorkspace()
  try {
    const output = formatMarkdown(await buildCodemap(root, reader))
    assert.match(output, /# Codemap/)
    assert.match(output, /\| `src\/main\.js` \| \d+ \| 1 \| 1 \|/)
    assert.match(output, /- `function` \*\*run\*\*\(value\) — line \d+ _\(exported\)_/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('the CLI verb answers one file structure for this checkout', () => {
  const output = execFileSync(
    process.execPath,
    ['bin/engine.mjs', '--headless', 'run', 'codemap.file', JSON.stringify({ file: 'plugins/builtin/codemap/symbols.js' })],
    { cwd: CHECKOUT, encoding: 'utf8' }
  )
  const map = JSON.parse(output)
  assert.equal(map.stats.files, 1)
  assert.ok(map.files[0].symbols.some(symbol => symbol.name === 'moduleSymbolLines'))
})

test('a packet for engine code teaches that codemap exists', async () => {
  const packet = await contextFromDisk(CHECKOUT, { files: ['engine/world.js'] }, FIXTURE)
  assert.ok(packet.nodes.some(node => node.id === 'plugin-engine-codemap'), packet.nodes.map(node => node.id).join(', '))
  assert.match(packet.text, /codemap\.scan/)
  assert.match(packet.text, /codemap\.deps/)
})

/** Whether this node can restrict filesystem reads. */
function permissionSupported() {
  try {
    execFileSync(process.execPath, ['--permission', '-e', '0'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('the codemap code reads nothing outside this checkout', async (context) => {
  const sources = ['codemap.js', 'codemap/extract.js', 'codemap/scan.js', 'codemap/format.js', 'codemap/system.js', 'codemap/deps.js', 'codemap/symbols.js']
  for (const file of sources) {
    const text = await fs.readFile(path.join(CHECKOUT, 'plugins/builtin', file), 'utf8')
    assert.doesNotMatch(text, /Skill exploration|Codemap_new/, file)
  }

  if (!permissionSupported()) return context.skip('this node cannot restrict reads with --permission')

  // With reads allowed only inside this checkout, a whole-project scan still
  // completes. A read of the outside checkout would be denied and fail the
  // process, so success is the proof.
  const facts = pathToFileURL(path.join(CHECKOUT, 'plugins/builtin/plugin-master/source-facts.js')).href
  const scan = pathToFileURL(path.join(CHECKOUT, 'plugins/builtin/codemap/scan.js')).href
  const script = [
    `const { makeSourceReader } = await import(${JSON.stringify(facts)})`,
    `const { buildCodemap } = await import(${JSON.stringify(scan)})`,
    `const map = await buildCodemap(${JSON.stringify(CHECKOUT)}, await makeSourceReader())`,
    `console.log(JSON.stringify({ files: map.stats.files, parseErrors: map.stats.parseErrors }))`
  ].join('\n')
  const output = execFileSync(
    process.execPath,
    ['--permission', `--allow-fs-read=${CHECKOUT}`, '--input-type=module', '-e', script],
    { cwd: CHECKOUT, encoding: 'utf8' }
  )
  const result = JSON.parse(output)
  assert.ok(result.files > 100, `mapped ${result.files} files`)
  assert.equal(result.parseErrors, 0)
})
