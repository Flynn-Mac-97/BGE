/**
 * Kernel: the only writer to disk.
 *
 * There is no save button anywhere in the editor — every edit lands here
 * immediately, which is what lets the status bar state "saved" unconditionally.
 *
 * The four things it does — index, tree, read, write — are handed in as a
 * transport, because the browser reaches disk over HTTP and node reaches it
 * directly. Everything above this line stays the same either way: the counting
 * of pending writes, the events, and the refusal to have a save button.
 */

/** Talk to the dev server. The transport the editor uses. */
export function overHTTP() {
  const j = async (url, options) => {
    const r = await fetch(url, options)
    const body = await r.json()
    if (!r.ok || body.error) throw new Error(body.error || r.statusText)
    return body
  }

  return {
    index: () => j('/api/index'),
    tree: () => j('/api/tree'),
    read: async path => (await j('/api/file?path=' + encodeURIComponent(path))).text,
    write: (path, text) => j('/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, text })
    })
  }
}

export function makeFiles(bus, transport = overHTTP()) {
  let writing = 0

  return {
    async index() { return transport.index() },
    async tree() { return transport.tree() },
    async read(path) { return transport.read(path) },

    async write(path, text) {
      writing++
      bus.emit('files:writing', { path, pending: writing })
      try {
        await transport.write(path, text)
        bus.emit('files:written', { path })
      } finally {
        writing--
        bus.emit('files:writing', { path, pending: writing })
      }
    },

    async writeJSON(path, value) { return this.write(path, JSON.stringify(value, null, 2)) },

    get pending() { return writing }
  }
}
