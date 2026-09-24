/**
 * What a plugin file says about itself, read from its syntax tree.
 *
 * Two reasons this reads source instead of the loaded definition. A plugin that
 * will not import still has to be described — a file that throws on load is
 * exactly the one an agent needs facts about. And half of what describes a
 * plugin is in no definition at all: the context keys `onLoad` assigns, the
 * events it subscribes to, the shape it emits, and whether a given command
 * refuses in the browser.
 *
 * tree-sitter, not a parser written here, because the engine will read shader
 * source next and that is a second grammar rather than a second reader. Adding
 * a language is one entry in LANGUAGES and one installed grammar package.
 *
 * Node only, and loaded on first use: the browser already holds every plugin
 * definition, so it needs no parser and pays nothing for this file.
 */

/** Grammar packages, by the name a caller asks for. */
const LANGUAGES = {
  javascript: {
    package: 'tree-sitter-javascript',
    wasm: 'tree-sitter-javascript.wasm',
    // Every .js file here is a module, and the parse must agree: a script parse
    // rejects `export default`, which is the one construct every plugin has.
    extensions: ['.js', '.mjs']
  }
}

/** The wasm runtime every grammar loads into. */
const RUNTIME = { package: 'web-tree-sitter', wasm: 'web-tree-sitter.wasm' }

/** The language a file's extension names, or null. */
export function languageOf(file) {
  const lower = String(file).toLowerCase()
  for (const [name, language] of Object.entries(LANGUAGES)) {
    if (language.extensions.some(extension => lower.endsWith(extension))) return name
  }
  return null
}

/** Resolve one wasm file inside an installed package. */
async function wasmPath({ package: name, wasm }) {
  const { createRequire } = await import('node:module')
  return createRequire(import.meta.url).resolve(`${name}/${wasm}`)
}

/**
 * The wasm runtime, initialised once.
 *
 * `Parser.init` sets up the module the grammars load into and refuses a second
 * call, so the promise is kept and shared: a process that describes plugins
 * twice pays for the runtime once.
 */
let runtime = null
function loadRuntime() {
  runtime ??= (async () => {
    const { Parser, Language } = await import('web-tree-sitter')
    const path = await wasmPath(RUNTIME)
    await Parser.init({ locateFile: () => path })
    return { Parser, Language }
  })()
  return runtime
}

/**
 * A reader that parses source, answers plugin facts, and hands the tree to a
 * caller with other questions. Created once per process: compiling a grammar
 * costs about a tenth of a second and a run that describes 81 plugins must pay
 * that once.
 */
export async function makeSourceReader() {
  const { Parser, Language } = await loadRuntime()
  const parser = new Parser()
  const languages = new Map()

  const languageFor = async name => {
    if (!languages.has(name)) {
      languages.set(name, wasmPath(LANGUAGES[name]).then(file => Language.load(file)))
    }
    return languages.get(name)
  }

  /**
   * Parse one file and hand its tree to `read`, then release the tree.
   *
   * `facts` asks a plugin's questions of a tree; a caller with other questions
   * — codemap reads declarations, imports and exports — needs the tree itself.
   * Both share this one parser and grammar cache, so no second grammar-loading
   * path appears. `read` must finish with the tree before it returns.
   */
  const withTree = async (file, source, read) => {
    const name = languageOf(file)
    if (name === null) return null
    parser.setLanguage(await languageFor(name))
    const tree = parser.parse(source)
    try { return read(tree) } finally { tree.delete() }
  }

  return {
    withTree,
    /**
     * Facts about one plugin source, or null when no grammar matches its name.
     *
     * @param {string} file The path, read only for its extension.
     * @param {string} source The file's text.
     * @returns {Promise<object|null>} The facts.
     */
    async facts(file, source) {
      return withTree(file, source, tree => tree.rootNode.hasError ? null : readFacts(tree))
    }
  }
}

// ------------------------------------------------------------------- the tree

