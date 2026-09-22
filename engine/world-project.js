/**
 * Kernel: the project's types, behaviours and levels, and play mode.
 *
 * These were functions inside `start-world.js`, closed over the boot's locals.
 * They take what they read and write in one `parts` object, named at the call
 * site, so the same functions serve a world with a screen and one without.
 *
 * A level's raw file is kept in `levelFile` on `parts`: a save writes back keys
 * the kernel does not model, and only the file that was read knows them.
 */
import { round3 } from './round3.js'

/**
 * Import every type and behaviour the index names.
 *
 * Behaviours load before types, because a type's attachment list is resolved
 * the moment the type registers. The other order reports every attachment as
 * missing on a sound project. One bad file is logged and skipped, so it cannot
 * stop the rest of the project loading.
 *
 * @param {object} parts The world, editor and importer this reads.
 * @returns {Promise<void>}
 */
export async function loadTypes({ world, editor, importProjectFile }) {
  world.behaviours.clear()
  for (const [name, behaviour] of Object.entries(editor.index.behaviours || {})) {
    try {
      world.registerBehaviour(name, await importProjectFile(behaviour.file))
    } catch (e) {
      console.error(`[behaviours] ${name} failed`, e)
    }
  }

  world.types.clear()
  for (const [name, type] of Object.entries(editor.index.types)) {
    try {
      world.registerType(name, await importProjectFile(type.file))
    } catch (e) {
      console.error(`[types] ${name} failed`, e)
    }
  }
}

/**
 * Re-import one type and bring its live entities onto the new definition.
 *
 * @param {object} parts The world, editor, files, importer and bus this writes through.
 * @param {string} name The type name.
 * @returns {Promise<object>} How many entities moved, or that the type is gone.
 * @throws Whatever the imported file did wrong.
 */
export async function reloadType({ world, editor, files, importProjectFile, bus }, name) {
  editor.index = await files.index()
  const entry = editor.index.types[name]
  if (!entry) {
    world.unregisterType(name)
    return { name, removed: true }
  }
  const moved = world.retype(name, await importProjectFile(entry.file))
  bus.emit('world:changed')
  return { name, entities: moved }
}

/**
 * The same, for a behaviour. Every entity that attached it moves onto the
 * new file.
 *
 * @param {object} parts The world, editor, files, importer and bus this writes through.
 * @param {string} name The behaviour name.
 * @returns {Promise<object>} How many entities moved, or that the behaviour is gone.
 */
export async function reloadBehaviour({ world, editor, files, importProjectFile, bus }, name) {
  editor.index = await files.index()
  const entry = (editor.index.behaviours || {})[name]
  if (!entry) {
    world.unregisterBehaviour(name)
    return { name, removed: true }
  }
  const moved = world.rebehave(name, await importProjectFile(entry.file))
  bus.emit('world:changed')
  return { name, entities: moved }
}

/**
 * Open one level: reset the clock, place every entity, and announce it.
 *
 * Ids are position-in-file rather than a counter, so `coin-2` means the same
 * coin after a reload. The raw file is kept for `saveLevel`, which must write
 * back keys the kernel does not model.
 *
 * @param {object} parts The world, loop, bus, editor, view, files and level holder this writes through.
 * @param {string} name The level name, without its directory or extension.
 * @returns {Promise<void>}
 */
export async function loadLevel({ world, loop, bus, editor, view, files, levelFile }, name) {
  const raw = JSON.parse(await files.read(`levels/${name}.json`))
  levelFile.raw = raw
  world.clear()
  // Clock, schedule and random stream all go back to zero together, so loading
  // a level is a clean starting point rather than "wherever the last run left
  // the clock". Without this, two simulate() runs differ by their history.
  loop.reset(raw.seed)
  editor.levelName = name
  editor.selection.clear()

  if (raw.camera) {
    view.x = raw.camera.at?.[0] ?? view.x
    view.y = raw.camera.at?.[1] ?? view.y
    view.z = raw.camera.at?.[2] ?? view.z
    view.zoom = raw.camera.zoom ?? view.zoom
    // `mode` is deliberately NOT copied here. The level's camera block is the
    // GAME camera — where the player looks while playing — and the game camera
    // plugin adopts it on play and hands it back on stop. Copying it at load
    // put the editor inside a first-person camera standing in a wall the
    // moment you opened a 3D level, and a black viewport is the worst thing
    // this engine can show.
    view.mode = 'ortho'
    view.fov = raw.camera.fov ?? view.fov
    view.yaw = raw.camera.yaw ?? view.yaw
    view.pitch = raw.camera.pitch ?? view.pitch
  }
  // Ids are position-in-file, not a counter, so `coin-2` means the same coin
  // after a reload. An agent that noted an id an hour ago can still use it.
  const seen = {}
  for (const p of raw.entities || []) {
    const e = world.spawn(p.type, p)
    if (!p.id) e.id = `${p.type}-${seen[p.type] = (seen[p.type] ?? -1) + 1}`
  }

  bus.emit('world:changed')
  // The camera rule rides along, because the kernel has already paid to parse
  // the file: a listener that re-read it from disk lost the race against a
  // one-shot headless run, which booted, played and simulated inside the read
  // and spent the whole run behind the editor's ortho view.
  bus.emit('level:loaded', name, raw.camera || {}, raw)
}

