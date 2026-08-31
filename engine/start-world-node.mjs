/**
 * Start a world in node — the same engine, with nothing drawing it.
 *
 * This is the parallel story. A world here needs no dev server, no port and no
 * browser tab, so many agents run one each and never touch the same mutable
 * thing. Two of them can simulate different levels at the same moment and
 * neither can see the other.
 *
 * It is deliberately the browser's twin and not its cousin: the same
 * `start-world.js`, the same plugins, the same `window.engine` surface. All
 * that differs is how the three outside things are reached — files come off
 * disk instead of over HTTP, plugins are found by reading a directory instead
 * of by a Vite glob, and project files are imported by path instead of by URL.
 *
 * What it cannot do is draw. There is no canvas, so no screenshot and no
 * picking. Everything else — play, simulate, tests, commands, hot reload of a
 * type — behaves exactly as it does on screen. `renderer: 'null'` adds the
 * renderer SURFACE with nothing behind it, so the draw-time commands run
 * instead of refusing; see `nullRenderer`.
 *
 * Which project it opens is a parameter, defaulting to `project`. It must be a
 * directory inside the checkout — see `startWorldInNode` at the bottom for why
 * a second root would be worse than one rule.
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

import { makeFiles } from './files.js'
import { importPlugin } from './plugin-import.js'
import { startWorld } from './start-world.js'
import { buildIndex, walk } from './project-index.mjs'
import { workLock } from './work-lock.mjs'

/** The repository, found from this file, so a world starts the same from any directory. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Reach the project directly rather than through the dev server.
 *
 * Writes rebuild the index, exactly as the server's POST handler does, so a
 * headless session that writes a level sees the new index on the next read.
 * Skipping that is how a world ends up acting on a project that no longer
 * exists.
 */