/** The object behind `export default`, or null. */
function defaultObject(tree) {
  for (const statement of tree.rootNode.namedChildren) {
    if (statement.type !== 'export_statement') continue
    const object = statement.namedChildren.find(child => child.type === 'object')
    if (object) return object
  }
  return null
}

/**
 * A property's name.
 *
 * `{ entity, collector: taker }` spells the first key as shorthand, which is
 * its own node type and carries no key field — so a reader that only looked for
 * `key` would report a payload missing the fields it does send.
 */
const nameOf = node => node?.childForFieldName?.('key')?.text
  ?? node?.childForFieldName?.('name')?.text
  ?? (node?.type?.startsWith('shorthand_property_identifier') ? node.text : undefined)

/** An object literal's own keys, each mapped to its value node. */
function keys(object) {
  const found = new Map()
  for (const child of object.namedChildren) {
    const name = nameOf(child)
    if (name !== undefined) found.set(name, child.childForFieldName?.('value') ?? child)
  }
  return found
}

/**
 * A string literal's value, with its escapes decoded.
 *
 * tree-sitter reports a literal's source text, so `'the engine\'s CLI'` arrives
 * with the backslash in it. Decoding is the whole difference from a regex read:
 * the grammar already knows where the string ends.
 */
export const stringValue = text => String(text)
  .replace(/^['"`]|['"`]$/g, '')
  .replace(/\\(["'`\\/])/g, '$1')
  .replace(/\\n/g, '\n')
  .replace(/\\t/g, '\t')

/** Every top-level `const NAME = '...'`, so a field written as `name: NAME` reads. */
function constants(tree) {
  const found = new Map()
  for (const node of tree.rootNode.descendantsOfType('variable_declarator')) {
    const name = node.childForFieldName('name')?.text
    const value = node.childForFieldName('value')
    if (name && value?.type === 'string') found.set(name, stringValue(value.text))
  }
  return found
}

/**
 * One declared value, as text.
 *
 * A description is often several literals joined, because it does not fit one
 * line, so a read that stopped at the first literal would report half of it.
 */
function textOf(node, names) {
  if (node === null || node === undefined) return undefined
  if (node.type === 'string' || node.type === 'template_string') return stringValue(node.text)
  if (node.type === 'identifier') return names.get(node.text)
  if (node.type === 'binary_expression') {
    const left = textOf(node.childForFieldName('left'), names)
    const right = textOf(node.childForFieldName('right'), names)
    return typeof left === 'string' && typeof right === 'string' ? left + right : undefined
  }
  if (node.type === 'parenthesized_expression') return textOf(node.namedChildren[0], names)
  return undefined
}

/** Every string in an array literal. */
const stringsIn = node => node?.type === 'array'
  ? node.namedChildren.filter(child => child.type === 'string').map(child => stringValue(child.text))
  : []

/** The method or function behind one key, whichever syntax declared it. */
const bodyOf = node => node?.type === 'method_definition' ? node.childForFieldName('body')
  : node?.type === 'arrow_function' || node?.type === 'function_expression' || node?.type === 'function' || node?.type === 'function_declaration'
    ? node.childForFieldName('body') ?? node
    : node?.type === 'pair' ? bodyOf(node.childForFieldName('value'))
      : undefined

/** The object literal behind one `commands: [...]` entry, or undefined. */
function commandEntries(object, point = 'commands') {
  const value = object.get(point)
  if (value?.type !== 'array') return []
  return value.namedChildren.filter(child => child.type === 'object')
}

/** Facts read straight out of the syntax tree. */
function readFacts(tree) {
  const object = defaultObject(tree)
  if (object === null) return null
  const names = constants(tree)
  const declared = keys(object)
  const declarations = new Map()
  for (const statement of tree.rootNode.namedChildren) {
    if (statement.type === 'function_declaration') declarations.set(statement.childForFieldName('name')?.text, statement)
    for (const child of statement.namedChildren) {
      if (child.type === 'variable_declarator') declarations.set(child.childForFieldName('name')?.text, child.childForFieldName('value'))
    }
  }
  const resolve = node => node?.type === 'identifier' ? declarations.get(node.text) ?? node : node

  const facts = {
    name: textOf(declared.get('name'), names),
    category: textOf(declared.get('category'), names),
    about: textOf(declared.get('about'), names) || null,
    lifecycle: textOf(declared.get('lifecycle'), names) || 'legacy'
  }
  for (const field of ['provides', 'requires', 'needs']) {
    const value = stringsIn(declared.get(field))
    if (value.length) facts[field] = value
  }

  facts.contributes = {}
  for (const point of ['panels', 'tools', 'commands', 'fields', 'importers', 'systems', 'menus']) {
    const value = declared.get(point)
    if (value?.type === 'array' && value.namedChildren.length) facts.contributes[point] = value.namedChildren.length
  }

  // What a command is called, the key it answers to, and whether its body
  // refuses where there is no host — the claim every headless-only plugin makes
  // about itself in its guide.
  const readCommand = entry => {
    const properties = keys(entry)
    const run = resolve(properties.get('run'))
    const body = bodyOf(run)
    const parameters = run?.childForFieldName('parameters')?.namedChildren
      ?? (run?.childForFieldName('parameter') ? [run.childForFieldName('parameter')] : null)
    const source = body?.text ?? ''
    return {
      id: textOf(properties.get('id'), names),
      label: textOf(properties.get('label'), names),
      arguments: parameters ? parameters.slice(1).map(parameter => parameter.text).join(', ') : null,
      inputSchema: resolve(properties.get('inputSchema'))?.text ?? null,
      // A shortcut belongs in the list: an agent that cannot see the key
      // declared will bind the same chord to something else.
      key: textOf(properties.get('key'), names) || null,
      refusesWithoutHost: /!\s*context\.host\b/.test(source) || /!\s*context\?\.host\b/.test(source)
    }
  }
  facts.commands = commandEntries(declared).map(readCommand).filter(command => command.id)
  facts.menus = commandEntries(declared, 'menus').map(readCommand).filter(command => command.id)

  facts.systems = (() => {
    const value = declared.get('systems')
    return value?.type === 'array'
      ? value.namedChildren.filter(child => child.type === 'object')
        .map(entry => textOf(keys(entry).get('phase'), names)).filter(Boolean)
      : []
  })()

  const bus = busCalls(tree)
  facts.context = bus.context
  facts.listens = bus.listens
  facts.emits = bus.emits
  return facts
}

/**
 * Every service a plugin puts on `context`, every event it listens for, and
 * every event it emits with the payload keys it sends.
 *
 * Read everywhere in the file, not only in `onLoad`: a plugin may put a service
 * on context while loading and emit its events from a system or a command. The
 * three answers share the walk and nothing else, so they are read together and
 * returned as one value.
 */
function busCalls(tree) {
  const assigned = new Set(), listened = new Set(), emitted = new Map()
  for (const node of tree.rootNode.descendantsOfType('assignment_expression')) {
    const left = node.childForFieldName('left')
    if (left?.type === 'member_expression' && left.childForFieldName('object')?.text === 'context') {
      const property = left.childForFieldName('property')
      if (property) assigned.add(property.text)
    }
  }
  for (const node of tree.rootNode.descendantsOfType('call_expression')) {
    const callee = node.childForFieldName('function')
    if (callee?.type !== 'member_expression') continue
    if (callee.childForFieldName('object')?.text !== 'context.bus') continue
    const event = node.childForFieldName('arguments')?.namedChildren?.[0]
    if (event?.type !== 'string') continue
    const said = stringValue(event.text)
    const verb = callee.childForFieldName('property')?.text
    if (verb === 'on') listened.add(said)
    if (verb === 'emit') {
      const payload = node.childForFieldName('arguments')?.namedChildren?.[1]
      emitted.set(said, payload?.type === 'object'
        ? payload.namedChildren.map(nameOf).filter(Boolean)
        : [])
    }
  }
  return {
    context: [...assigned].sort(),
    listens: [...listened].sort(),
    emits: [...emitted].map(([event, payloadKeys]) => ({ event, payloadKeys }))
  }
}
