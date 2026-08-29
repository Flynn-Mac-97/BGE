/**
 * History — Photoshop's history palette, for the editor.
 *
 * An undoable step is moving an object, changing a value, or deleting one. The
 * palette lists the state after each step, Back and Forward walk it, and
 * clicking a row jumps several steps at once. Changing something after stepping
 * back throws the forward entries away, exactly as Photoshop does.
 *
 * It records SNAPSHOTS rather than commands, because there is no chokepoint to
 * record a command at. The Inspector writes `entity[key] = value` straight onto
 * the live entity and the Transform Tool mutates inside pointermove, so by the
 * time anything is announced the old value is already gone. `world.toLevel()` is
 * the one place that says what the world is, so that is what an entry holds.
 *
 * Two signals say an edit happened, and neither is enough on its own.
 * `world:changed` covers spawning, destroying, attaching and every Inspector
 * field — but a drag and an arrow nudge announce nothing at all, because the
 * Transform Tool only calls `context.save()`. `files:written` for the open level
 * covers those. Both funnel into one guarded capture, and a capture that finds
 * nothing different records nothing, so the overlap costs no entries.
 *
 * The recorder is off while the game plays and off in a simulated world.
 * `world:changed` fires for every bullet and every effect a round spawns, and a
 * palette full of bullets is worse than no palette.
 *
 * Session only, in memory. The level on disk is already the truth, so a journal
 * file would be a second copy of it that can disagree with the first.
 */

/**
 * How many steps are kept. Each one holds the whole level, so this is the memory
 * bound as well as the depth. On overflow the oldest step is dropped: the top of
 * the list stops being `Opened`, and the earliest state you can still reach
 * moves forward.
 */
const DEPTH = 50

/** Placement keys that mean the thing moved, rather than that a value changed. */
const PLACEMENT = ['at', 'rotation', 'scale']

/**
 * The palette. Module level so it survives a redraw, the same way the Plugin
 * Browser keeps what is selected. Named `palette` rather than `history` because
 * a module-level `history` would shadow the browser's own.
 */
const palette = {
  /** Which level these steps belong to. A different level is a different document. */
  level: null,
  /** [{ label, verb, touched, entities }] — oldest first, entities is the snapshot. */
  entries: [],
  /** Index of the entry the world is showing. Everything after it is undone. */
  current: -1,
  /** May the next change merge into the current entry, instead of adding one? */
  open: false
}

/** id -> { placement, json } for the entry the world is showing. */
let showing = new Map()

/**
 * True while a step is being put back. A restore emits `world:changed` and
 * writes the level, so without this the recorder would record its own work —
 * and rapid Ctrl+Z would start a second restore inside the first.
 */
let restoring = false

/**
 * True from `play:started` until `play:stopped`.
 *
 * `context.loop.running` is not enough, and the gap is not small. The kernel
 * emits `play:started` and runs every entity's `start` hook BEFORE it starts
 * the loop, and `world.simulated` is only set on the first fixed step — so for
 * the whole start-hook phase both of the obvious guards read false. A type
 * whose `start` spawns anything therefore filed one entry per spawn, and
 * stopping filed the mass delete: a dozen play cycles evicted every real edit,
 * and jumping onto one of those entries wrote runtime entities into the level
 * file. `simulate` runs start hooks the same way, so it sets this too.
 */
let playing = false

/**
 * True from `world.clear()` until the level that replaced it has loaded.
 *
 * A load emits `world:changed` before `level:loaded`, so the recorder saw the
 * reloaded world first and had already decided what it meant. That made
 * `afterLoad` unable to rule on a reload at all, and let a reopen of the same
 * level merge its revert into the entry it reverted. The load path owns this
 * decision; capture stays out of the way until it has made it.
 */
let loading = false

