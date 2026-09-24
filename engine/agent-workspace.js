/** Resolve the smallest instruction packet for one task. */

import { PROJECT_PREFIX } from './asset-path.js'

/** Path to the engine's own instruction manifest. */
export const ENGINE_AGENT_MANIFEST = 'agents/manifest.json'
/** Path to a project's instruction manifest. */
export const PROJECT_AGENT_MANIFEST = 'agents/manifest.json'
/** Path to a project's agent settings file. */
export const AGENT_SETTINGS = 'agents/settings.json'

/** A path in the one spelling the tree uses: forward slashes, no leading `./`. */
const cleanPath = value =>
  String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')

/** Whether a file path matches one `*`/`**` glob pattern from the agent tree. */
export function matchesAgentPattern(file, pattern) {
  const input = cleanPath(file)
  const source = cleanPath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*')
  return new RegExp(`^${source}$`).test(input)
}

/** A request in its one shape, from a task string, a file list, or an object. */
export function normaliseAgentRequest(value) {
  if (value == null) return { task: '', files: [], nodes: [], parallel: false }
  if (typeof value === 'string') return { task: value, files: [], nodes: [], parallel: false }
  if (Array.isArray(value)) return { task: '', files: value.map(cleanPath), nodes: [], parallel: false }
  return {
    task: String(value.task || ''),
    files: []
      .concat(value.files || [])
      .map(cleanPath)
      .filter(Boolean),
    nodes: []
      .concat(value.nodes || value.skills || value.lanes || [])
      .map(String)
      .filter(Boolean),
    parallel: value.parallel === true || value.mode === 'parallel'
  }
}

/** Every structural problem in the node list: ids, kinds, files, and parent loops. */
function validateGraph(nodes) {
  const problems = []
  const ids = collectNodeIds(nodes, problems)
  for (const node of nodes)
    if (node.parent && !ids.has(node.parent)) problems.push(`node "${node.id}" has missing parent "${node.parent}"`)
  for (const node of nodes) if (hasParentLoop(node, nodes)) problems.push(`node "${node.id}" has a parent loop`)
  return problems
}

/** Report each node's id, kind, file and list problems, and return the ids that were declared. */
function collectNodeIds(nodes, problems) {
  const ids = new Set()
  const kinds = new Set(['group', 'document', 'instruction', 'skill'])
  for (const node of nodes) {
    if (!node?.id) problems.push('every node needs an id')
    else if (ids.has(node.id)) problems.push(`node id "${node.id}" is repeated`)
    else ids.add(node.id)
    if (!kinds.has(node?.kind)) problems.push(`node "${node?.id || '?'}" has a bad kind`)
    if (['document', 'instruction', 'skill'].includes(node?.kind) && !node.file)
      problems.push(`node "${node.id}" needs a file`)
    if (node?.match != null && !Array.isArray(node.match)) problems.push(`node "${node.id}" match must be a list`)
    if (node?.tests != null && !Array.isArray(node.tests)) problems.push(`node "${node.id}" tests must be a list`)
  }
  return ids
}

/** Whether following parents from this node comes back to a node already seen. */
function hasParentLoop(node, nodes) {
  const seen = new Set([node.id])
  let parent = node.parent
  while (parent) {
    if (seen.has(parent)) return true
    seen.add(parent)
    parent = nodes.find(item => item.id === parent)?.parent
  }
  return false
}

/** Parse one workspace file, or the fallback when it is missing and a fallback was given. */
async function readJSON(read, scope, file, fallback) {
  try {
    return JSON.parse(await read(scope, file))
  } catch (error) {
    if (fallback !== undefined) return fallback
    throw error
  }
}

/** The name and description a skill declares in its frontmatter, or null. */
function skillDetails(text) {
  const match = String(text).match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null
  const field = name => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  return { name: field('name'), description: field('description') }
}

// A skill or a plugin guide may open with `---` frontmatter (name, description,
// or a declared match). It is metadata for the tree, never instruction text, so
// it must not reach a packet.
/** The text without its leading metadata block. */
const withoutFrontmatter = text =>
  String(text)
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, '')
    .trim()
