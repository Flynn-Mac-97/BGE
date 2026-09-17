/** Dispose embedded editors when the shell replaces their panel or the provider stops. */
export function createMounts(load) {
  const mounts = new Set()
  let loading, loaded, closed = false
  const ready = () => {
    if (closed) return Promise.reject(new Error('Editor plugin is disabled'))
    loading ||= load().then(value=>{loaded=value;return value}).catch(error => { loading = null; throw error })
    return loading.then(value => { if (closed) throw new Error('Editor plugin is disabled'); return value })
  }
  return {
    ready,
    create(options) {
      if (closed) throw new Error('Editor plugin is disabled')
      if (typeof document === 'undefined') throw new Error('This editor requires a browser')
      const element = document.createElement('div')
      element.className = options.className || 'editor-service'
      element.textContent = 'Loading editor…'
      let instance, disposed = false, attached = false
      const dispose = () => {
        if (disposed) return
        disposed = true; observer.disconnect(); instance?.dispose(); mounts.delete(dispose)
      }
      const observer = new MutationObserver(() => {
        if (element.isConnected) attached = true
        else if (attached) dispose()
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
      mounts.add(dispose)
      ready().then(library => {
        if (disposed) return
        element.replaceChildren()
        instance = library.mount(element, options)
      }).catch(error => {
        if (!disposed) { element.textContent = error.message; element.setAttribute('role', 'alert') }
      })
      return element
    },
    status: () => ({ loaded: !!loaded, mounts: mounts.size, closed }),
    dispose() { closed = true; for (const dispose of [...mounts]) dispose(); loaded?.dispose?.() }
  }
}
