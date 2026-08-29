/** Resolve the smallest instruction packet for one task. */

export const ENGINE_AGENT_MANIFEST = 'agents/manifest.json'
export const PROJECT_AGENT_MANIFEST = 'agents/manifest.json'
export const AGENT_SETTINGS = 'agents/settings.json'

const cleanPath = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')

export function matchesAgentPattern(file, pattern) {
  const input = cleanPath(file)
  const source = cleanPath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*')
  return new RegExp(`^${source}$`).test(input)
}

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

async function readJSON(read, scope, file, fallback) {
  try { return JSON.parse(await read(scope, file)) } catch (error) {
    if (fallback !== undefined) return fallback
    throw error
  }
}

function skillDetails(text) {
  const match = String(text).match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null
  const field = name => match[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  return { name: field('name'), description: field('description') }
}

// A skill or a plugin guide may open with `---` frontmatter (name, description,
// or a declared match). It is metadata for the tree, never instruction text, so
// it must not reach a packet.
const withoutFrontmatter = text => String(text).replace(/^---\s*\n[\s\S]*?\n---\s*/, '').trim()
const withoutFirstHeading = text => withoutFrontmatter(text).replace(/^# [^\n]+\n+/, '').trim()

async function loadAgentGraph(read, pluginNodes = []) {
  const engine = await readJSON(read, 'engine', ENGINE_AGENT_MANIFEST)
  const project = await readJSON(read, 'project', PROJECT_AGENT_MANIFEST)
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

  for (const node of nodes) node.enabled = node.kind !== 'skill' || !disabled.has(node.id)
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

export async function resolveAgentContext(read, requestValue = {}, pluginNodes = []) {
  const request = normaliseAgentRequest(requestValue)
  const workspace = await loadAgentGraph(read, pluginNodes)
  if (workspace.problems.length) throw new Error(`bad agent tree: ${workspace.problems.join('; ')}`)

  const wanted = new Set(request.nodes)
  const task = request.task.toLowerCase()
  for (const node of workspace.nodes) {
    if (!['instruction', 'skill'].includes(node.kind)) continue
    if (node.always) wanted.add(node.id)
    if ((node.match || []).some(pattern => request.files.some(file => matchesAgentPattern(file, pattern)))) wanted.add(node.id)
    if ((node.triggers || []).some(trigger => task.includes(String(trigger).toLowerCase()))) wanted.add(node.id)
  }

  const unknown = [...wanted].filter(id => !workspace.nodes.some(node => node.id === id))
  if (unknown.length) throw new Error(`unknown agent node: ${unknown.join(', ')}`)

  const selected = workspace.nodes.filter(node => wanted.has(node.id) && ['instruction', 'skill'].includes(node.kind) && node.enabled)
  const projectOverrides = new Set(selected
    .filter(node => node.scope === 'project' && node.override)
    .map(node => node.override))
  const resolved = selected.filter(node =>
    !(node.scope === 'engine' && node.override && projectOverrides.has(node.override)))
  const entries = await Promise.all(resolved.map(async node => ({ ...node, text: await read(node.scope, node.file) })))
  const tests = [...new Set(entries.flatMap(node => node.tests || []))]
  const parts = [
    request.task ? `# Task\n\n${request.task}` : null,
    ...entries.map(node => `# ${node.title || node.id}\n\n${withoutFirstHeading(node.text)}`),
    tests.length ? `# Required checks\n\n${tests.map(test => `- ${test}`).join('\n')}` : null
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
    characters: text.length,
    text
  }
}
