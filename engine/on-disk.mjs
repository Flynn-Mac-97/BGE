/**
 * Kernel: reach a project directly, on disk.
 *
 * A node world needs no dev server, no port and no browser tab, so it reads and
 * writes the project's files itself. This module is that transport and the
 * guard that keeps every path inside the project. It is the twin of the
 * server's file routes: the same project-relative paths, the same refusal to
 * leave the project, and the same index rebuild after a write.
 *
 * Which `.agent.md` files a scope may name is policy, not transport, and is in
 * `agent-files.mjs`.
 *
 * Node only. The browser reaches the open project through the dev server and
 * never learns where it is on disk.
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { resolveAgentFile } from './agent-files.mjs'
import { listDocuments, readDocument, writeDocument } from './document-store.mjs'
import { readSource, sourceCatalog, writeSource } from './source-files.mjs'
import { buildIndex, walk } from './project-index.mjs'
import { workLock } from './work-lock.mjs'
import { pluginGuides } from './plugin-guides.mjs'
import { pluginInterfaceReader } from './plugin-interface.mjs'

/** The repository, found from this file, so a world starts the same from any directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Reach the project directly rather than through the dev server.
 *
 * Writes rebuild the index, exactly as the server's POST handler does, so a
 * headless session that writes a level sees the new index on the next read.
 * Skipping that is how a world ends up acting on a project that no longer
 * exists.
 *
 * @param {string} projectDirectory The project's real directory on disk.
 * @param {string} [checkout] The repository the engine's files are read from.
 * @returns {import('./files.js').FileTransport} The transport: index, tree, read, write and agent files.
 */
export function onDisk(projectDirectory, checkout = ROOT) {
  // The checkout is passed in, not taken from the project's parent: the project
  // may be anywhere, and the engine's own instructions are read from here.
  const root = path.resolve(checkout)
  let interfaceReader
  const agentInterface = async (scope, file) => {
    interfaceReader ??= pluginInterfaceReader({ root, projectDirectory })
    const reader = await interfaceReader
    // No Plugin Master in this checkout means no parsed interface; the packet
    // falls back to the guide prose and says the interface is unavailable.
    return reader ? reader(scope, file) : null
  }
  /** Resolve one project file, refusing any path that climbs outside the project. */
  const inside = rel => {
    const abs = path.resolve(projectDirectory, rel)
    // Same guard the dev server applies. A path that climbs out of the project
    // is a bug wherever it came from, and answering it quietly would make the
    // headless runner the weaker door.
    if (abs !== projectDirectory && !abs.startsWith(projectDirectory + path.sep)) {
      throw new Error(`path outside project: ${rel}`)
    }
    return abs
  }

  /** The `.agent.md` guides beside every plugin, in the shape the agent-context builder reads. */
  const pluginSidecars = () => pluginGuides(root, projectDirectory)

  return {
    index: () => buildIndex(projectDirectory, root),
    tree: async () =>
      (await walk(projectDirectory)).filter(file => !file.startsWith('.engine')).map(file => ({ path: file })),
    agentPlugins: pluginSidecars,
    agentInterface,
    sourceCatalog: selection => sourceCatalog(root, projectDirectory, selection),
    listDocuments: () => listDocuments(projectDirectory),
    readDocument: id => readDocument(projectDirectory, id),
    writeDocument: (id, documentData, revision) => writeDocument(projectDirectory, id, documentData, revision),
    writeSource: (scope, file, text, expectedHash) =>
      writeSource(root, projectDirectory, scope, file, text, expectedHash),
    readSource: (scope, file) => readSource(root, projectDirectory, scope, file),
    read: rel => fs.readFile(inside(rel), 'utf8'),
    readAgent: (scope, rel) => fs.readFile(resolveAgentFile(scope, rel, root, projectDirectory), 'utf8'),
    async write(rel, text) {
      const abs = inside(rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      // The rebuild is the write's own, so its result is handed back: a caller
      // that needs the index it just changed does not pay for a second rebuild.
      return buildIndex(projectDirectory, root)
    },
    async writeAgent(scope, rel, text) {
      const abs = resolveAgentFile(scope, rel, root, projectDirectory)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      if (scope === 'project') await buildIndex(projectDirectory, root)
    }
  }
}

/**
 * Every write this process refused, oldest first.
 *
 * A caller that swallows the rejection still has to fail: the CLI reads this
 * after the op and exits 1 when anything is in it.
 */
const refusedWrites = []

/**
 * What the work lock refused in this process, oldest first.
 *
 * @returns {Array} The refusal records.
 */
export function writesRefusedHere() {
  return refusedWrites.slice()
}

/**
 * Refuse every write while a lane holds the checkout.
 *
 * `vite.config.js` asks `permits` at the server's three doors. A headless world
 * reaches disk through none of them, so the same rule is registered here.
 *
 * The lock is read on every write, not once at start-up, so a run that ends
 * mid-session frees the checkout with nothing to reset. Reads never reach a
 * guard, so a locked checkout still answers every question.
 */
export function refuseWritesWhileLanesWork(checkout) {
  return (file, scope) => {
    const lock = workLock(checkout)
    if (!lock.locked) return null
    refusedWrites.push({ file, scope, why: lock.why })
    return lock.why
  }
}
