/**
 * Kernel: the channel plugins talk through.
 * Deliberately tiny — if this grows, something belongs in a plugin instead.
 *
 * @returns {object} `on(event, listener)` returns its own unsubscribe;
 *   `emit(event, ...payload)` calls every listener for the event.
 */
export function makeBus() {
  const map = new Map()

  return {
    on(event, listener) {
      if (!map.has(event)) map.set(event, new Set())
      map.get(event).add(listener)
      return () => map.get(event)?.delete(listener)
    },

    emit(event, ...payload) {
      for (const listener of map.get(event) || []) {
        try {
          listener(...payload)
        } catch (error) {
          console.error(`[bus] listener for "${event}" threw`, error)
        }
      }
    }
  }
}
