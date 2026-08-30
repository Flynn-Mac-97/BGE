/**
 * Kernel: the channel plugins talk through.
 * Deliberately tiny — if this grows, something belongs in a plugin instead.
 */
export function makeBus() {
  const map = new Map()

  return {
    on(event, fn) {
      if (!map.has(event)) map.set(event, new Set())
      map.get(event).add(fn)
      return () => map.get(event)?.delete(fn)
    },

    emit(event, ...payload) {
      for (const fn of map.get(event) || []) {
        try { fn(...payload) }
        catch (e) { console.error(`[bus] listener for "${event}" threw`, e) }
      }
    }
  }
}
