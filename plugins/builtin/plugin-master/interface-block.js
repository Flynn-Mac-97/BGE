/**
 * A plugin's interface as a block of text an agent reads before its first call.
 *
 * The guide holds authored rules. The generated interface is stored beside it,
 * with a hash of the source and generator so readers can check freshness.
 *
 * One block per plugin, printed above the guide, because an agent looks up a
 * command id or a payload key far more often than it reads reasoning.
 */

/** Row labels, and the order they print in. Absent rows are left out. */
const ROWS = ['provides', 'requires', 'needs']

/** What an `unread` row says: the table is real, only this listing cannot show it. */
export const UNREAD = 'not an array written in the plugin file, so not listed here; read the source'

/** Contribution points other than commands, which get a row of their own. */
const OTHER_POINTS = ['panels', 'tools', 'fields', 'importers', 'menus']

/** `2 panels`, `1 menu`. */
const plural = { panels: 'panels', tools: 'tools', fields: 'fields', importers: 'importers', menus: 'menus' }
const counted = (point, count) => `${count} ${count === 1 ? plural[point].replace(/s$/, '') : plural[point]}`

/**
 * One command as one line: the id an agent calls, then what it does.
 *
 * The key a command answers to is read from the declaration, because a shortcut
 * an agent cannot see is one it will bind to something else. `refuses without a
 * host` is read from the command body, and it is the claim headless-only
 * plugins make about themselves in prose — it belongs here, because an agent
 * that calls one of these in a browser gets a refusal, not a result.
 */
const commandLine = command => {
  const said = [
    command.key ? `[${command.key}]` : null,
    command.refusesWithoutHost ? 'refuses without a host' : null
  ].filter(Boolean).join(', ')
  // A command with no key and no refusal is only its id: the label describes
  // what the id already names, and printing it for every command is most of the
  // block. A key or a refusal must stay, because neither is on the id.
  if (!said) return command.id
  return `${command.id} (${[command.label, said].filter(Boolean).join(', ')})`
}

/**
 * The interface of one plugin, as markdown.
 *
 * @param {object} facts What `source-facts.js` read from the file.
 * @param {object} where `lines` is the source length.
 * @returns {string} The block, without a trailing newline.
 */
export function interfaceBlock(facts = {}, where = {}) {
  const rows = [
    ['plugin', facts.name || null],
    ['category', facts.category || null],
    // Legacy is what a plugin that says nothing gets, so printing it would put
    // a row in every block in the tree.
    ['lifecycle', facts.lifecycle && facts.lifecycle !== 'legacy' ? facts.lifecycle : null],
    ...ROWS.map(row => [row, facts[row]?.length ? facts[row].join(', ') : null])
  ]
  const others = OTHER_POINTS
    .filter(point => (facts.contributes || {})[point] > 0)
    .map(point => counted(point, facts.contributes[point]))
  if (others.length) rows.push(['points', others.join(', ')])
  // A plugin with 46 commands prints 46 lines, and that is the point: the ids are
  // what an agent calls.
  const callable = [...(facts.commands || []), ...(facts.menus || [])]
  const commands = callable.map(commandLine)
  if (commands.length) rows.push(['commands', commands[0]], ...commands.slice(1).map(line => ['', line]))
  if (facts.unread?.length) rows.push(['unread', `${facts.unread.join(', ')}: ${UNREAD}`])
  // One row per kind, not per command: the label repeated for every command
  // costs more than the arguments it announces, and the id is what is read.
  const argumentLines = []
  const inputLines = []
  for (const command of callable) {
    // A command that takes nothing still needs its `id:` so a reader can find it;
    // writing `: none` after every one costs more than the missing argument says.
    if (command.arguments !== undefined) {
      const value = command.arguments === null ? ' read run in source' : command.arguments ? ` ${command.arguments}` : ''
      argumentLines.push(`${command.id}:${value}`)
    }
    if (command.inputSchema) inputLines.push(`${command.id}: ${command.inputSchema.replace(/\s+/g, ' ')}`)
  }
  if (argumentLines.length) rows.push(['arguments', argumentLines.join(';')])
  if (inputLines.length) rows.push(['input', inputLines.join(';')])
  if (facts.context?.length) rows.push(['context', facts.context.join(', ')])
  if (facts.systems?.length) rows.push(['systems', facts.systems.join(', ')])
  if (facts.listens?.length) rows.push(['listens', facts.listens.join(', ')])
  const emits = (facts.emits || []).map(entry =>
    `${entry.event}${entry.payloadKeys?.length ? ` {${entry.payloadKeys.join(', ')}}` : ''}`)
  if (emits.length) rows.push(['emits', emits[0]], ...emits.slice(1).map(line => ['', line]))
  // The path is in the line above the block, so this row answers only how much
  // source the list came from.
  if (where.lines) rows.push(['source', `${where.lines} lines`])

  // An absent row is left out rather than printed empty: a blank `listens` line
  // reads as "not measured", and this block is measured.
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (!shown.length) shown.push(['declared', 'no contribution point, and nothing on context'])
  // A label and its value, one space apart. Aligning the values into columns
  // costs ten characters a row and tells an agent nothing the label does not.
  const body = shown.map(([name, value]) => `  ${name ? `${name} ` : ''}${value}`.trimEnd()).join('\n')
  // The rows are the interface. A heading and a fence around them are
  // presentation, and the packet already prints the guide title above.
  return `parsed from source\n${body}`
}

