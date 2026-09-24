/**
 * Install the image element three's texture loader asks the document for, so a
 * texture can be cached with no browser. The element never fires a load on its
 * own, so the caller fires it: `run` is handed an `images` controller whose
 * `loadAll` and `failAll` fire the events the loader is waiting for. A run that
 * only wants to cache a texture ignores the controller and leaves it loading.
 */
export function withImageDocument(run) {
  const saved = globalThis.document
  const images = []
  const makeImage = () => {
    const listeners = new Map()
    const image = {
      complete: false,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, [])
        listeners.get(type).push(handler)
      },
      removeEventListener(type, handler) {
        const list = listeners.get(type)
        if (list) list.splice(list.indexOf(handler), 1)
      },
      set src(value) {
        this._src = value
      },
      get src() {
        return this._src
      },
      // Not part of the DOM: the event the loader registered for, fired by hand.
      fire(type) {
        for (const handler of [...(listeners.get(type) || [])]) handler()
      }
    }
    images.push(image)
    return image
  }
  globalThis.document = { createElementNS: makeImage }
  const control = {
    get count() {
      return images.length
    },
    get last() {
      return images[images.length - 1]
    },
    loadAll() {
      for (const image of [...images]) image.fire('load')
    },
    failAll() {
      for (const image of [...images]) image.fire('error')
    }
  }
  try {
    return run(control)
  } finally {
    if (saved === undefined) delete globalThis.document
    else globalThis.document = saved
  }
}