export function onDisk(projectDirectory) {
  const root = path.dirname(projectDirectory)
  const inside = rel => {
    const abs = path.resolve(projectDirectory, rel)
    // Same guard the dev server applies. A path that climbs out of the project
    // is a bug wherever it came from, and answering it quietly would make the
    // headless runner the weaker door.
    if (abs !== projectDirectory && !abs.startsWith(projectDirectory + path.sep)) {
      throw new Error(`path outside project: ${rel}`)
    }
    return abs
  }

  const insideAgent = (scope, rel) => {
    const base = scope === 'engine' ? root : scope === 'project' ? projectDirectory : null
    const clean = String(rel || '').replaceAll('\\', '/').replace(/^\.\//, '')
    const allowed = scope === 'engine'
      ? clean === 'AGENTS.md' || clean === 'ENGINE-BASE.md' || clean === 'ARCHITECTURE.md' || clean.startsWith('agents/') || clean.startsWith('docs/') || /^plugins\/builtin\/[^/]+\.agent\.md$/.test(clean)
      : clean.startsWith('agents/') || /^plugins\/[^/]+\.agent\.md$/.test(clean)
    if (!base || !allowed) throw new Error(`bad agent file path: ${scope}:${rel}`)
    const abs = path.resolve(base, clean)
    if (!abs.startsWith(base + path.sep)) throw new Error(`bad agent file path: ${scope}:${rel}`)
    return abs
  }

  const pluginSidecars = async () => {
    const game = JSON.parse(await fs.readFile(path.join(projectDirectory, 'game.json'), 'utf8').catch(() => '{}'))
    const disabled = new Set(game.plugins?.disabled || [])
    const places = [
      { scope: 'engine', directory: path.join(root, 'plugins/builtin'), prefix: 'plugins/builtin' },
      { scope: 'project', directory: path.join(projectDirectory, 'plugins'), prefix: 'plugins' }
    ]
    const found = []
    for (const place of places) {
      let names = []
      try { names = await fs.readdir(place.directory) } catch { continue }
      for (const name of names.filter(name => name.endsWith('.agent.md')).sort()) {
        const stem = name.slice(0, -'.agent.md'.length)
        const source = await fs.readFile(path.join(place.directory, `${stem}.js`), 'utf8').catch(() => '')
        const plugin = source.match(/export\s+default\s+\{[\s\S]*?\bname:\s*['"]([^'"]+)['"]/m)?.[1] || stem
        // A guide applies to its own plugin by default. A leading frontmatter
        // `match:` (space-separated paths) adds more — Plugin Master uses it to
        // ride along with every plugin task.
        const guide = await fs.readFile(path.join(place.directory, name), 'utf8').catch(() => '')
        const declared = guide.match(/^---\s*\n([\s\S]*?)\n---/)?.[1]
        const extra = declared?.match(/^match:\s*(.+)$/m)?.[1]?.trim().split(/\s+/).filter(Boolean) || []
        // A guide may declare its own trigger words (comma-separated) — the
        // same reading the dev server makes, or the two twins route
        // differently.
        const saidTriggers = declared?.match(/^triggers:\s*(.+)$/m)?.[1]?.split(',').map(word => word.trim().toLowerCase()).filter(Boolean) || []
        // Named from the project directory in use, not the literal `project`.
        // A guide whose match path points into the other project attaches to
        // tasks about a file that is not there, and never to the real one.
        const match = [...new Set([
          `${place.scope === 'project' ? path.basename(projectDirectory) + '/' : ''}${place.prefix}/${stem}.js`,
          ...extra
        ])]
        found.push({
          id: `plugin-${place.scope}-${stem}`, title: plugin, kind: 'instruction', parent: 'plugins',
          scope: place.scope, file: `${place.prefix}/${name}`,
          match,
          triggers: [...new Set([stem.replaceAll('-', ' '), plugin.toLowerCase(), ...saidTriggers])],
          enabled: !disabled.has(plugin), plugin
        })
      }
    }
    return found
  }

  return {
    index: () => buildIndex(projectDirectory),
    tree: async () => (await walk(projectDirectory))
      .filter(f => !f.startsWith('.engine'))
      .map(f => ({ path: f })),
    agentPlugins: pluginSidecars,
    read: rel => fs.readFile(inside(rel), 'utf8'),
    readAgent: (scope, rel) => fs.readFile(insideAgent(scope, rel), 'utf8'),
    async write(rel, text) {
      const abs = inside(rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      await buildIndex(projectDirectory)
    },
    async writeAgent(scope, rel, text) {
      const abs = insideAgent(scope, rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, text, 'utf8')
      if (scope === 'project') await buildIndex(projectDirectory)
    }
  }
}

/**
 * Every write this process refused, oldest first.
 *
 * A caller that swallows the rejection still has to fail: the CLI reads this
 * after the op and exits 1 when anything is in it.
 */
const refusedWrites = []

/** What the work lock refused in this process, oldest first. */
export function writesRefusedHere() {
  return refusedWrites.slice()
}

/**
 * Refuse every write while a lane holds the checkout.
 *
 * `vite.config.js` asks `permits` at the server's three doors. A headless world
 * reaches disk through none of them, so the same rule is registered here.
 *
 * The lock is read on every write, not once at start-up, so a run that ends
 * mid-session frees the checkout with nothing to reset. Reads never reach a
 * guard, so a locked checkout still answers every question.
 */
function refuseWritesWhileLanesWork(checkout) {
  return (file, scope) => {
    const lock = workLock(checkout)
    if (!lock.locked) return null
    refusedWrites.push({ file, scope, why: lock.why })
    return lock.why
  }
}

/**
 * Every plugin file, read from the directories rather than globbed.
 *
 * `import.meta.glob` is a Vite feature and is expanded at build time. Reading
 * the directory means a plugin written a second ago is found on the next start,
 * which is the same promise the index makes about types.
 */
async function findPlugins(root, projectDirectory, loader) {
  const places = [
    { directory: path.join(root, 'plugins/builtin'), builtin: true },
    { directory: path.join(projectDirectory, 'plugins'), builtin: false }
  ]
  const found = []

  for (const { directory, builtin } of places) {
    let names = []
    try { names = await fs.readdir(directory) } catch { continue }
    for (const name of names.sort()) {
      if (!name.endsWith('.js')) continue
      const file = path.join(directory, name)
      const definition = await importPlugin({
        // Relative to the checkout, so the report names a path the reader can
        // open.
        file: path.relative(root, file).replaceAll('\\', '/'),
        load: () => import(pathToFileURL(file).href),
        loader,
        builtin
      })
      if (definition) found.push({ definition, builtin })
    }
  }
  return found
}

/**
 * Import one file out of the project.
 *
 * The changing query is why a hot reload works here too: node caches a module
 * by URL forever, so re-importing the same path would hand back the version
 * read at start-up and a live edit would appear to do nothing.
 */
let fileVersion = 0
const importProjectFileFrom = projectDirectory => async file =>
  (await import(pathToFileURL(path.join(projectDirectory, file)).href + `?hot=${++fileVersion}`)).default || {}

/**
 * A canvas of a stated size holding no pixels.
 *
 * `see.capture` copies the drawn frame onto one of these and reads it back to
 * check the frame is not blank. Nothing drew, so every pixel is transparent and
 * that check answers blank — which is the truth. `toDataURL` throws rather than
 * hand back an image of nothing.
 */
function nullCanvas(width = 1, height = 1) {
  const blankPixels = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) })
  const pen = {
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    font: '', textAlign: 'left', textBaseline: 'top',
    drawImage() {},
    fillRect() {},
    fillText() {},
    measureText: () => ({ width: 0 }),
    beginPath() {}, lineTo() {}, closePath() {}, stroke() {},
    save() {}, restore() {},
    createImageData: (w, h) => blankPixels(w, h),
    putImageData() {},
    getImageData: (x, y, w, h) => blankPixels(w, h)
  }
  return {
    width, height,
    getContext: () => pen,
    toDataURL() { throw new Error('nothing drew this frame, so there is no image to encode') }
  }
}

