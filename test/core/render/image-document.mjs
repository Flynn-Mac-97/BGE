/**
 * Install the image element three's texture loader asks the document for, so a
 * texture can be cached with no browser. The element never fires a load, so the
 * texture stays in the cache; only the cache keying is under test, not upload.
 */
export function withImageDocument(run) {
  const saved = globalThis.document
  globalThis.document = {
    createElementNS: () => ({
      complete: false,
      addEventListener() {},
      removeEventListener() {},
      set src(value) {
        this._src = value
      },
      get src() {
        return this._src
      }
    })
  }
  try {
    return run()
  } finally {
    if (saved === undefined) delete globalThis.document
    else globalThis.document = saved
  }
}
