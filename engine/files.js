/**
 * Kernel: the only writer to disk.
 *
 * There is no save button anywhere in the editor — every edit lands here
 * immediately, which is what lets the status bar state "saved" unconditionally.
 */
export function makeFiles(bus) {
  const j = async (url, options) => {
    const r = await fetch(url, options)
    const body = await r.json()
    if (!r.ok || body.error) throw new Error(body.error || r.statusText)
    return body
  }

  let writing = 0

  return {
    async index() { return j('/api/index') },
    async tree() { return j('/api/tree') },

    async read(path) { return (await j('/api/file?path=' + encodeURIComponent(path))).text },

    async write(path, text) {
      writing++
      bus.emit('files:writing', { path, pending: writing })
      try {
        await j('/api/file', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path, text })
        })
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