export default {
  name: 'History',
  about: 'Step back and forward through this session\'s edits, or click a row to jump several at once.',

  inspect: () => palette.entries.length
    ? [{
        title: 'History',
        rows: [
          ['step', `${palette.current + 1} of ${palette.entries.length}`],
          ['now', palette.entries[palette.current]?.label || '—'],
          ['kept', `last ${DEPTH} steps, in memory only`]
        ]
      }]
    : [],

  onLoad(context) {
    const record = () => capture(context)

    // Spawning, destroying, attaching, and every Inspector field.
    context.bus.on('world:changed', record)
    // A drag and an arrow nudge announce nothing else — the Transform Tool
    // mutates the entity and calls context.save(), and this is that save.
    context.bus.on('files:written', ({ path }) => {
      if (path === `levels/${context.level()}.json`) record()
    })
    // Opening a level is opening a document. Pressing play and stopping again
    // also lands here, and that one keeps the palette — see afterLoad.
    // world.clear() announces itself for a level load AND for a step being put
    // back. Only the load is a document arriving; a restore is already guarded,
    // and treating it as a load would leave this set with no level:loaded ever
    // coming to clear it — after which nothing is ever recorded again.
    context.bus.on('world:cleared', () => { if (!restoring) loading = true })
    context.bus.on('level:loaded', () => { loading = false; afterLoad(context) })
    // Play begins before the loop does: the start hooks run first, and anything
    // they spawn would otherwise be filed as an edit.
    context.bus.on('play:started', () => { playing = true })
    context.bus.on('play:stopped', () => { playing = false })
    // Selecting something else ends the run of merged steps, so clicking away
    // and back gives the next move an entry of its own.
    context.bus.on('selection:changed', () => { palette.open = false })
  },

  panels: [{
    id: 'history',
    title: 'History · step',
    dock: 'right',
    order: 20,

    actions: [
      { label: 'Back', title: 'Step back (ctrl+z)', run: context => drive(context, 'history.undo') },
      { label: 'Forward', title: 'Step forward (ctrl+shift+z)', run: context => drive(context, 'history.redo') }
    ],

    render(ui, context) {
      if (!palette.entries.length) return ui.empty('nothing recorded yet — the palette fills as you edit')

      const rows = palette.entries.map((entry, index) => ({ index, entry }))

      return ui.stack([
        ui.list({
          items: rows,
          key: row => row.index,
          // Strict equality against key(row), so the current step is the one row
          // marked — no colour is spent saying it.
          selected: palette.current,
          dim: row => row.index > palette.current,
          row: ({ index, entry }) => [
            ui.glyph(index === palette.current ? '▸' : '·', { strong: index === palette.current }),
            ui.label(entry.label),
            ui.spacer(),
            ui.meta(String(entry.entities.length))
          ],
          onPick: row => drive(context, 'history.jump', row.index)
        }),
        ui.text(
          `step ${palette.current + 1} of ${palette.entries.length} · last ${DEPTH} kept, this session only`,
          { dim: true }
        )
      ])
    }
  }],

  commands: [
    {
      id: 'history.undo',
      label: 'Step back',
      key: 'ctrl+z',
      run: context => step(context, -1)
    },
    {
      id: 'history.redo',
      label: 'Step forward',
      key: 'ctrl+shift+z',
      run: context => step(context, 1)
    },
    {
      id: 'history.jump',
      label: 'Jump to a step',
      // args: the index shown by history.list
      run: (context, index) => go(context, index)
    },
    {
      id: 'history.list',
      label: 'List the recorded steps',
      run: () => ({
        level: palette.level,
        current: palette.current,
        depth: DEPTH,
        entries: palette.entries.map((entry, index) => ({
          index,
          label: entry.label,
          entities: entry.entities.length,
          ...(index === palette.current ? { current: true } : {}),
          ...(index > palette.current ? { undone: true } : {})
        }))
      })
    },
    {
      id: 'history.clear',
      label: 'Forget the recorded steps',
      run: context => {
        const dropped = palette.entries.length
        const baseline = reset(context)
        return { cleared: dropped, now: baseline.label }
      }
    }
  ]
}

// ------------------------------------------------------------------ recording
/**
 * What the world is, as placements with their ids.
 *
 * `toLevel` walks `world.entities` in order, so the two line up index by index.
 * The id is carried beside the placement rather than inside it: a placement that
 * names its own id would be written back into the level file on the next save,
 * quietly giving every entity an explicit id it never had.
 */
const snapshotOf = world => {
  const level = world.toLevel(null)
  return world.entities.map((entity, index) => ({ id: entity.id, placement: level.entities[index] }))
}

/** The same snapshot, keyed for comparison. Serialised once, here, per capture. */
const markOf = entities =>
  new Map(entities.map(entity => [entity.id, { placement: entity.placement, json: JSON.stringify(entity.placement) }]))

/** Whether two placements differ only in where the thing is. */
function movedOnly(before, after) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    if (!PLACEMENT.includes(key)) return false
  }
  return true
}

