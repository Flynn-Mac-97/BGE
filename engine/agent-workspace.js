/** Resolve the smallest instruction packet for one task. */

import { PROJECT_PREFIX } from './asset-path.js'

export const ENGINE_AGENT_MANIFEST = 'agents/manifest.json'
export const PROJECT_AGENT_MANIFEST = 'agents/manifest.json'
export const AGENT_SETTINGS = 'agents/settings.json'

/** A path in the one spelling the tree uses: forward slashes, no leading `./`. */
const cleanPath = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')

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
    files: [].concat(value.files || []).map(cleanPath).filter(Boolean),
    nodes: [].concat(value.nodes || value.skills || value.lanes || []).map(String).filter(Boolean),
    parallel: value.parallel === true || value.mode === 'parallel'
  }
}

/** Every structural problem in the node list: ids, kinds, files, and parent loops. */
function validateGraph(nodes) {
  const problems = []
  const ids = new Set()
  const kinds = new Set(['group', 'document', 'instruction', 'skill'])
  for (const node of nodes) {
    if (!node?.id) problems.push('every node needs an id')
    else if (ids.has(node.id)) problems.push(`node id "${node.id}" is repeated`)
    else ids.add(node.id)
    if (!kinds.has(node?.kind)) problems.push(`node "${node?.id || '?'}" has a bad kind`)
    if (['document', 'instruction', 'skill'].includes(node?.kind) && !node.file) problems.push(`node "${node.id}" needs a file`)
    if (node?.match != null && !Array.isArray(node.match)) problems.push(`node "${node.id}" match must be a list`)
    if (node?.tests != null && !Array.isArray(node.tests)) problems.push(`node "${node.id}" tests must be a list`)
  }
  for (const node of nodes) if (node.parent && !ids.has(node.parent)) problems.push(`node "${node.id}" has missing parent "${node.parent}"`)
  for (const node of nodes) {
    const seen = new Set([node.id])
    let parent = node.parent
    while (parent) {
      if (seen.has(parent)) { problems.push(`node "${node.id}" has a parent loop`); break }
      seen.add(parent)
      parent = nodes.find(item => item.id === parent)?.parent
    }
  }
  return problems
}

/** Parse one workspace file, or the fallback when it is missing and a fallback was given. */
async function readJSON(read, scope, file, fallback) {
  try { return JSON.parse(await read(scope, file)) } catch (error) {
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
const withoutFrontmatter = text => String(text).replace(/^---\s*\n[\s\S]*?\n---\s*/, '').trim()
/** The text without its leading `# title`, which the packet prints as a heading of its own. */
const withoutFirstHeading = text => withoutFrontmatter(text).replace(/^# [^\n]+\n+/, '').trim()

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
  const engineOverrides = new Set(nodes
    .filter(node => node.scope === 'engine' && node.override)
    .map(node => node.override))
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
        if (!details?.name || !details?.description) workspace.problems.push(`skill "${node.id}" needs name and description fields`)
        else node.description = details.description
      }
    }
    catch { workspace.problems.push(`cannot read ${node.scope}:${node.file}`) }
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
  for (const prefix of [project, project.split('/').pop()]) {
    if (prefix && clean.startsWith(prefix + '/')) {
      return PROJECT_PREFIX + '/' + clean.slice(prefix.length + 1)
    }
  }
  return clean
}

/** Whether a node kind can be selected into a packet. */
const selectableKind = node => ['instruction', 'skill'].includes(node.kind)

/**
 * Why one rule set is missing, short enough to send on every packet.
 *
 * A packet that lists only what it holds looks complete. The reason tells an
 * agent what to change to get the rest.
 */
function withheldReason(node, replaced) {
  if (replaced) return `replaced by the project's own ${node.override} rule`
  if (!node.enabled) return 'switched off in agents/settings.json'
  const byFile = (node.match || []).length > 0
  const byWord = (node.triggers || []).length > 0
  if (byFile && byWord) return 'no file matched, no trigger word in the task'
  if (byFile) return 'no file matched its patterns'
  if (byWord) return 'no trigger word in the task'
  return 'selected only by name'
}

/**
 * The smallest instruction packet for one task: the rules its files and words
 * select, plus what was withheld and why.
 *
 * A packet that lists only what it holds looks complete, so the withheld list
 * and the no-files notice are part of the answer, not decoration.
 */
