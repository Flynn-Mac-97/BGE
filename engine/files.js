/**
 * Kernel: the only writer to disk.
 *
 * There is no save button anywhere in the editor: every edit lands here at
 * once. A write that a guard or the server refuses is recorded in `refused` and
 * announced as `files:refused`, so a reader states "saved" only when one is.
 *
 * The four things it does — index, tree, read, write — are handed in as a
 * transport, because the browser reaches disk over HTTP and node reaches it
 * directly. Everything above this line stays the same either way: the counting
 * of pending writes, the events, the guards asked before every write, and the
 * refusal to have a save button.
 */

/**
 * The name this page announced to the server, sent with every write.
 *
 * The server decides what a client may do from its own lane registry, and needs
 * a name to look one up. Written by the tab beacon in `vite.config.js` under
 * this key; a page that stored nothing sends nothing and is treated as the
 * person's editor.
 */
const clientName = () => {
  try {
    return globalThis.sessionStorage?.getItem('engine:tab-id') || ''
  } catch {
    return ''
  }
}

/**
 * Talk to the dev server. The transport the editor uses.
 *
 * @returns {object} The transport `makeFiles` reads and writes through.
 */
export function overHTTP() {
  const j = async (url, options) => {
    const r = await fetch(url, options)
    const body = await r.json()
    if (!r.ok || body.error) throw new Error(body.error || r.statusText)
    return body
  }

  const writeHeaders = () => ({ 'content-type': 'application/json', 'x-engine-client': clientName() })

  return {
    index: () => j('/api/index'),
    tree: () => j('/api/tree'),
    agentPlugins: () => j('/api/agent-plugins'),
    agentInterface: async (scope, file) =>
      (await j('/api/agent-interface?scope=' + encodeURIComponent(scope) + '&path=' + encodeURIComponent(file))).text,
    read: async path => (await j('/api/file?path=' + encodeURIComponent(path))).text,
    sourceCatalog: (selection = 'core') => j('/api/systems/catalog?selection=' + encodeURIComponent(selection)),
    listDocuments: () => j('/api/systems/documents'),
    readDocument: (id, backup = false) => j('/api/systems/document?id=' + encodeURIComponent(id) + '&backup=' + backup),
    writeDocument: (id, documentData, revision) =>
      j('/api/systems/document', {
        method: 'POST',
        headers: writeHeaders(),
        // eslint-disable-next-line id-denylist -- the wire message field is named data
        body: JSON.stringify({ id, data: documentData, revision })
      }),
    writeSource: (scope, file, text, expectedHash) =>
      j('/api/systems/source', {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ scope, file, text, expectedHash })
      }),
    readSource: (scope, path) =>
      j('/api/systems/source?scope=' + encodeURIComponent(scope) + '&path=' + encodeURIComponent(path)),
    readAgent: async (scope, path) =>
      (await j('/api/agent-file?scope=' + encodeURIComponent(scope) + '&path=' + encodeURIComponent(path))).text,
    write: (path, text) =>
      j('/api/file', {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ path, text })
      }),
    writeAgent: (scope, path, text) =>
      j('/api/agent-file', {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ scope, path, text })
      })
  }
}

/**
 * A page a lane opened to render in never writes the shared checkout.
 *
 * `__engineViewer` is set by the tab beacon before the editor boots, and holds
 * the lane's name. This is the kernel's own guard, not a plugin's: it states
 * who the page is rather than a project policy, so nothing removes it. Every
 * write reaches disk through this module, so this one check covers the editor,
 * every plugin, and anything typed into the console.
 */
const laneRenderPageGuard = () => {
  const lane = globalThis.__engineViewer
  if (!lane) return null
  const who = typeof lane === 'string' ? `lane "${lane}"` : 'a lane'
  return `this page renders for ${who}, and a lane render page never writes the shared checkout`
}

/**
 * The file surface the world writes through.
 *
 * Every write passes the guards, then the transport. A refusal is recorded and
 * announced rather than thrown away, because a refused write and a write still
 * in flight both leave `pending` at zero — only `refused` tells them apart.
 *
 * @param {object} bus The bus writes and refusals are announced on.
 * @param {object} [transport] Where bytes land; the dev server by default.
 * @returns {object} The file surface: read, write, guards and their state.
 */