/**
 * What one snapshot says that the other does not: a verb and the ids it touched.
 *
 * Null when they say the same thing, which is what makes two signals for one
 * edit cost one entry — and what stops a level reload from recording itself.
 */
function whatChanged(before, after) {
  const added = [], removed = [], changed = []
  for (const [id, mark] of after) {
    const was = before.get(id)
    if (!was) added.push(id)
    else if (was.json !== mark.json) changed.push(id)
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id)
  if (!added.length && !removed.length && !changed.length) return null

  // The verb is the one thing that happened, or 'edited' when several did.
  const none = (a, b) => !a.length && !b.length
  const verb =
    none(removed, changed) ? 'added'
    : none(added, changed) ? 'deleted'
    : none(added, removed)
      ? (changed.every(id => movedOnly(before.get(id).placement, after.get(id).placement)) ? 'moved' : 'changed')
      : 'edited'

  return { verb, touched: [...added, ...removed, ...changed].sort() }
}

const named = touched => (touched.length === 1 ? touched[0] : `${touched.length} entities`)
const labelFor = change => `${change.verb[0].toUpperCase()}${change.verb.slice(1)} ${named(change.touched)}`
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index])

/**
 * Record a step, if anything actually changed.
 *
 * Consecutive changes with the same verb on the same entities merge into one
 * entry, so thirty arrow-key nudges are one `Moved crate-1` rather than thirty —
 * the Transform Tool saves the whole level on every keydown and auto-repeat
 * makes that a stream. There is no gesture boundary to use instead: the editor
 * has no clock outside play, and no tool says when a drag began. What ends a run
 * is a different entity, a different verb, a new selection, a step back, or a
 * level load.
 */
function capture(context) {
  if (restoring) return null
  // A round spawns hundreds of bullets and each one announces itself. Recording
  // during play would bury every real edit under them. All three checks are
  // needed: `playing` covers the start-hook phase, before the loop is running
  // and before the first fixed step has set `simulated`.
  if (playing || context.loop.running || context.world.simulated) return null
  // A level being torn down and rebuilt is not an edit. world.clear() announces
  // itself before the replacement entities arrive, and without this the reload's
  // own difference merged into the entry it was reverting — so the step labelled
  // "Moved crate-1" came to record not moving it.
  if (loading) return null
  // A different level is a different document, and the first change after a load
  // would otherwise be recorded as the difference between two levels.
  if (palette.level !== context.level()) return reset(context)

  const entities = snapshotOf(context.world)
  const marks = markOf(entities)
  const change = whatChanged(showing, marks)
  if (!change) return null

  // Photoshop's rule: a new step after stepping back drops the forward ones.
  if (palette.current < palette.entries.length - 1) palette.entries.length = palette.current + 1

  const top = palette.entries[palette.current]
  if (palette.open && top && top.verb === change.verb && sameIds(top.touched, change.touched)) {
    top.entities = entities
  } else {
    palette.entries.push({ ...change, label: labelFor(change), entities })
    palette.current = palette.entries.length - 1
    // Bounded, or one session of nudging holds every state the level ever had.
    while (palette.entries.length > DEPTH) {
      palette.entries.shift()
      palette.current--
    }
  }

  palette.open = true
  showing = marks
  context.redraw()
  return palette.entries[palette.current]
}

/** Start again from the world as it is now. */
function reset(context) {
  const entities = snapshotOf(context.world)
  palette.level = context.level()
  palette.entries = [{ verb: 'opened', touched: [], label: `Opened ${palette.level}`, entities }]
  palette.current = 0
  palette.open = false
  showing = markOf(entities)
  context.redraw()
  return palette.entries[0]
}

/**
 * A level finished loading. This is the only thing that decides what a reload
 * meant — capture is held off from `world:cleared` until here, because the load
 * emits `world:changed` first and the recorder would otherwise have ruled on it
 * before this ran.
 *
 * Pressing play and stopping again reloads the level, and the level on disk is
 * what the current step already says — so the palette survives a play rather
 * than being thrown away by it.
 *
 * Anything else that reloads is a document arriving: a different level, or the
 * same level edited underneath us by another writer. Photoshop files a Revert as
 * its own step rather than folding it into the one being reverted, and so does
 * this — otherwise the entry labelled "Moved crate-1" comes to record not
 * moving it, and the edit is unreachable in both directions.
 */