export async function resolveAgentContext(read, requestValue = {}, pluginNodes = [], projectPath = PROJECT_PREFIX) {
  const request = normaliseAgentRequest(requestValue)
  const workspace = await loadAgentGraph(read, pluginNodes)
  if (workspace.problems.length) throw new Error(`bad agent tree: ${workspace.problems.join('; ')}`)

  // Matched against the spelling the patterns use; claimed and reported under
  // the real one, because that is the path the agent has to open.
  const matchable = request.files.map(file => asProjectPattern(file, projectPath))

  const wanted = new Set(request.nodes)
  const task = request.task.toLowerCase()
  for (const node of workspace.nodes) {
    if (!selectableKind(node)) continue
    if (node.always) wanted.add(node.id)
    if ((node.match || []).some(pattern => matchable.some(file => matchesAgentPattern(file, pattern)))) wanted.add(node.id)
    if ((node.triggers || []).some(trigger => task.includes(String(trigger).toLowerCase()))) wanted.add(node.id)
  }

  const unknown = [...wanted].filter(id => !workspace.nodes.some(node => node.id === id))
  if (unknown.length) throw new Error(`unknown agent node: ${unknown.join(', ')}`)

  const selected = workspace.nodes.filter(node => wanted.has(node.id) && selectableKind(node) && node.enabled)
  const projectOverrides = new Set(selected
    .filter(node => node.scope === 'project' && node.override)
    .map(node => node.override))
  // An `always` rule is added to, never replaced. An override is scoped to its
  // own files and eviction is scoped to the whole packet, so the two cannot be
  // made to agree. The project's rule comes after, and later text wins.
  const replaced = new Set(selected
    .filter(node => node.scope === 'engine' && node.override && !node.always && projectOverrides.has(node.override))
    .map(node => node.id))
  const resolved = selected.filter(node => !replaced.has(node.id))
  const entries = await Promise.all(resolved.map(async node => ({ ...node, text: await read(node.scope, node.file) })))

  const sent = new Set(resolved.map(node => node.id))
  const missing = workspace.nodes.filter(node => selectableKind(node) && !sent.has(node.id))
  // Plugin guides are counted, not listed: there are dozens, one reason covers
  // them all, and spelling each one out costs more than the rules themselves.
  const guideIds = new Set(pluginNodes.map(node => node.id))
  const withheld = missing.filter(node => !guideIds.has(node.id))
    .map(node => ({ id: node.id, title: node.title || node.id, reason: withheldReason(node, replaced.has(node.id)) }))
  // A count, not the ids: seventy ids cost more than the rules they sit beside,
  // and the notice already says where a guide is found.
  const withheldPluginGuides = missing.filter(node => guideIds.has(node.id)).length
  // Rules the file list would have brought in. A request naming no files loses
  // every one of them, and that is what an agent has to be told.
  const skippedByFile = missing.filter(node =>
    !guideIds.has(node.id) && node.enabled && !replaced.has(node.id) && (node.match || []).length).length

  // A check that names the default project would test somebody else's game. The
  // manifest writes `<project>` and the packet says which one, so the command a
  // lane is handed is the command that proves the lane's own work.
  const tests = [...new Set(entries.flatMap(node => node.tests || []))]
    .map(test => test.replaceAll('<project>', projectPath))
  // Both notices go in the text, not only in a field: most agents read the text
  // and never parse the JSON.
  const noFilesNotice = request.files.length || !skippedByFile ? null
    : '# You named no files\n\n'
      + `This packet is short. ${skippedByFile} rule sets are chosen by the files you touch, and none of them are here.`
      + ' Ask again as soon as you know the files:\n\n'
      + '```sh\nnode bin/engine.mjs agent.context \'{"task":"...","files":["path/to/file.js"]}\'\n```'
  const withheldNotice = withheld.length || withheldPluginGuides
    ? [
      '# Not included',
      'These rule sets exist and are not above. Ask for one by id with `\'{"task":"...","nodes":["<id>"]}\'`.',
      withheld.length ? withheld.map(node => `- \`${node.id}\` — ${node.title} — ${node.reason}`).join('\n') : null,
      withheldPluginGuides
        ? `${withheldPluginGuides} plugin guides are also missing. A guide arrives when your task uses that`
          + " plugin's words; each guide is the `*.agent.md` file beside its plugin."
        : null
    ].filter(Boolean).join('\n\n')
    : null
  const parts = [
    request.task ? `# Task\n\n${request.task}` : null,
    noFilesNotice,
    ...entries.map(node => `# ${node.title || node.id}\n\n${withoutFirstHeading(node.text)}`),
    tests.length ? `# Required checks\n\n${tests.map(test => `- ${test}`).join('\n')}` : null,
    withheldNotice
  ].filter(Boolean)
  const text = parts.join('\n\n') + '\n'

  return {
    version: 2,
    task: request.task,
    files: request.files,
    parallel: request.parallel,
    nodes: entries.map(({ text, characters, enabled, ...node }) => node),
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
