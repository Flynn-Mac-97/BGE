/**
 * Kernel: the named regions a plugin can mount DOM into.
 *
 * `shell.js` builds the frame and owns the region elements. Which DOM is in a
 * region, in what order, and when it leaves is a separate concern: this module
 * knows where a thing goes and when it leaves, never what the thing is. It is
 * the DOM counterpart of the renderer's pass graph: one ordered list, and a
 * slot only says where it goes.
 *
 * A mount writes to the DOM only when the set changes, never on a frame, and a
 * region with nothing mounted costs no work at all.
 */
import { makeOnceReporter } from './report-once.js'

const { report: reportOnce } = makeOnceReporter()

/**
 * Build the region registry over the elements that host them.
 *
 * @param {object} hosts One element per region name. Only the regions the shell
 *   built are mountable.
 * @returns {object} `names`, `mount`, `unmount`, `clear` and `sweep`.
 */
export function makeRegions(hosts) {
  // One entry per mounted element, keyed by the element itself, so mounting the
  // same element again moves it rather than adding it twice.
  const entries = new Map()
  let sequence = 0

  /** The entries of one region, lower order first, ties in registration order. */
  function orderedFor(region) {
    return [...entries.values()]
      .filter(entry => entry.region === region)
      .sort((left, right) => left.order - right.order || left.sequence - right.sequence)
  }

  /** Put one entry where its order belongs, moving only that element. */
  function place(entry) {
    const host = hosts[entry.region]
    if (!host) return
    const ordered = orderedFor(entry.region)
    const next = ordered[ordered.indexOf(entry) + 1]
    if (next) host.insertBefore(entry.element, next.element)
    else host.append(entry.element)
  }

  /** Take one element out of its region. False when it was not mounted. */
  function unmount(element) {
    const entry = entries.get(element)
    if (!entry) return false
    entries.delete(element)
    const host = hosts[entry.region]
    // Another plugin may have rewritten the host's children, so only remove what
    // is still there and never throw over a mount that is already gone.
    if (host && element.parentNode === host) host.removeChild(element)
    return true
  }

  return {
    /** The region names a mount may name. */
    names: Object.keys(hosts),

    /**
     * Put an element in a region.
     *
     * Lower `order` first, ties in the order they were mounted. Mounting the
     * same element again moves it. `plugin` names the owner so `sweep` can drop
     * it when that plugin is disabled.
     *
     * @returns {{ element: object, unmount: Function }|null} The handle, or null
     *   when the region or the element is missing.
     */
    mount(region, element, { order = 50, plugin = null } = {}) {
      if (!hosts[region]) {
        reportOnce(
          `[shell] regions.mount: no region called ${JSON.stringify(region)} — one of ${Object.keys(hosts).join(', ')}`
        )
        return null
      }
      if (!element) {
        reportOnce('[shell] regions.mount: needs a DOM element')
        return null
      }
      const existing = entries.get(element)
      if (existing) {
        existing.region = region
        existing.order = order
        existing.plugin = plugin
      } else {
        entries.set(element, { region, element, order, sequence: sequence++, plugin })
      }
      place(entries.get(element))
      return { element, unmount: () => unmount(element) }
    },

    /** Take an element out of whatever region holds it. */
    unmount,

    /** Empty one region. */
    clear(region) {
      for (const entry of [...entries.values()]) if (entry.region === region) unmount(entry.element)
    },

    /** Drop every mount whose plugin `isActive` no longer reports true. */
    sweep(isActive) {
      for (const entry of [...entries.values()]) {
        if (entry.plugin && !isActive(entry.plugin)) unmount(entry.element)
      }
    }
  }
}
