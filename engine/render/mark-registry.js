/**
 * Kernel: the per-entity mark registry.
 *
 * A mark draws beside one entity rather than by it — a keyline, a contact
 * shadow, a ground ring — and any plugin may add one. A plugin's marks register
 * through this same door, because a hook only the core can reach is not a hook.
 *
 * `draw` runs from the one place the entity sync writes a mark: the full
 * per-entity pass in `entity-sync.js`. The whole per-entity cost is the loop
 * below, so a world with no mark registered pays a length check and nothing
 * else.
 *
 * A mark may carry more than `draw`. A mark that accumulates the frame needs
 * `begin`, `grow` and `place`; one that draws a mark the scans can count needs
 * to say when the entity must take the full pass (`holds`, `holdsMoving`) or
 * which entity its rule holds (`heldId`); one whose default changed needs
 * `changed`; one that owns a declaration that forbids merging needs
 * `blocksMerge`; one with a cache keyed on a file needs `forget`. Each is
 * optional, and the core walks them by name, so it never learns what a keyline
 * or a ring is.
 *
 * A mark is called for every mesh entity the sync visits and decides for itself
 * whether that entity has one, by reading the declaration and the record.
 */
import { reportOnce } from './report.js'

/** Build the mark registry and write its methods onto `state`. */
export function makeMarkRegistry(state) {
  /** The marks by name, in registration order. A re-registered name keeps its place. */
  const marks = new Map()

  /** The marks as a plain list, rebuilt only when the set changes. */
  let ordered = []

  /**
   * Whether any registered mark answers a per-entity question, so the hot loops
   * skip the walk entirely when nothing does.
   */
  let anyHolds = false
  let anyHoldsMoving = false
  let anyBlocksMerge = false

  function rebuild() {
    ordered = [...marks.values()]
    anyHolds = ordered.some(mark => mark.holds)
    anyHoldsMoving = ordered.some(mark => mark.holdsMoving)
    anyBlocksMerge = ordered.some(mark => mark.blocksMerge)
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
      marks.set(name, {
        name,
        draw: mark.draw,
        begin: mark.begin,
        grow: mark.grow,
        move: mark.move,
        place: mark.place,
        count: mark.count,
        holds: mark.holds,
        holdsMoving: mark.holdsMoving,
        heldId: mark.heldId,
        changed: mark.changed,
        blocksMerge: mark.blocksMerge,
        forget: mark.forget
      })
      rebuild()
    },

    /** Drop the mark under this name, if there is one. */
    remove(name) {
      if (marks.delete(name)) rebuild()
    },

    has: name => marks.has(name),
    get names() {
      return [...marks.keys()]
    }
  }

  /**
   * Run every registered mark for one entity, in registration order.
   *
   * The list is walked in place: no allocation, no per-mark closure, and an
   * empty registry is a loop that never runs.
   */
  function drawMarks(entity, object, place, declared, record) {
    for (let index = 0; index < ordered.length; index++) {
      ordered[index].draw(entity, object, place, declared, record)
    }
  }

  /** Start a frame's marks: reset whatever the marks accumulated last frame. */
  function beginMarks() {
    for (let index = 0; index < ordered.length; index++) ordered[index].begin?.()
  }

  /** Reserve room for one mark per entity, before the walk notes any. */
  function growMarks(count) {
    for (let index = 0; index < ordered.length; index++) ordered[index].grow?.(count)
  }

  /** Let the marks re-note a moved entity the fast path placed without a draw. */
  function moveMarks(entity, declared, shape, place) {
    for (let index = 0; index < ordered.length; index++) ordered[index].move?.(entity, declared, shape, place)
  }

  /** Write the frame's marks into what they draw. Called once, after the walk. */
  function placeMarks() {
    for (let index = 0; index < ordered.length; index++) ordered[index].place?.()
  }

  /** Let each mark write its own counters onto `stats`. */
  function writeMarkStats(stats) {
    for (let index = 0; index < ordered.length; index++) ordered[index].count?.(stats)
  }

  /** Whether any mark must visit this entity on a still frame. */
  function holdsMark(entity, declared) {
    if (!anyHolds) return false
    for (let index = 0; index < ordered.length; index++) {
      if (ordered[index].holds?.(entity, declared)) return true
    }
    return false
  }

  /** Whether any mark must visit this entity on a frame that only moved it. */
  function holdsMovingMark(entity, declared) {
    if (!anyHoldsMoving) return false
    for (let index = 0; index < ordered.length; index++) {
      if (ordered[index].holdsMoving?.(entity, declared)) return true
    }
    return false
  }

  /** The entity id a mark's rule holds, so the scans never skip it. */
  function markHeldId(view) {
    for (let index = 0; index < ordered.length; index++) {
      const id = ordered[index].heldId?.(view)
      if (id != null) return id
    }
    return null
  }

  /** Whether a mark's own default changed, forcing one full pass. */
  function marksChanged() {
    for (let index = 0; index < ordered.length; index++) {
      if (ordered[index].changed?.()) return true
    }
    return false
  }

  /** Whether a declaration a mark owns keeps this entity out of every batch. */
  function markBlocksMerge(declared) {
    if (!anyBlocksMerge) return false
    for (let index = 0; index < ordered.length; index++) {
      if (ordered[index].blocksMerge?.(declared)) return true
    }
    return false
  }

  /** Drop a mark's caches for an edited file. */
  function forgetMarks(file) {
    for (let index = 0; index < ordered.length; index++) ordered[index].forget?.(file)
  }

  state.marks = registry
  state.drawMarks = drawMarks
  state.beginMarks = beginMarks
  state.growMarks = growMarks
  state.moveMarks = moveMarks
  state.placeMarks = placeMarks
  state.writeMarkStats = writeMarkStats
  state.holdsMark = holdsMark
  state.holdsMovingMark = holdsMovingMark
  state.markHeldId = markHeldId
  state.marksChanged = marksChanged
  state.markBlocksMerge = markBlocksMerge
  state.forgetMarks = forgetMarks
}