function afterLoad(context) {
  if (palette.level !== context.level()) return reset(context)

  const entities = snapshotOf(context.world)
  const marks = markOf(entities)
  const change = whatChanged(showing, marks)
  if (!change) {
    // A play and stop. Nothing moved, so there is nothing to file.
    palette.open = false
    context.redraw()
    return palette.entries[palette.current]
  }

  // The file changed under us. File it as its own step, never merged into the
  // one before it, and leave it reachable in both directions.
  if (palette.current < palette.entries.length - 1) palette.entries.length = palette.current + 1
  palette.entries.push({ ...change, label: `Reloaded ${palette.level}`, entities })
  palette.current = palette.entries.length - 1
  while (palette.entries.length > DEPTH) {
    palette.entries.shift()
    palette.current--
  }
  palette.open = false
  showing = marks
  context.redraw()
  return palette.entries[palette.current]
}

// ------------------------------------------------------------------ stepping
/** One step back or forward, with a named reason when there is nowhere to go. */
function step(context, direction) {
  const wanted = palette.current + direction
  if (palette.entries.length && (wanted < 0 || wanted >= palette.entries.length)) {
    return {
      skipped: direction < 0 ? 'at the oldest step' : 'at the newest step',
      why: `on step ${palette.current} of ${palette.entries.length - 1}`
    }
  }
  return go(context, wanted)
}

/**
 * Put the world back to one recorded step.
 *
 * Rebuilt rather than reloaded: `editor.loadLevel` reads from disk and refuses
 * once the world has been simulated, so it can only ever hand back the newest
 * step, which is the one you already have.
 */
async function go(context, index) {
  // Two fast presses, or a double-clicked Back button, both reach here while
  // the previous step is still being written. The extra call is dropped rather
  // than started inside the restore it would corrupt. Not auto-repeat: the
  // shell drops a repeating key before any shortcut is looked up.
  if (restoring) return { skipped: 'busy', why: 'a step is still being written to disk' }
  // Stopping play reloads the level, so an undo now would be thrown away a
  // moment later — after it had written a mid-round world over the level file.
  // `playing` as well as the loop, because the start hooks run before it.
  if (playing || context.loop.running) return { skipped: 'playing', why: 'stop play first — stopping reloads the level' }
  if (!palette.entries.length) return { skipped: 'empty', why: 'nothing recorded yet' }

  const wanted = Math.round(Number(index))
  if (!Number.isFinite(wanted) || wanted < 0 || wanted >= palette.entries.length) {
    return { skipped: 'no such step', why: `steps run 0 to ${palette.entries.length - 1}, asked for ${index}` }
  }
  if (wanted === palette.current) {
    return { at: wanted, label: palette.entries[wanted].label, already: 'showing this step' }
  }

  const entry = palette.entries[wanted]
  restoring = true
  try {
    putBack(context, entry.entities)
    context.bus.emit('world:changed')
    // The level on disk follows the palette, or the next reload undoes the undo.
    await context.save()
  } finally {
    restoring = false
  }

  palette.current = wanted
  palette.open = false
  showing = markOf(entry.entities)
  // A step that deletes something leaves its id in the selection, and the status
  // line reads the selection raw — so it would name an entity that is not there.
  context.editor.select([...context.editor.selection].filter(id => context.world.byId(id)))
  context.redraw()
  return { at: wanted, label: entry.label, entities: entry.entities.length }
}

/**
 * Clear the world and spawn the snapshot back into it.
 *
 * The id is written after the spawn rather than passed in, exactly as
 * `loadLevel` does it, so an entity keeps the id it had — an agent that noted
 * `crate-3` an hour ago still means the same crate after an undo.
 */
function putBack(context, entities) {
  context.world.clear()
  for (const { id, placement } of entities) {
    context.world.spawn(placement.type, placement).id = id
  }
}

/**
 * Run one of our own commands the way a button has to: the same path the
 * terminal takes, the failure named, the redraw after it settles rather than
 * before. Stepping is async because it writes the level.
 */
function drive(context, id, argument) {
  let running
  try {
    running = context.run(id, argument)
  } catch (error) {
    console.error(`[history] ${id} failed —`, error)
    context.redraw()
    return
  }
  Promise.resolve(running)
    .catch(error => console.error(`[history] ${id} failed —`, error))
    .finally(() => context.redraw())
}
