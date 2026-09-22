/**
 * The OpenRouter key and where it came from.
 *
 * Shared by the plugin, the agent-context path and the CLI so the order of
 * sources is decided once. The environment wins, so an agent, a lane or CI is
 * given a key without a file; the stored file is read second. `.engine/` is
 * git-ignored, so a key kept there is never committed.
 */
export const KEY_FILE = '.engine/openrouter.json'

/** @param {Function} read `(path)` answering the file, project-relative. */
export async function readKey(read) {
  const fromEnvironment = typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : null
  if (fromEnvironment) return { key: fromEnvironment, where: 'OPENROUTER_API_KEY' }
  try {
    const stored = JSON.parse(await read(KEY_FILE))
    if (stored.key) return { key: String(stored.key), where: KEY_FILE }
  } catch { /* no key stored yet */ }
  return { key: null, where: null }
}