/**
 * The renderer surface, with no GL behind it.
 *
 * `see.capture` and `see.moment` hold the See plugin's state-changing code —
 * camera borrow, hidden entities, nulled background and fog, dimmed lights, an
 * emptied post chain, an added light rig — and put every piece back in a
 * `finally`. With no renderer at all they refuse on the first line, so none of
 * that runs anywhere a headless test can reach it. This gives them the surface:
 * every mutation lands, every restore runs, and every readback is empty.
 *
 * `blank` is the flag a caller reads to say the frame is blank. Nothing here
 * may report a frame it did not draw.
 */
export function nullRenderer(view, viewport, shape) {
  const scene = {
    isScene: true,
    children: [],
    background: null,
    fog: null,
    add(object) {
      if (!scene.children.includes(object)) scene.children.push(object)
      return scene
    },
    remove(object) {
      const at = scene.children.indexOf(object)
      if (at >= 0) scene.children.splice(at, 1)
      return scene
    }
  }

  // One scene child per entity, so a pass that walks the scene graph — hiding
  // everything but its subject, dimming the lights — has real children to walk.
  const objects = new Map()
  const stats = { entities: 0, frames: 0, readbacks: 0, drawCalls: 0, triangles: 0 }
  let passList = []

  const frameSize = (width, height) => {
    viewport.width = Math.max(1, Math.round(width))
    viewport.height = Math.max(1, Math.round(height))
  }

  return {
    blank: true,
    view,
    scene,
    get size() { return { w: viewport.width, h: viewport.height } },
    get stats() { return { ...stats } },
    // No camera object, because nothing projects through one here. Headless
    // screen positions come from engine/camera-project.js and the view.
    camera: null,
    // No model is ever loaded, so a capture has nothing to wait for.
    modelState: () => null,
    shadowMap: { enabled: false },
    readability: { keyline: 0, contactShadow: false, groundRing: false },
    createCanvas: nullCanvas,

    resize() { frameSize(shape.width, shape.height) },
    frameSize,

    sync(world) {
      const live = new Set()
      for (const entity of world.entities) {
        live.add(entity.id)
        let object = objects.get(entity.id)
        if (!object) {
          object = { visible: true, userData: { entity: entity.id } }
          objects.set(entity.id, object)
          scene.add(object)
        }
        object.visible = !entity.hidden
      }
      for (const [id, object] of objects) {
        if (live.has(id)) continue
        objects.delete(id)
        scene.remove(object)
      }
      stats.entities = world.entities.length
    },

    draw() { stats.frames++ },

    /** Every pixel unwritten, which is what a draw that draws nothing leaves. */
    drawInto(target, buffer) {
      buffer.fill(0)
      stats.readbacks++
    },

    materials: { register() {}, has: () => false, get names() { return [] } },

    passes: {
      get list() { return [...passList] },
      set(list) { passList = Array.isArray(list) ? list.filter(Boolean) : [] }
    }
  }
}

/**
 * @param root     the checkout. The engine's own plugins and guides live here.
 * @param project  which directory inside it holds the game. `project` by
 *                 default, so a call that names nothing starts the world it
 *                 always started.
 * @param renderer `'null'` attaches the drawing surface described above.
 *                 Anything else leaves the world with no renderer, so the
 *                 draw-time commands refuse and name the headless verb that
 *                 answers instead — the right answer for an agent at a
 *                 terminal, and the wrong one for a test of the restore path.
 */
export async function startWorldInNode({ root = ROOT, project = 'project', viewport, renderer } = {}) {
  const checkout = path.resolve(root)
  const projectDirectory = path.resolve(checkout, project)

  // The project has to be a child of the checkout, and this says so out loud.
  // `onDisk` finds the engine root back from the project by taking its parent,
  // and every agent-file path is resolved against that — so a project anywhere
  // else would give two roots that can disagree, and the world would read its
  // own instructions out of the wrong tree while reading its levels from here.
  if (path.dirname(projectDirectory) !== checkout) {
    throw new Error(`project must be a directory directly inside ${checkout} — got ${projectDirectory}`)
  }

  return startWorld({
    openFiles: bus => {
      const files = makeFiles(bus, onDisk(projectDirectory))
      files.guardWrites(refuseWritesWhileLanesWork(checkout))
      return files
    },
    loadPlugins: loader => findPlugins(checkout, projectDirectory, loader),
    importProjectFile: importProjectFileFrom(projectDirectory),
    // The name, not the absolute path: a plugin builds `<project>/plugins` from
    // it, and the browser half only ever knows the name.
    projectDirectory: path.basename(projectDirectory),
    ...(viewport ? { viewport } : {}),
    // The same hook the browser mounts its shell and renderer through, so the
    // two halves attach a renderer at one point in the start-up order.
    ...(renderer === 'null'
      ? {
        attachScreen(context) {
          const shape = { width: context.viewport.width, height: context.viewport.height }
          context.shell = { canvas: nullCanvas(shape.width, shape.height), draw() {} }
          context.renderer = nullRenderer(context.view, context.viewport, shape)
        }
      }
      : {})
  })
}
