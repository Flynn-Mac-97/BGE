/**
 * Kernel: which engine and project files an agent packet may name.
 *
 * A packet asks the transport for a file by scope and path. The transport must
 * not read an arbitrary path, so the fixed sets each scope may name are policy
 * and live here, apart from how bytes reach disk.
 *
 * Node only: it resolves a path on disk.
 */
import path from 'node:path'

/** The engine's own instruction files an agent packet may name. */
function isEngineAgentFile(clean) {
  return (
    clean === 'AGENTS.md' ||
    clean === 'ENGINE-BASE.md' ||
    clean === 'ARCHITECTURE.md' ||
    clean.startsWith('agents/') ||
    clean.startsWith('docs/') ||
    /^plugins\/builtin\/[^/]+\.agent(?:\.md|\/[^/]+\.md)$/.test(clean)
  )
}

/** A project's own instruction files: its agents folder and its plugin guides. */
function isProjectAgentFile(clean) {
  return clean.startsWith('agents/') || /^plugins\/[^/]+\.agent(?:\.md|\/[^/]+\.md)$/.test(clean)
}

/** The directory a scope's agent files are read from, or null when the scope is unknown. */
function agentScopeBase(scope, root, projectDirectory) {
  if (scope === 'engine') return root
  if (scope === 'project') return projectDirectory
  return null
}

/** Whether a scope may name this file at all. */
function agentFileAllowed(scope, clean) {
  return scope === 'engine' ? isEngineAgentFile(clean) : isProjectAgentFile(clean)
}

/**
 * Resolve one agent file, from the fixed sets each scope is allowed to read.
 *
 * @param {string} scope `engine` or `project`.
 * @param {string} rel The path the packet named, relative to the scope's base.
 * @param {string} root The checkout the engine's own files are read from.
 * @param {string} projectDirectory The project's real directory on disk.
 * @returns {string} The absolute path of the file.
 * @throws {Error} `bad agent file path: <scope>:<rel>` when the scope is unknown or the path is refused.
 */
export function resolveAgentFile(scope, rel, root, projectDirectory) {
  const base = agentScopeBase(scope, root, projectDirectory)
  const clean = String(rel || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
  if (!base || !agentFileAllowed(scope, clean)) throw new Error(`bad agent file path: ${scope}:${rel}`)
  const abs = path.resolve(base, clean)
  if (!abs.startsWith(base + path.sep)) throw new Error(`bad agent file path: ${scope}:${rel}`)
  return abs
}