/**
 * A reader that answers the interface block for one source file, or null.
 *
 * Node only. Read the stored interface when its hash matches. Otherwise parse
 * the source and replace the generated file before returning its contents.
 *
 * @param {object} places `root` is the checkout, `projectDirectory` the open game.
 * @returns {(scope: string, file: string) => Promise<string|null>} The reader.
 */
export async function makeInterfaceReader({ root, projectDirectory }) {
  const [fs, path, { makeSourceReader }] = await Promise.all([
    import('node:fs'), import('node:path'), import('./source-facts.js')
  ])
  const { createHash, randomUUID } = await import('node:crypto')
  const generator = await Promise.all(['interface-block.js', 'source-facts.js'].map(name =>
    fs.promises.readFile(new URL(name, import.meta.url), 'utf8')))
  const fingerprint = source => createHash('sha256').update(generator.join('\n')).update(source).digest('hex')
  let reader
  const pending = new Map()

  async function refresh(scope, file) {
    if (!['engine', 'project'].includes(scope) || typeof file !== 'string' || !file) return null
    const base = scope === 'engine' ? root : projectDirectory
    if (!base) return null
    const target = path.resolve(base, file)
    // The packet builder refuses a path that leaves its scope, and so does this:
    // a guide may name any file, and reading it must not reach past the tree.
    if (target !== path.resolve(base) && !target.startsWith(path.resolve(base) + path.sep)) return null
    const allowed = scope === 'engine' ? /^plugins\/builtin\/[^/]+\.js$/ : /^plugins\/[^/]+\.js$/
    if (!allowed.test(file)) return null
    const realBase = await fs.promises.realpath(base)
    const realTarget = await fs.promises.realpath(target).catch(() => null)
    if (!realTarget || !realTarget.startsWith(realBase + path.sep)) return null
    const source = await fs.promises.readFile(target, 'utf8').catch(() => null)
    if (source === null) return null
    const output = target.replace(/\.js$/, '.agent/interface.generated.md')
    const directory = path.dirname(output)
    await fs.promises.mkdir(directory, { recursive: true })
    const realDirectory = await fs.promises.realpath(directory)
    if (!realDirectory.startsWith(realBase + path.sep)) throw new Error('interface directory leaves its scope')
    const stamp = `<!--${fingerprint(source).slice(0, 8)}-->\n`
    const existing = await fs.promises.readFile(output, 'utf8').catch(() => '')
    if (existing.startsWith(stamp)) return existing
    reader ??= makeSourceReader()
    const facts = await (await reader).facts(target, source)
    if (facts === null) throw new Error(`cannot derive plugin interface: ${file}`)
    const text = stamp + interfaceBlock(facts, { file, lines: source.split('\n').length }) + '\n'
    const temporary = `${output}.${randomUUID()}.tmp`
    try {
      await fs.promises.writeFile(temporary, text, 'utf8')
      await fs.promises.rename(temporary, output)
    } finally { await fs.promises.unlink(temporary).catch(() => {}) }
    return text
  }

  // Serialise writes per source so an older parse cannot replace a newer edit.
  return function interfaceText(scope, file) {
    const key = `${scope}:${file}`
    const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(() => refresh(scope, file))
    pending.set(key, next)
    return next.finally(() => { if (pending.get(key) === next) pending.delete(key) })
  }
}