/**
 * Write the open level back to disk with the entities' start positions,
 * or refuse when writing would corrupt it.
 *
 * A level records starting positions. Once the simulation has run, the world
 * holds where things ended up, so writing it back would quietly replace the
 * level with a freeze-frame of a playthrough. Refuse, and say how to get back.
 *
 * @param {object} parts The world, loop, editor, view, files and level holder this reads.
 * @param {object} [options]
 * @param {boolean} [options.naming] Write an untitled project out under the name it just took.
 * @returns {Promise<object>} The path written, or why the save was skipped.
 */
export async function saveLevel({ world, loop, editor, view, files, levelFile }, { naming = false } = {}) {
  // A page a lane opened to render in is a viewer: its world is its own, and
  // the checkout is shared. Checked before every other reason, because this
  // one is about who is asking rather than about what the world holds.
  if (globalThis.__engineViewer) {
    console.warn('[save] skipped — this page renders for a lane and never writes the checkout.')
    return { skipped: 'viewer' }
  }
  // The untitled project is scratch. Edits stay in the page, so a reload
  // drops them and nothing has to be undone. `project.saveAs` passes
  // `naming` to write them out as the project takes a name.
  if (editor.projectUntitled && !naming) {
    return { skipped: 'untitled', why: 'edits are held until the project is named — run project.saveAs <name> to keep them' }
  }
  if (world.simulated) {
    console.warn('[save] skipped — the world has been simulated, so it no longer holds start positions. Stop play mode (or engine.stop()) to reload the level first.')
    return { skipped: 'simulated' }
  }
  // A run is not an edit. Between pressing play and the first step the world
  // still holds start positions, so `simulated` is false and a save would go
  // through — rewriting the whole file, including a generated level, in the
  // editor's own formatting.
  if (loop.running) {
    console.warn('[save] skipped — the world is playing. Stop play mode first; a run is not an edit.')
    return { skipped: 'playing' }
  }
  // The editor's viewport is not the game's camera rule. In first person the
  // level says where the player looks from; overwriting that with wherever the
  // editor happened to be pointing would break the level by looking at it.
  // `mode` is the GAME's rule and is never written from here. The editor
  // always opens a level in ortho — that is what makes a 3D level editable —
  // so writing the editor's mode back turned every save of a first-person
  // level into a save that quietly demoted it to a flat one, and the only
  // symptom was pressing play and getting the 2D camera.
  const { mode, ...rule } = levelFile.raw.camera || {}
  const camera = { ...rule, ...(mode ? { mode } : {}) }
  // The same argument, one key further: in a perspective editor view (the 3D
  // fly camera) view.x/y is where the author is LOOKING FROM, not where the
  // game camera should sit — writing it into `at` would move every future
  // play start to wherever the author happened to be flying. The flat view's
  // position is the only editor position that is also a level position.
  if (view.mode === 'ortho') {
    camera.at = [round3(view.x), round3(view.y)]
    camera.zoom = round3(view.zoom)
  }
  const level = { ...levelFile.raw, ...world.toLevel(camera) }
  await files.writeJSON(`levels/${editor.levelName}.json`, level)
  return { saved: `levels/${editor.levelName}.json` }
}

/**
 * Start or stop play mode on the open level.
 *
 * @param {object} parts The world, loop, bus, editor and context this writes through.
 * @returns {void}
 */
export function togglePlay(parts) {
  const { world, loop, bus, editor, context } = parts
  if (loop.running) {
    loop.stop()
    // Announced before the level reloads, so a plugin can put back whatever
    // it borrowed — the camera restores the editor's viewport here.
    bus.emit('play:stopped')
    loadLevel(parts, editor.levelName)
  } else {
    // Before the start hooks, so a plugin is listening when a hook spawns.
    // `loop.running` is therefore FALSE inside a `play:started` handler — a
    // handler that tests it does nothing at all. Hold, subscribe or schedule;
    // never gate on `running` here.
    bus.emit('play:started')
    for (const e of [...world.entities]) world.hook(e, 'start', context)
    loop.start()
  }
  bus.emit('plugins:changed')
}