export function makeFiles(bus, transport = overHTTP()) {
  let writing = 0

  /**
   * The last write that did not reach disk, and why. Cleared by the next write
   * that does.
   *
   * `pending` counts writes in flight, so after a refusal it reads zero — the
   * same number a finished write leaves. A reader with only that number reports
   * "saved to disk" for a write that was refused, so the refusal is kept here
   * and announced as `files:refused`.
   */
  let refused = null

  /** Store a write that did not land, announce it, and return the record. */
  const noteRefusal = (path, scope, why) => {
    refused = { path, scope, why, message: `refused to write ${path} — ${why}` }
    bus.emit('files:refused', refused)
    return refused
  }

  /**
   * Asked before every write, and any one of them may refuse it.
   *
   * The kernel performs the write, so only the kernel can stop one. Beyond its
   * own guard above it holds no policy about who may write what: a guard
   * returns a reason to refuse, or nothing to allow, and a plugin's policy goes
   * off with the plugin. A guard nobody can disable is a guard people route
   * around.
   *
   * A guard that throws is treated as a refusal with its message, because a
   * broken guard must not silently become permission.
   */
  const guards = new Set([laneRenderPageGuard])
  const refusal = (path, scope) => {
    for (const guard of guards) {
      let why
      try {
        why = guard(path, scope)
      } catch (error) {
        why = String(error?.message || error)
      }
      if (why) return String(why)
    }
    return null
  }

  /** Throw if a guard refuses this write, after recording the refusal. */
  const stopIfRefused = (path, scope) => {
    const why = refusal(path, scope)
    if (why) throw new Error(noteRefusal(path, scope, why).message)
  }

  return {
    /** Register a write guard. Returns the function that removes it again. */
    guardWrites(guard) {
      guards.add(guard)
      return () => guards.delete(guard)
    },
    async index() {
      return transport.index()
    },
    async tree() {
      return transport.tree()
    },
    async agentPlugins() {
      return transport.agentPlugins()
    },
    async agentInterface(scope, file) {
      return transport.agentInterface(scope, file)
    },
    async read(path) {
      return transport.read(path)
    },
    async sourceCatalog(selection = 'core') {
      if (!transport.sourceCatalog) throw new Error('source catalog unavailable in this transport')
      return transport.sourceCatalog(selection)
    },
    async listDocuments() {
      return transport.listDocuments()
    },
    async readDocument(id, backup = false) {
      return transport.readDocument(id, backup)
    },
    async writeDocument(id, documentData, revision) {
      stopIfRefused('.engine/systems/' + id + '.json', 'project')
      return transport.writeDocument(id, documentData, revision)
    },
    async writeSource(scope, file, text, expectedHash) {
      stopIfRefused(file, scope)
      return transport.writeSource(scope, file, text, expectedHash)
    },
    async readSource(scope, path) {
      if (!transport.readSource) throw new Error('source inspection is unavailable in this transport')
      return transport.readSource(scope, path)
    },
    async readAgent(scope, path) {
      return transport.readAgent(scope, path)
    },

    async write(path, text) {
      stopIfRefused(path, 'project')
      writing++
      bus.emit('files:writing', { path, pending: writing })
      try {
        // The transport's answer, which carries the rebuilt index where the
        // transport builds one. A caller that ignores it writes exactly as before.
        const written = await transport.write(path, text)
        refused = null
        bus.emit('files:written', { path })
        return written
      } catch (error) {
        // The server refuses too — the work lock answers the file routes — and
        // a write it turned away is as unsaved as one a guard stopped.
        noteRefusal(path, 'project', String(error?.message || error))
        throw error
      } finally {
        writing--
        bus.emit('files:writing', { path, pending: writing })
      }
    },

    async writeJSON(path, value) {
      return this.write(path, JSON.stringify(value, null, 2))
    },

    async writeAgent(scope, path, text) {
      stopIfRefused(path, scope)
      writing++
      bus.emit('files:writing', { path, scope, pending: writing })
      try {
        await transport.writeAgent(scope, path, text)
        refused = null
        bus.emit('files:written', { path, scope })
      } catch (error) {
        noteRefusal(path, scope, String(error?.message || error))
        throw error
      } finally {
        writing--
        bus.emit('files:writing', { path, scope, pending: writing })
      }
    },

    get pending() {
      return writing
    },

    /** The last write that did not land, or null once one does. */
    get refused() {
      return refused
    }
  }
}
