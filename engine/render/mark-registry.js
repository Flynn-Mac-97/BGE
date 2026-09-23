/**
 * Kernel: the per-entity mark registry.
 *
 * A mark draws beside one entity rather than by it — a keyline, a contact
 * shadow, a ground ring — and any plugin may add one. The three built-in marks
 * register through this same door, because a hook only the core can reach is
 * not a hook.
 *
 * The draw runs from the one place the entity sync writes a mark: the full
 * per-entity pass in `entity-sync.js`. The whole per-entity cost is the loop
 * below, so a world with no mark registered pays a length check and nothing
 * else, and no mark makes the core walk plugin objects it does not own.
 *
 * A mark is called for every mesh entity the sync visits, and decides for
 * itself whether that entity has one by reading the declaration and the record.
 */
import { reportOnce } from './report.js'

export function makeMarkRegistry(state) {
  /** The marks by name, in registration order. A re-registered name keeps its place. */
  const marks = new Map()

  /** The marks as a plain list, rebuilt only when the set changes. */
  let ordered = []

  function rebuild() {
    ordered = [...marks.values()]
  }

  const registry = {
    /**
     * Add or replace one mark under a name.
     *
     * `draw(entity, object, place, declared, record)` runs once per mesh entity
     * the sync visits. `record.shape`, `record.moved` and the entity's look
     * state are already written when it runs.
     */
    register(name, mark) {
      if (typeof name !== 'string' || !name || typeof mark?.draw !== 'function') {
        reportOnce(`[render] marks.register: needs a name and a draw function, got ${JSON.stringify(name)}`)
        return
      }
      marks.set(name, { name, draw: mark.draw })
      rebuild()
    },

    /** Drop the mark under this name, if there is one. */
    remove(name) {
      if (marks.delete(name)) rebuild()
    },

    has: name => marks.has(name),
    get names() { return [...marks.keys()] }
  }

  /**
   * Run every registered mark for one entity, in registration order.
   *
   * The list is walked in place: no allocation, no per-mark closure, and an
   * empty registry is a loop that never runs.
   */
  function drawMarks(entity, object, place, declared, record) {
    for (let i = 0; i < ordered.length; i++) {
      ordered[i].draw(entity, object, place, declared, record)
    }
  }

  state.marks = registry
  state.drawMarks = drawMarks
}