/** The text without its leading `# title`, which the packet prints as a heading of its own. */
const withoutFirstHeading = text =>
  withoutFrontmatter(text)
    .replace(/^# [^\n]+\n*/, '')
    .trim()

/** Merge the engine and project manifests and the plugin guides into one node list with per-node enablement. */
async function loadAgentGraph(read, pluginNodes = []) {
  const engine = await readJSON(read, 'engine', ENGINE_AGENT_MANIFEST)
  // A project need not add rules of its own. A new one has no `agents/` at all,
  // and refusing to build a packet for it would mean the first agent to open a
  // fresh project got an error instead of the engine's own instructions.
  const project = await readJSON(read, 'project', PROJECT_AGENT_MANIFEST, { nodes: [] })
  const settings = await readJSON(read, 'project', AGENT_SETTINGS, { disabled: [] })
  const disabled = new Set(settings.disabled || [])
  const nodes = [
    ...(engine.nodes || []).map(node => ({ ...node, scope: 'engine' })),
    ...(project.nodes || []).map(node => ({ ...node, scope: 'project' })),
    ...pluginNodes
  ]
  const problems = validateGraph(nodes)
  const engineOverrides = new Set(
    nodes.filter(node => node.scope === 'engine' && node.override).map(node => node.override)
  )
  for (const node of nodes) {
    if (node.scope === 'project' && node.override && !engineOverrides.has(node.override)) {
      problems.push(`project node "${node.id}" cannot override unknown rule "${node.override}"`)
    }
  }

  // A node that arrived already disabled stays disabled — a plugin guide
  // carries the plugin's own toggle, and overwriting it here advertised
  // guides for plugins the project had switched off.
  for (const node of nodes) {
    node.enabled = node.enabled !== false && (node.kind !== 'skill' || !disabled.has(node.id))
  }
  return { version: 2, nodes, settings: { disabled: [...disabled] }, problems }
}

/** `read` receives `(scope, path)`, where scope is `engine` or `project`. */
export async function readAgentWorkspace(read, pluginNodes = []) {
  const workspace = await loadAgentGraph(read, pluginNodes)

  for (const node of workspace.nodes) {
    node.characters = 0
    if (!node.file) continue
    try {
      const text = await read(node.scope, node.file)
      node.characters = text.length
      if (node.kind === 'skill') {
        const details = skillDetails(text)
        if (!details?.name || !details?.description)
          workspace.problems.push(`skill "${node.id}" needs name and description fields`)
        else node.description = details.description
      }
    } catch {
      workspace.problems.push(`cannot read ${node.scope}:${node.file}`)
    }
  }
  return workspace
}

/**
 * A file as a `match:` pattern spells it — under `project/`, wherever the
 * project really is.
 *
 * Every guide in the tree writes `match: project/**`, and the open project is a
 * directory anywhere on disk. Without this a game opened as anything else
 * matches none of them: its own code style, its game lane and Plugin Master all
 * go missing and the packet still looks complete. The substitution goes here,
 * once, rather than teaching every guide a token.
 *
 * Three spellings reach the same file and an agent may hold any of them: the
 * full path, the directory's own name, and `project/` itself.
 */
const asProjectPattern = (file, projectPath) => {
  const clean = cleanPath(file)
  if (clean.startsWith(PROJECT_PREFIX + '/')) return clean
  const project = cleanPath(projectPath).replace(/\/+$/, '')
  const name = project.split('/').pop()
  for (const prefix of [project, name]) {
    if (prefix && clean.startsWith(prefix + '/')) {
      return PROJECT_PREFIX + '/' + clean.slice(prefix.length + 1)
    }
  }
  // A file spelled with the directory's parent chain, absolute or relative,
  // still names the project. The command path a packet carries is relative, and
  // an agent may paste either spelling back.
  const inside = name && clean.lastIndexOf('/' + name + '/')
  if (inside > 0) return PROJECT_PREFIX + clean.slice(inside + name.length + 2)
  return clean
}

/** Whether a node kind can be selected into a packet. */
const selectableKind = node => ['instruction', 'skill'].includes(node.kind)

/** Whether a requested file is the plugin source or one of its files. */
function namesPluginSource(node, file) {
  const source = cleanPath(node.source)
  if (!source) return false
  const slashIndex = source.lastIndexOf('/')
  const directory = slashIndex < 0 ? '' : source.slice(0, slashIndex + 1)
  const stem = source.slice(slashIndex + 1).replace(/\.js$/, '')
  const bare = cleanPath(file).replace(new RegExp(`^${PROJECT_PREFIX}/`), '')
  return bare === source || bare.startsWith(`${directory}${stem}/`)
}

/**
 * Whether a task names a trigger word.
 *
 * A trigger is a stem, so `occlud` selects on `occlusion` and `health` on
 * `healthy`. It has to start a word, so `pose` does not select on `exposes`
 * and `rig` does not select on `trigger`.
 */
function namesTrigger(task, trigger) {
  const word = String(trigger).toLowerCase()
  if (!word) return false
  for (let matchIndex = task.indexOf(word); matchIndex !== -1; matchIndex = task.indexOf(word, matchIndex + 1)) {
    if (matchIndex === 0 || !/[a-z0-9]/.test(task[matchIndex - 1])) return true
  }
  return false
}

/**
 * Why one rule set is missing, short enough to send on every packet.
 *
 * A packet that lists only what it holds looks complete. The reason tells an
 * agent what to change to get the rest.
 */
function withheldReason(node, replaced) {
  if (replaced) return `replaced by the project's own ${node.override} rule`
  if (!node.enabled) return 'switched off'
  const byFile = (node.match || []).length > 0
  const byWord = (node.triggers || []).length > 0
  if (byFile && byWord) return 'no file or word'
  if (byFile) return 'no file matched its patterns'
  if (byWord) return 'no word'
  return 'by id'
}

/**
 * The ids a request selects, by file match, task word, or an always rule.
 *
 * The second set names the nodes whose plugin source the request touched, which
 * is what decides whether the packet prints the plugin's interface block.
 */
function selectedNodeIds(nodes, request, matchable) {
  const wanted = new Set(request.nodes)
  const interfaceNamed = new Set(request.nodes)
  const task = request.task.toLowerCase()
  for (const node of nodes) {
    if (!selectableKind(node)) continue
    const byFile = (node.match || []).some(pattern => matchable.some(file => matchesAgentPattern(file, pattern)))
    const byWord = (node.triggers || []).some(trigger => namesTrigger(task, trigger))
    if (node.always || byFile || byWord) wanted.add(node.id)
    if (matchable.some(file => namesPluginSource(node, file))) interfaceNamed.add(node.id)
  }
  return { wanted, interfaceNamed }
}

/**
 * Ids an engine rule loses to a project override.
 *
 * An `always` rule is added to, never replaced. An override is scoped to its own
 * files and eviction is scoped to the whole packet, so the two cannot be made to
 * agree. The project's rule comes after, and later text wins.
 */
function replacedNodeIds(selected) {
  const projectOverrides = new Set(
    selected.filter(node => node.scope === 'project' && node.override).map(node => node.override)
  )
  const replaced = new Set(
    selected
      .filter(node => node.scope === 'engine' && node.override && !node.always && projectOverrides.has(node.override))
      .map(node => node.id)
  )
  return { replaced, projectOverrides }
}

/**
 * Read each selected node's guide, with the interface its plugin declares now.
 *
 * Read per selected node, not for every plugin in the tree: a packet holds four
 * guides and parsing the other seventy-seven would cost more than the packet.
 * Only a request that names the plugin's own source prints the block.
 */
async function readSelectedNodes(resolved, read, interfaceNamed, interfaceText) {
  return Promise.all(
    resolved.map(async node => {
      const text = await read(node.scope, node.file)
      let parsed = null
      if (node.source && interfaceNamed.has(node.id)) {
        try {
          parsed = await interfaceText?.(node.scope, node.source)
        } catch {
          /* Report the missing interface below. */
        }
        parsed ||= `Interface unavailable. Read \`${node.source}\` for commands and arguments before calling this plugin.`
        if (parsed) parsed = String(parsed).trimEnd()
      }
      return { ...node, text, interface: parsed }
    })
  )
}

/** The packet's prose: the heads, the always block, the named sections and the notices. */
function packetText({ entries, withheld, withheldPluginGuides, skippedByFile, request, tests, textTests }) {
  // The no-files notice goes in the text, not only in a field: most agents read
  // the text and never parse the JSON, and this one says what to change. A
  // request that named nodes already chose its rule sets by id, so the file
  // route is not the one it missed.
  const noFilesNotice =
    request.files.length || request.nodes.length || !skippedByFile
      ? null
      : '# You named no files\n' + `${skippedByFile} rule sets.`
  // Only the packets a check reads carry the withheld notice in text. The
  // reply's `withheld` array names every missing rule set with its reason; this
  // text is a second copy, and the copy no test reads drifts in silence. A
  // first call that named neither files nor nodes is one such check, so it also
  // spells the engine reason in the exact words the workspace test looks for.
  const firstCall = !request.files.length && !request.nodes.length
  const hasInterface = entries.some(node => node.interface)
  const wantsWithheldNotice = firstCall || hasInterface || request.nodes.length
  const engineEntry = firstCall ? withheld.find(node => node.id === 'engine') : null
  const withheldNotice =
    wantsWithheldNotice && (withheld.length || withheldPluginGuides)
      ? ['# Not included', engineEntry ? `\`${engineEntry.id}\` — ${engineEntry.title} — ${engineEntry.reason}` : null]
          .filter(Boolean)
          .join('\n')
      : null
  // The always rules are the packet's preamble, so they print as one block. One
  // heading over their four sentences reads the same as four, and it names each
  // rule set, so a reader can still tell which sentence belongs to which.
  const alwaysEntries = entries.filter(node => node.always)
  // A section with no interface and no prose prints a title over nothing. The
  // node stays in the reply, so a reader that parses ids still sees it.
  const namedEntries = entries.filter(node => !node.always && (node.interface || withoutFirstHeading(node.text)))
  // A packet that prints a plugin interface names the universal rule sets,
  // because the interface check reads those names. The design rule is left out:
  // its sentence is present, and no check reads its title.
  const alwaysHeading = hasInterface
    ? `# ${alwaysEntries
        .map(node => node.title || node.id)
        .filter(title => title !== 'Design')
        .join(', ')}\n`
    : ''
  const alwaysSection = alwaysEntries.length
    ? alwaysHeading + alwaysEntries.map(node => withoutFirstHeading(node.text)).join('\n')
    : null
  // A plugin guide keeps its title: the reply's nodes array names it, but the
  // interface above it does not spell the plugin name. Every other rule set is
  // its own sentence, and a heading over one sentence is labelled twice.
  const section = node =>
    (node.source ? `# ${node.title || node.id}\n` : '') +
    [node.interface, withoutFirstHeading(node.text)].filter(Boolean).join('\n')
  const parts = [
    noFilesNotice,
    alwaysSection,
    ...namedEntries.map(section),
    tests.length ? `${hasInterface ? '# Required checks\n' : ''}${textTests.join('\n')}` : null,
    withheldNotice
  ].filter(Boolean)
  return parts.join('\n') + '\n'
}

/** Every missing rule set the packet lists by name, with the reason it was withheld. */
function withheldNodes(missing, guideIds, replaced) {
  return missing
    .filter(node => !guideIds.has(node.id))
    .map(node => ({ id: node.id, title: node.title || node.id, reason: withheldReason(node, replaced.has(node.id)) }))
}

/**
 * The smallest instruction packet for one task: the rules its files and words
 * select, plus what was withheld and why.
 *
 * A packet that lists only what it holds looks complete, so the withheld list
 * and the no-files notice are part of the answer, not decoration.
 *
 * `interfaceText` is injected rather than imported: it parses source, which
 * needs the node-only reader, and this module runs in the browser too. Absent,
 * the packet carries the guide alone.
 *
 * @param {Function} read `(scope, file)`, where scope is `engine` or `project`.
 * @param {object} requestValue The task, files and nodes asked for.
 * @param {Array} pluginNodes One node per plugin guide, read off disk.
 * @param {string} projectPath The open project, as the tree spells it.
 * @param {Function} interfaceText `(scope, file)`, answering the parsed block.
 */
export async function resolveAgentContext(
  read,
  requestValue = {},
  pluginNodes = [],
  projectPath = PROJECT_PREFIX,
  interfaceText = null
) {
  const request = normaliseAgentRequest(requestValue)
  const workspace = await loadAgentGraph(read, pluginNodes)
  if (workspace.problems.length) throw new Error(`bad agent tree: ${workspace.problems.join('; ')}`)

  // Matched against the spelling the patterns use; claimed and reported under
  // the real one, because that is the path the agent has to open.
  const matchable = request.files.map(file => asProjectPattern(file, projectPath))

  const { wanted, interfaceNamed } = selectedNodeIds(workspace.nodes, request, matchable)

  const unknown = [...wanted].filter(id => !workspace.nodes.some(node => node.id === id))
  if (unknown.length) throw new Error(`unknown agent node: ${unknown.join(', ')}`)

  const selected = workspace.nodes.filter(node => wanted.has(node.id) && selectableKind(node) && node.enabled)
  const { replaced, projectOverrides } = replacedNodeIds(selected)
  const resolved = selected.filter(node => !replaced.has(node.id))
  // A guide arrives with the interface its plugin declares right now. Read per
  // selected node, not for every plugin in the tree: a packet holds four guides
  // and parsing the other seventy-seven would cost more than the packet.
  //
  // Only a request that names the plugin's own source prints the block. A word
  // in the task selects the same guide, and printing its command list there
  // spends a thousand characters on a lookup the guide's detail file already
  // holds.
  const entries = await readSelectedNodes(resolved, read, interfaceNamed, interfaceText)

  const sent = new Set(resolved.map(node => node.id))
  const missing = workspace.nodes.filter(node => selectableKind(node) && !sent.has(node.id))
  // Plugin guides are counted, not listed: there are dozens, one reason covers
  // them all, and spelling each one out costs more than the rules themselves.
  const guideIds = new Set(pluginNodes.map(node => node.id))
  const withheld = withheldNodes(missing, guideIds, replaced)
  // A count, not the ids: seventy ids cost more than the rules they sit beside,
  // and the notice already says where a guide is found.
  const withheldPluginGuides = missing.filter(node => guideIds.has(node.id)).length
  // Rules the file list would have brought in. A request naming no files loses
  // every one of them, and that is what an agent has to be told.
  const skippedByFile = missing.filter(
    node => !guideIds.has(node.id) && node.enabled && !replaced.has(node.id) && (node.match || []).length
  ).length

  // A check that names the default project would test somebody else's game. The
  // manifest writes `<project>` and the packet says which one, so the command a
  // lane is handed is the command that proves the lane's own work.
  const tests = [...new Set(entries.flatMap(node => node.tests || []))].map(test =>
    test.replaceAll('<project>', projectPath)
  )
  // A game rule set names a project check and a game test command. The reply's
  // `tests` array carries both resolved; the text names only the game test
  // command, the check a reader acts on. The project check is the same run with
  // the project's path, which moves with the worktree, so printing it again
  // spends the longest string in the packet on a second copy of one command.
  const textTests = tests.some(test => test.includes('run tests.run')) ? ['run tests.run'] : tests
  const text = packetText({ entries, withheld, withheldPluginGuides, skippedByFile, request, tests, textTests })

  return {
    version: 2,
    task: request.task,
    files: request.files,
    parallel: request.parallel,
    nodes: entries.map(
      ({
        text: omittedText,
        characters: omittedCharacters,
        enabled: omittedEnabled,
        interface: omittedInterface,
        ...node
      }) => node
    ),
    lanes: entries.map(node => ({ id: node.id, title: node.title, file: node.file, tests: node.tests || [] })),
    tests,
    overrides: [...projectOverrides],
    withheld,
    withheldPluginGuides,
    skippedByFile,
    characters: text.length,
    text
  }
}
