/**
 * Kernel: one GL context, one draw order.
 *
 * 2D is an orthographic camera looking down -Z at textured planes. 3D is the
 * same scene with a perspective camera — the same entity list, the same texture
 * cache, the same picking. An entity carrying `sprite` draws as a plane and an
 * entity carrying `mesh` draws as solid geometry, a list of `parts` or a loaded
 * model, and one level may hold all of them.
 *
 * The sprite and solid paths differ in exactly three places, and each is a
 * decision rather than an accident: geometry (a cached box or quad against one
 * shared plane), material (lit and opaque against unlit and painter-ordered),
 * and texture filtering (mipmapped and anisotropic against nearest-neighbour —
 * what keeps pixel art crisp is exactly what turns a floor into shimmering
 * noise).
 *
 * A loaded model is addressable by node name, because its file said what those
 * nodes are called: `pose` rotates one and `attachments` hangs another model off
 * one. Both are declarations read on sync rather than calls, for the same reason
 * animation is assignment — a hook can say what a body IS holding without
 * tracking what it WAS holding.
 *
 * The draw order is two passes: the world, then the viewmodel against a cleared
 * depth buffer through a narrower camera of its own. That second pass is the
 * only correct answer to a first-person weapon clipping into a wall, and it is
 * why "one draw order" is a decision this file owns rather than a fact about it.
 *
 * There are two hook points and no more: `materials` for what a surface is made
 * of and `passes` for what happens to the finished picture. Both are deliberately
 * dumb. A renderer that holds the list of materials a game uses, or the list of
 * effects it wants, has started to know what the game is — and in this engine
 * that knowledge lives in a plugin. This file owns one GL context and one draw
 * order, and it must never learn what bloom is.
 *
 * What it does know about is cost. Several hundred walls that never move are
 * merged by material into a handful of meshes, each one still small enough to be
 * frustum-culled, and `stats` reports what that bought so the next change here
 * can be measured rather than argued about.
 *
 * This file is handed `view` and `viewport` and may know nothing else: no level,
 * no project file, no context. Everything a level wants to say about light, fog
 * and sky arrives through the four setters near the bottom.
 */
import * as THREE from 'three'
import { assetURL } from './ui.js'

/**
 * Everything this file has already complained about.
 *
 * Geometry and materials are read every frame, so a message about a bad
 * declaration would otherwise arrive sixty times a second — and a console that
 * scrolls is a console nobody reads, which is how the next real error goes
 * unseen. Say each distinct thing once and mean it.
 */
const alreadySaid = new Set()

function report(message) {
  if (alreadySaid.has(message)) return
  alreadySaid.add(message)
  console.error(message)
}

// ---------------------------------------------------------------- textures

const loader = new THREE.TextureLoader()
const texCache = new Map()      // "mode:src"        -> the shared original
const texState = new Map()      // "mode:src"        -> { status, waiting }
const variantCache = new Map()  // "mode:u,v:src"    -> a copy with its own repeat

/**
 * The best anisotropy this GL context will do, read from the renderer once.
 *
 * It is a property of the context rather than of a texture, and `texture()` is
 * shared by every renderer the page makes — of which there is one. Reading it
 * here beats threading a renderer through every call site.
 */
let maxAnisotropy = 1

const statusOf = (src, mode) => texState.get(`${mode}:${src}`)?.status || 'unknown'

/**
 * A texture, cached, in one of three readings of the same file.
 *
 * `sprite` is nearest-neighbour with no mipmaps, which is the only way pixel art
 * survives being scaled up. `world` is the opposite, and has to be: a floor
 * running to the horizon under a perspective camera samples far below one texel
 * per pixel, and without mipmaps and anisotropy it aliases into noise that
 * crawls as you walk. `lightmap` is `world` that does not repeat, because baked
 * light is one picture stretched over a surface rather than a pattern tiled
 * across it. The same file can be wanted several ways, so the reading is part of
 * the cache key rather than a property somebody mutates later.
 *
 * `onFail` is remembered rather than dropped. Registering it only on a cache
 * MISS meant that when forty walls shared one missing file, the first wall fell
 * back to a visible colour and the other thirty-nine drew as nothing at all —
 * an invisible wall with no message, which is the exact failure this engine
 * calls the worst one.
 */
function texture(src, mode, onFail) {
  const key = `${mode}:${src}`
  const cached = texCache.get(key)
  if (cached) {
    const state = texState.get(key)
    // Already resolved either way: a failure the caller checks for with
    // statusOf(), or an image that is already here.
    if (state?.status === 'loading' && onFail) state.waiting.push(onFail)
    return cached
  }

  const url = assetURL(src)
  const state = { status: 'loading', waiting: onFail ? [onFail] : [] }
  const t = loader.load(url,
    () => {
      state.status = 'ready'
      // Copies made while the file was in flight are holding off their upload
      // until now; see guardUpload.
      for (const fn of state.ready || []) fn()
      state.ready = null
    },
    undefined,
    () => {
      // A texture that 404s used to mean a blank viewport and an empty error
      // log — the single worst thing to hand an agent. Say it out loud instead.
      report(`[render] missing texture ${url} (referenced as "${src}")`)
      // The state table is the only record of this. A flag on the texture as
      // well would be a second source of truth for one fact, and the two would
      // eventually disagree.
      state.status = 'failed'
      for (const fn of state.waiting) fn()
      state.waiting.length = 0
    })

  if (mode === 'sprite') {
    // pixel art stays crisp: no smoothing, no mipmaps
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
  } else {
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = maxAnisotropy
    t.wrapS = t.wrapT = mode === 'lightmap' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  }
  t.colorSpace = THREE.SRGBColorSpace
  texCache.set(key, t)
  texState.set(key, state)
  return t
}

/**
 * Hold a copy back until its picture has arrived.
 *
 * `Texture.clone()` shares the original's `Source` — so the image turns up in
 * the copy on its own — but it also flags the copy for upload on the spot. Three
 * then tries to upload a texture with no image every single frame and says so:
 * "Texture marked for update but no image data found", once per copy per frame,
 * which on a real level is several hundred lines a frame until the files land.
 * A warning storm trains everyone to ignore the console, so the copy waits its
 * turn instead. `version` is a plain counter and zero means "nothing to upload".
 */
function guardUpload(base, copy, src, mode) {
  if (base.image) return copy
  copy.version = 0
  const state = texState.get(`${mode}:${src}`)
  if (!state) return copy
  if (state.status === 'ready') { copy.needsUpdate = true; return copy }
  ;(state.ready = state.ready || []).push(() => { copy.needsUpdate = true })
  return copy
}

/**
 * A texture with its own repeat, cached by that repeat.
 *
 * Repeat lives on the texture object, so two walls tiling the same file at
 * different densities cannot share one — but four hundred walls tiling it the
 * SAME way can, and on a real map they mostly do. Caching the copy by its repeat
 * turns two hundred and thirty texture objects into eight, and it is what makes
 * one shared material per look possible, which is in turn what makes merging
 * possible.
 */
function tiledTexture(src, mode, u, v, onFail) {
  const key = `${mode}:${u},${v}:${src}`
  const found = variantCache.get(key)
  if (found) return found
  const base = texture(src, mode, onFail)
  const copy = base.clone()
  copy.repeat.set(u, v)
  guardUpload(base, copy, src, mode)
  variantCache.set(key, copy)
  return copy
}

/**
 * A texture nobody else may touch.
 *
 * A tiled or sheeted sprite rewrites repeat and offset every frame from its own
 * frame number, so it cannot share a texture with anything — not even with
 * another entity showing a different frame of the same sheet.
 */
function privateTexture(src, mode, onFail) {
  const base = texture(src, mode, onFail)
  return guardUpload(base, base.clone(), src, mode)
}

// ------------------------------------------------------------------ models

let gltfLoader = null
let gltfLoading = null

/**
 * The glTF loader, fetched the first time a model is actually asked for.
 *
 * It ships inside the `three` package, so this is no new dependency either way —
 * but a static import would put its parser in front of every 2D game that will
 * never load a model. Loading a model is already asynchronous, so a dynamic
 * import costs nothing that was not already a wait.
 */
function gltf() {
  if (!gltfLoading) {
    gltfLoading = import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(module => { gltfLoader = new module.GLTFLoader(); return gltfLoader })
  }
  return gltfLoading
}

const modelCache = new Map()   // file -> { status, scene, waiting }

/**
 * A loaded model, once — and then cloned per entity.
 *
 * Forty terrorists must not be forty downloads and must not share one transform,
 * so the file is fetched once and `clone()` gives each entity its own scene
 * graph while the geometry and the materials stay shared. That sharing is most
 * of why forty of them is affordable.
 *
 * A model that fails is reported by name and answers `onFail`, because a player
 * model that is silently invisible cannot be found by looking at the screen.
 */
function model(file, onReady, onFail) {
  const found = modelCache.get(file)
  if (found) {
    if (found.status === 'ready') onReady(found.scene)
    else if (found.status === 'failed') onFail()
    else found.waiting.push({ onReady, onFail })
    return
  }

  const url = assetURL(file)
  const entry = { status: 'loading', scene: null, waiting: [{ onReady, onFail }] }
  modelCache.set(file, entry)

  const fail = detail => {
    entry.status = 'failed'
    report(`[render] missing model ${url} (referenced as "${file}")${detail ? ` — ${detail}` : ''}`)
    for (const w of entry.waiting) w.onFail()
    entry.waiting.length = 0
  }

  gltf().then(instance => instance.load(url,
    result => {
      entry.status = 'ready'
      entry.scene = result.scene
      for (const w of entry.waiting) w.onReady(entry.scene)
      entry.waiting.length = 0
    },
    undefined,
    error => fail(error?.message)
  )).catch(error => fail(error?.message))
}

// ------------------------------------------------------- reading a value

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * A declared colour, or null when it cannot be read.
 *
 * Three warns about a colour it does not understand and then quietly stays
 * white, which reads as "my tint did nothing". Check it here instead, so the
 * message names this renderer and the value that was wrong.
 */
function readColour(value, where) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return new THREE.Color(value)
  const text = String(value).toLowerCase()
  if (HEX.test(text) || text in THREE.Color.NAMES) return new THREE.Color(value)
  report(`[render] ${where}: cannot read colour ${JSON.stringify(value)}`)
  return null
}

/**
 * A light level, or null when the caller left it out.
 *
 * Omitting an argument has to mean "leave it alone", or a level that only wants
 * to change the sun's colour would silently black out its own sun.
 */
function readIntensity(value, where) {
  if (value === null || value === undefined) return null
  const amount = Number(value)
  if (Number.isFinite(amount)) return amount
  report(`[render] ${where}: ${JSON.stringify(value)} is not an intensity`)
  return null
}

/**
 * A number a declaration promised, or the fallback — and never silently.
 *
 * Every other reader in this file names its failure with a `[render]` prefix,
 * and this one used to swallow it: a box declared `[4, "3", 0.4]` drew a metre
 * tall and said nothing, which is a wrong picture with no way to find out why.
 * A value that was never given is not a failure — a missing size is answered by
 * the deliberately visible metre cube — so only a value that was written down
 * and cannot be read is worth a line.
 */
function number(value, fallback = 1, where = null) {
  if (Number.isFinite(value)) return value
  if (where && value !== undefined && value !== null) {
    report(`[render] ${where}: ${JSON.stringify(value)} is not a number — using ${fallback}`)
  }
  return fallback
}

/**
 * Three numbers that were meant to be a position or a set of angles.
 *
 * Sway, kick and a weapon's fit in a fist all arrive every frame, so the name of
 * what went wrong is built only when something actually did. A missing axis is
 * zero rather than a complaint: leaving `z` out of a shift that is only sideways
 * is how anybody would write it.
 */
const readAxis = (given, where, axis) => {
  const value = given?.[axis]
  if (value === undefined || value === null) return 0
  return Number.isFinite(value) ? value : number(value, 0, `${where}.${axis}`)
}

const readVector = (given, where) => ({
  x: readAxis(given, where, 'x'),
  y: readAxis(given, where, 'y'),
  z: readAxis(given, where, 'z')
})

// ------------------------------------------------------- what a thing is

/**
 * The mesh declaration in its object form.
 *
 * `mesh: "wall.png"` is the documented shorthand for `mesh: { texture: "..." }`
 * and it has to be normalised in ONE place, or half the file reads the string as
 * a texture and the other half reads it as an object that has no texture at
 * all — which is exactly why the shorthand used to take its size from the
 * collider and then draw an untextured box.
 */
function meshOf(entity) {
  const declared = entity.mesh
  if (!declared) return null
  return typeof declared === 'string' ? { texture: declared } : declared
}

/**
 * Which way a body is turned, in radians about Y.
 *
 * There are two names for this and they are not a duplicate — they are the two
 * places a facing comes from. `rotation` is the editor's handle, in degrees,
 * because degrees are what an author types into an inspector and reads back off
 * a level file. `yaw` is what game code sets while the world is running, in
 * radians, because radians are what every other angle in the engine is in: the
 * camera's aim, a raycast, the answer `Math.atan2` gives.
 *
 * The running value wins when there is one. Without this a type that turned its
 * body to face where it was running — the plainest thing a character does —
 * faced that way to every plugin that asked and stood facing north on screen.
 */
const facingRadians = entity =>
  Number.isFinite(entity.yaw) ? entity.yaw : (entity.rotation || 0) * Math.PI / 180

/**
 * How far to drop a model whose origin is not its middle.
 *
 * An entity's `y` is its CENTRE. That is what a box geometry wants and what
 * every brush in a level depends on, so it is not negotiable. But a character
 * model is authored standing on the floor with its origin between its feet,
 * because the floor is the only place an artist can put an origin repeatably —
 * and a weapon's origin is its grip for the same reason. Planting a
 * feet-origin model at the centre leaves it floating by half its own height,
 * with its head outside its own collider. The symptom is a player hovering a
 * metre off the ground, which reads as a scale bug and is not one.
 *
 * So the model says where its origin is, once, in the type file:
 *
 *   mesh: { model: 'terrorist.glb', anchor: 'feet' }
 *
 * Height comes from the declared box, then the collider — the same order the
 * rest of this file trusts, because a thing that has said how big it hits has
 * already said how tall it is.
 */
const ANCHORS = new Set(['centre', 'center', 'feet'])

function anchorOffset(entity) {
  const declared = meshOf(entity)
  const anchor = declared?.anchor
  if (anchor == null) return 0
  if (!ANCHORS.has(anchor)) {
    // Silence is the enemy: a misspelt anchor would otherwise be a model that
    // is subtly in the wrong place, which nobody ever traces back to a typo.
    console.error(`[render] ${entity.type}.mesh.anchor is "${anchor}" — expected one of ${[...ANCHORS].join(', ')}. Treating it as centre.`)
    return 0
  }
  if (anchor !== 'feet') return 0
  const height = declared.box?.[1] ?? entity.collider?.box?.[1] ?? 0
  return -(height / 2) * (entity.scale ?? 1)
}

/**
 * One entity drawn as several boxes.
 *
 * The renderer knows three shapes — a box, a quad and a loaded model — and a
 * great many things a game needs are none of them. A cat, a lamp post, a crate
 * with a lid: each is a handful of boxes and none is worth an artist, a file
 * format and a load path. So a type may say what it is made of:
 *
 *   mesh: {
 *     tint: '#e8a55c',
 *     parts: [
 *       { box: [0.42, 0.30, 0.62] },                        // the body, centred
 *       { box: [0.30, 0.28, 0.26], at: [0, 0.14, -0.35] },  // the head, in front
 *       { box: [0.07, 0.07, 0.34], at: [0, 0.26, 0.43], rotation: [-40, 0, 0] }
 *     ]
 *   }
 *
 * `at` is metres from the entity's centre and `rotation` is degrees about X, Y
 * and Z. A part inherits every other key of the mesh — tint, texture, material —
 * so the common case names the colour once and only the odd part overrides it.
 * Give a part a `name` and `entity.pose` swings it, exactly as it swings a named
 * node of a loaded model: `pose: { legFrontLeft: 0.4 }` is a run cycle whether
 * the body came out of a file or out of this list.
 * Forward is -Z, the same direction the camera faces at yaw 0, so a body modelled
 * nose-first at -Z turns the right way when `yaw` says where it is running.
 *
 * Read once per declaration, not once per entity per frame: a type file is one
 * shared object, so the parsing, the bounds and the string that says whether the
 * shape changed are all cached against the array the type declared.
 *
 * Parts are never merged into a batch. A batch is one geometry and one material,
 * and a part-built body is several of each — the same reason a model is left out.
 */
const partsCache = new WeakMap()

function partsOf(declared, where = 'mesh') {
  if (!Array.isArray(declared?.parts) || !declared.parts.length) return null
  const cached = partsCache.get(declared.parts)
  if (cached) return cached

  // Everything on the mesh except the list itself is what a part starts from.
  const { parts, ...shared } = declared
  const low = { x: Infinity, y: Infinity, z: Infinity }
  const high = { x: -Infinity, y: -Infinity, z: -Infinity }

  const list = parts.map((part, index) => {
    const spot = `${where}.parts[${index}]`
    const box = Array.isArray(part?.box) ? part.box : []
    const shape = {
      kind: 'box',
      w: number(box[0], 0.1, `${spot}.box[0]`),
      h: number(box[1], 0.1, `${spot}.box[1]`),
      d: number(box[2], 0.1, `${spot}.box[2]`)
    }
    const at = Array.isArray(part?.at) ? part.at : []
    const turn = Array.isArray(part?.rotation) ? part.rotation : []
    const offset = {
      x: number(at[0], 0, `${spot}.at[0]`),
      y: number(at[1], 0, `${spot}.at[1]`),
      z: number(at[2], 0, `${spot}.at[2]`)
    }

    // Bounds ignore the part's own rotation. They are only used to frame a
    // selection and to place a feet anchor, and an oriented box would cost a
    // matrix per part to make those two answers a few centimetres tighter.
    low.x = Math.min(low.x, offset.x - shape.w / 2)
    low.y = Math.min(low.y, offset.y - shape.h / 2)
    low.z = Math.min(low.z, offset.z - shape.d / 2)
    high.x = Math.max(high.x, offset.x + shape.w / 2)
    high.y = Math.max(high.y, offset.y + shape.h / 2)
    high.z = Math.max(high.z, offset.z + shape.d / 2)

    return {
      index,
      shape,
      at: offset,
      // Only a named part can be posed. Most are not — a stripe or an eye has
      // nothing to say — so naming is opt-in rather than an index nobody typed.
      name: typeof part?.name === 'string' ? part.name : null,
      // Degrees in the declaration, because that is the unit an author types;
      // radians here, because that is the unit the scene graph is in.
      turn: {
        x: number(turn[0], 0, `${spot}.rotation[0]`) * Math.PI / 180,
        y: number(turn[1], 0, `${spot}.rotation[1]`) * Math.PI / 180,
        z: number(turn[2], 0, `${spot}.rotation[2]`) * Math.PI / 180
      },
      declaration: { ...shared, ...part }
    }
  })

  const built = {
    list,
    size: { w: high.x - low.x, h: high.y - low.y, d: high.z - low.z },
    // What the object was built from, so an edited type rebuilds and an
    // untouched one never pays to be stringified again.
    signature: JSON.stringify(parts)
  }
  partsCache.set(declared.parts, built)
  return built
}

/**
 * What an entity's mesh is: a shape and three numbers, or null for a sprite.
 *
 * `box` and `quad` say it outright. `parts` is measured from the boxes it lists,
 * unless the type also states a box — a body whose tail sticks out has a larger
 * drawing than the size it should count as. A `model` brings its own geometry, so
 * the numbers only describe how big it counts as — for framing a selection — and
 * the collider is the honest source for that. Anything else takes the collider's
 * box, because a thing that has declared how big it hits has already declared
 * how big it is. A metre cube is the last resort, and it is deliberately a size
 * you can see rather than nothing at all.
 */
function meshShape(entity) {
  const declared = meshOf(entity)
  if (!declared) return null
  const collider = Array.isArray(entity.collider?.box) ? entity.collider.box : []

  const parts = partsOf(declared, `${entity.type}.mesh`)
  if (parts && !declared.model) {
    const stated = Array.isArray(declared.box) ? declared.box : null
    if (!stated) return { kind: 'parts', ...parts.size }
    return {
      kind: 'parts',
      w: number(stated[0], parts.size.w, `${entity.type}.mesh.box[0]`),
      h: number(stated[1], parts.size.h, `${entity.type}.mesh.box[1]`),
      d: number(stated[2], parts.size.d, `${entity.type}.mesh.box[2]`)
    }
  }

  // Every branch below reads the numbers first and only builds the name of what
  // went wrong when something did. This runs for every mesh entity every frame,
  // and a template string per dimension per frame is a hundred thousand
  // throwaway strings a second on a real map.
  if (Array.isArray(declared.quad)) {
    const w = declared.quad[0], h = declared.quad[1]
    if (Number.isFinite(w) && Number.isFinite(h)) return { kind: 'quad', w, h, d: 0 }
    return {
      kind: 'quad',
      w: number(w, 1, `${entity.type}.mesh.quad[0]`),
      h: number(h, 1, `${entity.type}.mesh.quad[1]`),
      d: 0
    }
  }

  // A model brings its own geometry, so these three numbers are only the box
  // drawn in its place until the file arrives, and how big it counts as when
  // something frames a selection. A type that declares a box beside its model
  // means that box; otherwise the collider is the honest answer, and having
  // neither is not a mistake worth reporting.
  if (declared.model) {
    const stand = Array.isArray(declared.box) ? declared.box : collider
    return { kind: 'model', w: number(stand[0]), h: number(stand[1]), d: number(stand[2]) }
  }

  const declaredBox = Array.isArray(declared.box)
  const box = declaredBox ? declared.box : (collider.length >= 3 ? collider : null)
  if (!box) {
    report(`[render] ${entity.type}.mesh: no box and no three-number collider — drawing a 1 m cube`)
    return { kind: 'box', w: 1, h: 1, d: 1 }
  }
  const w = box[0], h = box[1], d = box[2]
  if (Number.isFinite(w) && Number.isFinite(h) && Number.isFinite(d)) return { kind: 'box', w, h, d }
  const where = declaredBox ? `${entity.type}.mesh.box` : `${entity.type}.collider.box`
  return {
    kind: 'box',
    w: number(w, 1, `${where}[0]`),
    h: number(h, 1, `${where}[1]`),
    d: number(d, 1, `${where}[2]`)
  }
}

/**
 * How big an entity draws.
 *
 * A mesh wins outright, because solid geometry states its own size. Otherwise
 * the sprite wins over the collider, because art is usually larger than the box
 * it collides with — a character's hair should not be part of its hitbox. The
 * collider is the fallback so an untextured entity still has an honest size,
 * and a circle reports its diameter rather than silently becoming 1x1. `d` is
 * depth: zero for anything flat, so a tool that frames a selection in 2D gets
 * exactly the answer it always got.
 */
function drawSize(entity) {
  const s = entity.scale ?? 1
  const shape = meshShape(entity)
  if (shape) return { w: shape.w * s, h: shape.h * s, d: shape.d * s }
  const diameter = entity.collider?.circle ? entity.collider.circle * 2 : null
  return {
    w: (entity.sprite?.width ?? entity.collider?.box?.[0] ?? diameter ?? 1) * s,
    h: (entity.sprite?.height ?? entity.collider?.box?.[1] ?? diameter ?? 1) * s,
    d: 0
  }
}

/**
 * Where frame N sits in a sheet, as a UV window.
 *
 * Frames run left to right then top to bottom, and the column count comes from
 * the image once it has loaded — declaring it as well would be a second source
 * of truth that could disagree with the file.
 */
function frameWindow(sprite, frame, image) {
  const [cw, ch] = sprite.size || [image.width, image.height]
  const cols = Math.max(1, Math.floor(image.width / cw))
  const rows = Math.max(1, Math.floor(image.height / ch))
  const n = Math.max(0, Math.floor(frame || 0)) % (cols * rows)
  return {
    repeat: [cw / image.width, ch / image.height],
    // Three's V axis runs bottom-up while a sheet reads top-down.
    offset: [(n % cols) * cw / image.width, 1 - ch / image.height - Math.floor(n / cols) * ch / image.height]
  }
}

/**
 * The image a sprite points at, whichever way it was written.
 *
 * `image` is one picture; `sheet` is a strip of same-sized frames. They are the
 * same file to the renderer — only how it maps UVs differs — so everything
 * downstream asks for `source()` and does not care which was declared.
 */
const source = s => s?.sheet || s?.image || null

/** Stable colour per type so untextured entities are still distinguishable. */
function tint(type) {
  let hash = 0
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) | 0
  const c = new THREE.Color()
  c.setHSL(((hash >>> 0) % 360) / 360, 0.32, 0.55)
  return c
}

// ---------------------------------------------------------------- geometry

const PLANE = new THREE.PlaneGeometry(1, 1)

/**
 * Solid geometry, cached by its dimensions.
 *
 * A map of four hundred walls is a handful of distinct sizes, and building four
 * hundred BoxGeometries to say so costs megabytes of buffers and a visible
 * hitch on load. Nothing here is ever disposed: the cache is keyed by size, so
 * it is bounded by how many sizes the project actually uses.
 */
const geometryCache = new Map()

function solid(kind, w, h, d) {
  const key = `${kind}:${w},${h},${d}`
  const cached = geometryCache.get(key)
  if (cached) return cached
  const geometry = kind === 'quad' ? new THREE.PlaneGeometry(w, h) : new THREE.BoxGeometry(w, h, d)
  // The second UV set is copied off the first BEFORE it is rewritten in metres,
  // so it is still the 0..1 parameterisation a baked lightmap wants. Two floats
  // per vertex on geometry that is already shared by every wall of this size is
  // not worth making conditional.
  geometry.setAttribute('uv1', geometry.attributes.uv.clone())
  measureUVsInMetres(geometry, kind, w, h, d)
  geometryCache.set(key, geometry)
  return geometry
}

/**
 * Rewrite UVs so that one unit of UV is one metre of surface.
 *
 * A BoxGeometry gives all six faces UVs from 0 to 1, so a single repeat count
 * spread over the lot makes the 0.3 m end of a 12 m wall show as many bricks as
 * the front of it. Measuring UVs in metres instead gives the texture one density
 * everywhere, and leaves `tiling` with only one thing to say: what that density
 * is. It costs nothing at runtime — the numbers are baked once, into geometry
 * that is then shared by every wall of that size.
 */
function measureUVsInMetres(geometry, kind, w, h, d) {
  const uv = geometry.attributes.uv
  // Face order is the order BoxGeometry builds them in: +X, -X, +Y, -Y, +Z, -Z.
  const faces = kind === 'quad' ? [[w, h]] : [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  const perFace = uv.count / faces.length
  for (let i = 0; i < uv.count; i++) {
    const [faceWidth, faceHeight] = faces[Math.floor(i / perFace)]
    uv.setXY(i, uv.getX(i) * faceWidth, uv.getY(i) * faceHeight)
  }
  uv.needsUpdate = true
}

/**
 * How many times a texture repeats, per metre of surface.
 *
 * UVs are in metres (see measureUVsInMetres), so this is a density, and being a
 * density is what keeps it the same on every face of a box. There are two
 * readings and both are the one a person means when they write it:
 *
 *   tiling: 2        two repeats per metre — a 12 m wall shows 24 of them
 *   tiling: [3, 1]   three across and one up ON THE FACE, whatever its size
 *
 * The bare number is a density because that is how you say "brick": lengthen the
 * wall and the bricks stay the same size instead of stretching. The array is
 * absolute because that is how you say "this poster, once". So a box with
 * nothing declared repeats once per metre, and a quad — a decal, a poster, a
 * sign — shows its picture exactly once, because one of those is one picture.
 */
function tilingOf(tiling, shape, where = null) {
  if (Array.isArray(tiling)) {
    const u = tiling[0], v = tiling[1]
    if (Number.isFinite(u) && Number.isFinite(v)) return [u / (shape.w || 1), v / (shape.h || 1)]
    return [
      number(u, 1, where && `${where}[0]`) / (shape.w || 1),
      number(v, 1, where && `${where}[1]`) / (shape.h || 1)
    ]
  }
  if (Number.isFinite(tiling)) return [tiling, tiling]
  if (tiling !== undefined && tiling !== null) {
    const density = number(tiling, 1, where)
    return [density, density]
  }
  return shape.kind === 'quad' ? [1 / (shape.w || 1), 1 / (shape.h || 1)] : [1, 1]
}

/**
 * One merged BufferGeometry from a list of meshes, in world space.
 *
 * Every source is one of the cached box or quad geometries, so the attribute set
 * is known exactly and there is nothing to negotiate: position, normal, uv, uv1.
 * The transform is baked in, which is the whole point — a batch draws with an
 * identity matrix and one call.
 */
function mergeMeshes(members) {
  let vertices = 0
  let indices = 0
  for (const mesh of members) {
    vertices += mesh.geometry.attributes.position.count
    indices += mesh.geometry.index.count
  }

  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const uv = new Float32Array(vertices * 2)
  const uv1 = new Float32Array(vertices * 2)
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)

  const point = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()
  let vertexAt = 0
  let indexAt = 0

  for (const mesh of members) {
    mesh.updateMatrix()
    normalMatrix.getNormalMatrix(mesh.matrix)
    const geometry = mesh.geometry
    const p = geometry.attributes.position
    const n = geometry.attributes.normal
    const t = geometry.attributes.uv
    const t1 = geometry.attributes.uv1 || t

    for (let i = 0; i < p.count; i++) {
      const at = vertexAt + i
      point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix)
      position[at * 3] = point.x; position[at * 3 + 1] = point.y; position[at * 3 + 2] = point.z
      point.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize()
      normal[at * 3] = point.x; normal[at * 3 + 1] = point.y; normal[at * 3 + 2] = point.z
      uv[at * 2] = t.getX(i); uv[at * 2 + 1] = t.getY(i)
      uv1[at * 2] = t1.getX(i); uv1[at * 2 + 1] = t1.getY(i)
    }
    for (let i = 0; i < geometry.index.count; i++) index[indexAt + i] = vertexAt + geometry.index.getX(i)

    vertexAt += p.count
    indexAt += geometry.index.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  merged.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  merged.computeBoundingSphere()
  return merged
}

// ---------------------------------------------------------------- materials

const eachMaterial = (node, fn) => {
  if (!node.material) return
  if (Array.isArray(node.material)) node.material.forEach(fn)
  else fn(node.material)
}

/**
 * Opacity, with the recompile three needs to honour it.
 *
 * `transparent` is part of the shader program's cache key, so flipping it
 * without `needsUpdate` leaves the mesh running the opaque program it was
 * compiled with, and `entity.opacity` silently does nothing at all. Only flag it
 * when the flag actually changed: a recompile every frame is its own bug.
 */
function setOpacity(material, opacity) {
  material.opacity = opacity
  const wantsBlending = opacity < 1
  if (material.transparent === wantsBlending) return
  material.transparent = wantsBlending
  material.needsUpdate = true
}

/**
 * Where a model's named children are, per instance.
 *
 * Kept outside `userData` because three deep-copies `userData` through JSON on
 * every clone, and a map of live Object3Ds does not survive that trip. Both
 * things that address a model by node name read this one index: `pose`, which
 * rotates a named node, and `attachments`, which hangs another model off one.
 */
const namedNodes = new WeakMap()

/**
 * What is hanging off a model's named nodes right now.
 *
 * holder -> Map(node name -> { model, group }). This record is the whole reason
 * setting the same attachment twice is a move rather than a rebuild: a plugin
 * keeping a body's weapon in step with its inventory writes the same file name
 * sixty times a second, and rebuilding a scene graph at that rate is a stutter
 * nobody would ever trace back to the line that caused it.
 */
const attachedModels = new WeakMap()

/** Every named node of a freshly cloned model, so pose and attachments can find one. */
function indexNodes(holder, instance) {
  const nodes = {}
  instance.traverse(node => { if (node.name && !nodes[node.name]) nodes[node.name] = node })
  namedNodes.set(holder, nodes)
}

/**
 * One attachment, in its object form.
 *
 * `attachments: { weaponMount: 'ak47.glb' }` is the shorthand for
 * `{ weaponMount: { model: 'ak47.glb' } }`, and it is normalised in ONE place
 * for exactly the reason `meshOf` normalises the mesh: two readings of one
 * declaration in two places is how half a file comes to treat a string as a
 * file name and the other half as an object that has no file name in it.
 */
function attachmentOf(value, where) {
  if (value === null || value === undefined || value === false) return null
  if (typeof value === 'string') return value ? { model: value } : null
  if (typeof value === 'object' && typeof value.model === 'string' && value.model) return value
  report(`[render] ${where}: expected a model file name, got ${JSON.stringify(value)}`)
  return null
}

/**
 * Hang models off a model's named nodes, and take off what is no longer wanted.
 *
 *   entity.attachments = { weaponMount: 'counter-strike/models/ak47.glb' }
 *
 * A character is exported with an empty node at the right hand, and what goes in
 * that hand changes as the game runs — so it is a declaration, read on sync,
 * alongside `pose` and `anchor`. It belongs here rather than in a plugin because
 * this file already owns the model cache: a plugin doing its own parenting would
 * fetch and hold a second copy of every GLB the world models already have, and
 * the copies would be invalidated separately when somebody edited the file.
 *
 * The request is remembered rather than read once, because the node it names may
 * not exist yet — whoever finishes loading the model applies the standing
 * request the moment the nodes are there. So one call is enough, and a caller
 * does not have to keep asking until the file lands.
 */
function applyAttachments(holder, declared) {
  holder.userData.attachmentsWanted = declared || null

  const held = attachedModels.get(holder)
  if (!declared && !held) return
  const nodes = namedNodes.get(holder)
  // Still loading. The request is written down above, and applied from there.
  if (!nodes) return

  const where = holder.userData.model
  const record = held || new Map()
  if (!held) attachedModels.set(holder, record)

  // Everything that changed file, or is no longer asked for, comes off first —
  // so a swap frees the node before the thing replacing it wants it.
  for (const [name, entry] of [...record]) {
    const wanted = attachmentOf(declared?.[name], `${where}.attachments.${name}`)
    if (wanted && wanted.model === entry.model) continue
    entry.group.userData.stale = true
    entry.group.parent?.remove(entry.group)
    record.delete(name)
  }

  if (!declared) return
  for (const name of Object.keys(declared)) {
    const spec = attachmentOf(declared[name], `${where}.attachments.${name}`)
    if (!spec) continue

    let entry = record.get(name)
    if (!entry) {
      const node = nodes[name]
      if (!node) {
        // Once, by name. This is written every frame, and a message that repeats
        // sixty times a second is a console nobody reads.
        report(`[render] ${where}: no node named "${name}" to attach "${spec.model}" to`)
        continue
      }
      // A group of its own rather than the loaded scene directly: the offset
      // that fits a grip into a fist has to survive the file arriving late, and
      // a node that exists from the first frame is the simplest way to hold it.
      const group = new THREE.Group()
      group.rotation.order = 'YXZ'
      node.add(group)
      entry = { model: spec.model, group }
      record.set(name, entry)
      loadAttachment(holder, group, spec.model)
    }

    const position = readVector(spec.position, `${where}.attachments.${name}.position`)
    const rotation = readVector(spec.rotation, `${where}.attachments.${name}.rotation`)
    entry.group.position.set(position.x, position.y, position.z)
    entry.group.rotation.set(rotation.x, rotation.y, rotation.z)
    entry.group.scale.setScalar(number(spec.scale, 1, `${where}.attachments.${name}.scale`))
  }
}

function loadAttachment(holder, group, file) {
  model(file, loaded => {
    // Either the attachment or the thing it hangs off may have gone while the
    // file was in the air — and the second body to want a model already in the
    // cache is answered before its group has been parented at all, so the flags
    // are the only honest test.
    if (group.userData.stale || holder.userData.stale) return
    const instance = loaded.clone(true)
    // A viewmodel is in front of the eye by construction, so culling it against
    // a frustum it is always inside costs a test per frame and can only ever be
    // wrong. A weapon in somebody else's hands is culled like anything else.
    if (holder.userData.neverCull) instance.traverse(node => { node.frustumCulled = false })
    group.add(instance)
  }, () => {
    // `model()` has already named the file on the console. An empty hand is the
    // least bad answer here: a fallback block held in a fist reads as artwork
    // rather than as a failure, which is the one thing it must not do.
  })
}

/** The nearest ancestor that stands for an entity, for a ray that hit a child. */
function entityIdOf(object) {
  for (let node = object; node; node = node.parent) {
    if (node.userData.entity) return node.userData.entity
  }
  return null
}

/** Visible means visible all the way up: a hidden group hides its children. */
function shownInTree(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false
  return true
}

/**
 * `view` and `viewport` are handed in, not owned here.
 *
 * Where the camera looks and how big the picture is are game values — the
 * camera plugin moves one and clamps against the other — so they belong to the
 * session, which exists whether or not anything is drawing. The renderer reads
 * the same two objects the game does.
 */
export function makeRenderer(canvas, view, viewport) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  // The world and the viewmodel are two passes over one frame, so clearing is
  // this file's job rather than three's — and the counters have to survive both
  // renders to be worth reading.
  renderer.autoClear = false
  renderer.info.autoReset = false

  // Shadows cost nothing until a light asks for one — the shadow pass walks the
  // lights that cast and there are none by default — so the switch is on and
  // which lights cast is left to whoever owns the lights. Setting `castShadow`
  // on a light and having nothing happen, with no way to find out why, is the
  // failure this avoids.
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  orthographic.position.z = 10

  // Near is 0.05 rather than something rounder because the eye sits 1.62 m up
  // and a wall it is pressed against must not clip away. Far is 400 m, which is
  // an order of magnitude past the longest sightline any map of this kind has.
  const perspective = new THREE.PerspectiveCamera(90, 1, 0.05, 400)
  // Yaw before pitch, or looking up while turned would roll the horizon.
  perspective.rotation.order = 'YXZ'

  /**
   * Light exists before any level says a word about it.
   *
   * A level that forgets its `world` block should still be lit — a black
   * viewport with an empty error log is the worst thing this can hand anyone.
   * The defaults are dust2 light: a warm sun from above and behind, a cool
   * ambient standing in for bounce off the sky.
   */
  const DEFAULT_SUN = [-0.4, -1, -0.3]
  const ambient = new THREE.AmbientLight(new THREE.Color('#93a7c4'), 0.55)
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff2d8'), 0.9)
  scene.add(ambient, sun)

  /**
   * Point the sun. A direction is where the light TRAVELS, so the lamp goes the
   * opposite way; the distance is arbitrary for a directional light, because
   * only the direction from it to its target is ever read.
   *
   * Anything that is not three usable numbers leaves the sun exactly where it
   * was and says so by name. Both halves of that matter: a sun at NaN lights
   * nothing and reports nothing, and a level that only wanted to change the
   * colour must not have its direction quietly reset underneath it.
   */
  function aimSun(direction) {
    if (direction === undefined || direction === null) return
    const given = Array.isArray(direction) ? direction.map(Number) : []
    if (given.length !== 3 || !given.every(Number.isFinite) || given.every(n => n === 0)) {
      report(`[render] setSun: ${JSON.stringify(direction)} is not a direction — leaving the sun where it is`)
      return
    }
    sun.position.set(given[0], given[1], given[2]).normalize().multiplyScalar(-50)
  }
  aimSun(DEFAULT_SUN)

  const raycaster = new THREE.Raycaster()
  // Merged entities keep a mesh nobody draws, on its own layer, so that picking
  // still answers against real geometry. The camera ignores that layer; the ray
  // must not.
  raycaster.layers.enableAll()

  const meshes = new Map()   // entity id -> the object standing for it

  const DRAWN = 0            // layer the camera renders
  const MERGED = 1           // layer only the raycaster looks at

  // ---------------------------------------------------- the material registry

  /**
   * What a surface is made of, contributed by plugins.
   *
   * `build({ mesh, texture, tint, view })` returns a THREE.Material, where
   * `mesh` is the whole normalised declaration (so a plugin can read its own
   * keys off it), `texture` is the resolved map or null, `tint` is always a
   * Colour and is what `color` should be, and `view` is the session's camera
   * state for a material that needs to know where the eye is.
   *
   * The two built-ins go through the same door, because a hook point only one
   * side can use is not a hook point. `lambert` is the default and it is what
   * everything drew with before this existed, so nothing breaks when no plugin
   * has registered anything.
   */
  const materialBuilders = new Map()
  const sharedMaterials = new Map()

  materialBuilders.set('lambert', ({ texture: map, tint: colour }) =>
    new THREE.MeshLambertMaterial({
      map: map || null, color: colour, depthTest: true, depthWrite: true, side: THREE.FrontSide
    }))

  materialBuilders.set('basic', ({ texture: map, tint: colour }) =>
    new THREE.MeshBasicMaterial({
      map: map || null, color: colour, depthTest: true, depthWrite: true, side: THREE.FrontSide
    }))

  /**
   * Which material a mesh is asking for.
   *
   * Both forms a declaration may use: `material: 'toon'`, and
   * `material: { name: 'toon', steps: 5 }` where the rest of the object is that
   * material's own parameters. `unlit: true` predates the registry and means
   * exactly `basic`, so every sky face and lamp already in a project keeps
   * drawing the way it did.
   */
  const materialNameFor = declared => {
    const chosen = declared.material
    if (typeof chosen === 'string' && chosen.trim()) return chosen.trim()
    if (chosen && typeof chosen === 'object' && !Array.isArray(chosen) && typeof chosen.name === 'string' && chosen.name.trim()) {
      return chosen.name.trim()
    }
    return declared.unlit ? 'basic' : 'lambert'
  }

  /** Keys that describe the shape or choose the material, rather than tune it. */
  const SHAPE_KEYS = new Set([
    'box', 'quad', 'model', 'scale', 'material', 'unlit', 'tiling',
    // A part says where it is and which way it is turned. Both describe shape,
    // and a key left out of this set is stringified into the material key on
    // every part of every frame — which would also give twelve identically
    // coloured boxes twelve materials, one per position.
    'parts', 'at', 'rotation', 'name'
  ])

  /**
   * Everything about a mesh that decides its material, and nothing about its
   * size.
   *
   * Dropping size from the key is what lets a 12 m wall and a 0.4 m step share
   * one material, which is in turn what lets them be merged into one draw call.
   * The resolved repeat stands in for the declared `tiling`, because `[3, 1]`
   * means different repeats on differently sized faces and two declarations that
   * resolve the same really are the same material.
   *
   * Every remaining key goes in, not a chosen few. A registered material reads
   * its own parameters off the declaration — a toon's step count, a water's
   * speed — and a key that only knew about texture and tint would hand two
   * toons with different step counts one shared material and quietly draw the
   * second with the first one's settings.
   */
  function materialLook(entity, declared, shape) {
    const [u, v] = tilingOf(declared.tiling, shape)
    let key = `${materialNameFor(declared)}|${u},${v}`
    for (const name of Object.keys(declared).sort()) {
      if (SHAPE_KEYS.has(name)) continue
      const value = declared[name]
      key += `|${name}=${value !== null && typeof value === 'object' ? JSON.stringify(value) : value}`
    }
    // An untextured mesh takes the stable per-type colour, so two untextured
    // types must not end up sharing one material and one colour.
    if (!declared.texture) key += `|${entity.type}`
    return key
  }

  /**
   * The two keys an entity's object is built from, worked out together.
   *
   * `look` decides whether the object has to be rebuilt rather than just moved;
   * `material` decides which shared material it draws with and which batch it
   * can be merged into. Three different parts of one sync want them, and both
   * walk the declaration to build a string, so they are computed once and passed
   * along rather than three times for every wall on the map.
   */
  function describe(entity) {
    if (!entity.mesh) {
      return {
        material: null,
        look: source(entity.sprite)
          ? `${source(entity.sprite)}|${entity.sprite.tile ?? 0}|${entity.sprite.sheet ? 'sheet' : 'one'}`
          : `tint:${entity.type}`
      }
    }
    const declared = meshOf(entity)
    const parts = declared.model ? null : partsOf(declared, `${entity.type}.mesh`)
    if (parts) {
      // Every part carries its own material, so the entity has no single one —
      // and nothing to be merged into. The signature is what says the shape
      // changed, and it is computed once per declaration rather than per frame.
      return { material: null, look: `parts|${parts.signature}` }
    }
    const shape = meshShape(entity)
    const material = materialLook(entity, declared, shape)
    // Geometry is in the key beside the material, because changing a box size in
    // the inspector has to show up without a reload, exactly the way changing a
    // sprite does.
    return {
      material,
      look: ['mesh', shape.kind, shape.w, shape.h, shape.d,
        declared.model || '', declared.scale ?? 1, material].join('|')
    }
  }

  /**
   * Force every object to be rebuilt on the next sync.
   *
   * A texture that 404s arrives long after the materials that wanted it were
   * built, and those materials are shared, so there is no one mesh to patch.
   * Rebuilding is both simpler and correct: the second time round the file is
   * known to have failed, so the fallback colour is chosen up front. It cannot
   * loop, because a failed texture is never asked to report again.
   */
  function invalidateEverything() {
    sharedMaterials.clear()
    for (const object of meshes.values()) object.userData.look = null
  }

  /**
   * The material for solid geometry, shared by every mesh that looks the same.
   *
   * Lambert rather than Standard: Counter-Strike 1.6 was lightmapped and flat
   * lit, so a diffuse-only response reads closer to it than a physically-based
   * one does, at a fraction of the cost on a map made of several hundred boxes.
   * `unlit: true` drops to Basic for anything that supplies its own light —
   * a skybox face, a lamp, a screen. Either way it is opaque, writes and tests
   * depth and culls its back faces, which is what lets a room be drawn from the
   * inside with nothing sorted.
   */
  function meshMaterial(entity, key, part = null) {
    const cached = sharedMaterials.get(key)
    if (cached) return cached

    // A part is a small mesh declaration of its own, already merged with the
    // mesh's shared keys, so everything below reads it exactly as it reads a
    // whole mesh — there is no second way to describe a surface.
    const declared = part ? part.declaration : meshOf(entity)
    const where = part ? `${entity.type}.mesh.parts[${part.index}]` : `${entity.type}.mesh`
    const declaredColour = readColour(declared.tint, `${where}.tint`)
    const [u, v] = tilingOf(declared.tiling, part ? part.shape : meshShape(entity), `${where}.tiling`)

    let map = null
    if (declared.texture && statusOf(declared.texture, 'world') !== 'failed') {
      map = tiledTexture(declared.texture, 'world', u, v, invalidateEverything)
    }

    // Only a declared tint multiplies into a texture. Falling back to the
    // per-type colour there would wash every textured wall a different shade.
    const colour = declaredColour || (map ? new THREE.Color(0xffffff) : tint(entity.type))

    const name = materialNameFor(declared)
    const build = materialBuilders.get(name)
    if (!build) report(`[render] ${where}.material: no material named "${name}" is registered — using lambert`)
    const material = (build || materialBuilders.get('lambert'))({
      mesh: declared, texture: map, tint: colour, view
    })

    applyLightmap(material, declared, where)
    sharedMaterials.set(key, material)
    return material
  }

  /**
   * Baked light, on the second UV set.
   *
   * Where the light in a room comes from is a level's business, but which UV
   * channel carries it is this file's — three defaults a lightmap to channel 0,
   * which is the tiling set, and the result is a lightmap repeated once per
   * metre and nobody able to say why. Generated boxes get their second set from
   * `solid()`; a model brings whatever its file declared.
   */
  function applyLightmap(material, declared, where) {
    if (!declared.lightmap) return
    if (!('lightMap' in material)) {
      report(`[render] ${where}.lightmap: a "${materialNameFor(declared)}" material has no lightmap slot`)
      return
    }
    if (statusOf(declared.lightmap, 'lightmap') === 'failed') return
    const baked = texture(declared.lightmap, 'lightmap', invalidateEverything)
    baked.channel = 1
    material.lightMap = baked
    material.lightMapIntensity = number(declared.lightmapIntensity, 1, `${where}.lightmapIntensity`)
  }

  function spriteMaterial(entity) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      // Pixel art has hard edges, so a low cutoff removes the halo without
      // clipping a deliberately faded entity (the stack-picking preview).
      alphaTest: 0.1,
      // 2D is painter's order, set from z and list position in sync(). In a
      // first-person scene sync() turns testing back on, or a sprite would
      // float in front of a wall it is standing behind.
      depthTest: false
    })
    const src = source(entity.sprite)
    if (!src || statusOf(src, 'sprite') === 'failed') {
      mat.color = tint(entity.type)
      return mat
    }
    // Tiled and sheet sprites both need their own texture: repeat and offset
    // live on the texture, and two entities showing different frames of the
    // same sheet must not share one.
    const own = entity.sprite.tile || entity.sprite.sheet
    const onFail = () => {
      // Fall back to the type tint so a broken reference is visible in the
      // viewport as a plain block rather than as nothing at all.
      mat.map = null
      mat.color = tint(entity.type)
      mat.needsUpdate = true
    }
    mat.map = own ? privateTexture(src, 'sprite', onFail) : texture(src, 'sprite', onFail)
    if (entity.sprite.tile) mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping
    return mat
  }

  const geometryFor = entity => {
    const shape = meshShape(entity)
    if (!shape) return PLANE
    return solid(shape.kind === 'quad' ? 'quad' : 'box', shape.w, shape.h, shape.d)
  }

  // --------------------------------------------------------- building objects

  /**
   * The object standing for one entity.
   *
   * A sprite or a box is one Mesh with a shared or private material. A model is
   * a Group holding a tinted box until the file arrives and its clone in its
   * place afterwards, so the entity has something to be at every moment —
   * including the moment the file turns out not to exist.
   */
  function buildObject(entity, described) {
    const declared = meshOf(entity)
    if (declared?.model) return buildModel(entity, declared, described)
    const parts = partsOf(declared, `${entity.type}.mesh`)
    if (parts) return buildParts(entity, parts, described)

    const object = new THREE.Mesh(
      geometryFor(entity),
      entity.mesh ? meshMaterial(entity, described.material) : spriteMaterial(entity))
    object.userData.entity = entity.id
    object.userData.look = described.look
    // A sprite's material belongs to it alone and is disposed with it; a mesh
    // shares one with every wall that looks the same, and disposing that would
    // blank the other three hundred.
    object.userData.privateMaterial = !entity.mesh
    return object
  }

  /**
   * A body made of boxes: one Group, one Mesh per part.
   *
   * Geometry and material both come out of the caches every other box uses, so
   * a hundred kittens are a hundred groups over one set of shared boxes and one
   * set of shared colours rather than a hundred copies of either.
   */
  function buildParts(entity, parts, described) {
    const holder = new THREE.Group()
    holder.userData.entity = entity.id
    holder.userData.look = described.look
    // Shared, like every other mesh material — disposing one would blank every
    // other body built from the same declaration.
    holder.userData.privateMaterial = false

    for (const part of parts.list) {
      const key = materialLook(entity, part.declaration, part.shape)
      const piece = new THREE.Mesh(
        solid('box', part.shape.w, part.shape.h, part.shape.d),
        meshMaterial(entity, key, part))
      piece.position.set(part.at.x, part.at.y, part.at.z)
      piece.rotation.set(part.turn.x, part.turn.y, part.turn.z)
      // A named part is a part `pose` can move, exactly as a named node of a
      // model is. Its declared angle is where it rests, so a pose is added to
      // that rather than replacing it — a tail held at 68 degrees must not snap
      // flat the first time something swishes it.
      if (part.name) {
        piece.name = part.name
        piece.userData.restRotationX = part.turn.x
      }
      holder.add(piece)
    }
    indexNodes(holder, holder)
    return holder
  }

  function buildModel(entity, declared, described) {
    const holder = new THREE.Group()
    holder.userData.entity = entity.id
    holder.userData.look = described.look
    holder.userData.model = declared.model

    // Something visible while the file is in flight, and something visible for
    // good if it never arrives.
    const waiting = new THREE.Mesh(geometryFor(entity), meshMaterial(entity, described.material))
    holder.add(waiting)

    model(declared.model, loaded => {
      // The entity may have changed its look, or gone, while this was in the
      // air. The flag is what says so, not `holder.parent`: the second entity
      // to want a model already in the cache is answered on the spot, before
      // the caller has had a chance to add this holder to the scene at all.
      if (holder.userData.stale) return
      const instance = loaded.clone(true)
      indexNodes(holder, instance)
      holder.remove(waiting)
      holder.add(instance)
      // Whatever was asked for while the file was in flight. Without this an
      // entity that declared its attachment once, before the body existed,
      // would hold air until something happened to declare it again.
      applyAttachments(holder, holder.userData.attachmentsWanted)
    }, () => {
      // The box stays, and `model()` has already named the file on the console.
    })

    return holder
  }

  function discard(object) {
    scene.remove(object)
    namedNodes.delete(object)
    attachedModels.delete(object)
    // Anything still in flight for this object — a model being fetched — checks
    // this before it does its work.
    object.userData.stale = true
    if (!object.userData.privateMaterial) return
    object.traverse(node => eachMaterial(node, material => material.dispose()))
  }

  function objectFor(entity, described) {
    let object = meshes.get(entity.id)
    if (object && object.userData.look !== described.look) {
      // Changing a texture — or a box size — in the inspector has to show up
      // without a reload. Rebuilding rather than patching is what lets a sprite,
      // a box and a model all be the same entity at different moments.
      leaveBatch(entity.id)
      discard(object)
      meshes.delete(entity.id)
      object = null
    }
    if (object) return object
    object = buildObject(entity, described)
    scene.add(object)
    meshes.set(entity.id, object)
    return object
  }

  /**
   * Dim one object, taking private materials the moment it needs them.
   *
   * Dimming is the editor's hover preview and nothing else, so at most a handful
   * of objects ever pay for a private copy — and everything else keeps sharing,
   * which is what makes several hundred walls affordable in the first place.
   */
  function dim(object, opacity) {
    if (opacity >= 1 && !object.userData.privateMaterial) return
    if (!object.userData.privateMaterial) {
      object.traverse(node => {
        if (!node.material) return
        node.material = Array.isArray(node.material)
          ? node.material.map(one => one.clone())
          : node.material.clone()
      })
      object.userData.privateMaterial = true
    }
    object.traverse(node => eachMaterial(node, material => setOpacity(material, opacity)))
  }

  /**
   * Rotate the named children of a model.
   *
   * The characters are exported with named nodes — hips, torso, head, arms,
   * legs, weaponMount — no skeleton and no clips, so a walk cycle is game code
   * writing `entity.pose = { legLeft: -0.4, legRight: 0.4 }` and this turning it
   * into an X-axis rotation on the node of that name. The trade is deliberate:
   * a skinned mesh would cost a rig, an exporter contract, a clip mixer and a
   * state machine to blend between clips, and would buy nothing this game needs.
   * The poses are half a dozen angles a behaviour already computes from speed,
   * and a hinge per limb is the whole feature.
   */
  function applyPose(object, pose) {
    const nodes = namedNodes.get(object)
    // Still loading. The next frame will pose it, and there is no state to keep.
    if (!nodes) return
    for (const name of Object.keys(pose)) {
      const node = nodes[name]
      if (!node) {
        report(`[render] ${object.userData.model || object.userData.entity}: no node named "${name}" to pose`)
        continue
      }
      const angle = pose[name]
      // The fast path first: this runs for every limb of every character every
      // frame, and naming the failure costs a string whether or not there is one.
      const wanted = Number.isFinite(angle) ? angle : number(angle, 0, `pose.${name}`)
      // Added to where the part was declared to rest. A model's nodes rest at
      // zero, so this is the same line it always was for them.
      node.rotation.x = (node.userData.restRotationX || 0) + wanted
    }
  }

  // ------------------------------------------------------ merging static work

  /**
   * Several hundred boxes, drawn in a few dozen calls.
   *
   * A Counter-Strike map is mostly walls that never move, and every one of them
   * is its own size, so instancing buys almost nothing — on de_dust2 only 41 of
   * 281 entities share a size with seven others. Merging by MATERIAL is the
   * right axis: 233 brushes are drawn from about eight textures.
   *
   * Two rules keep it honest. Batches are cut by a grid cell as well as by
   * material, because one merged geometry spanning the whole map has one
   * bounding sphere and can never be frustum-culled — the merge would buy draw
   * calls by selling culling. And an entity only joins once it has held still
   * for SETTLE frames, so anything a person is dragging, or a door swinging, is
   * simply never in a batch. A merged entity keeps its own mesh for picking, on
   * a layer the camera does not draw.
   */
  const MERGE_CELL = 32      // metres; big enough to group, small enough to cull
  const MERGE_MINIMUM = 4    // below this, merging costs more than it saves
  const SETTLE = 45          // frames of stillness before a thing counts as static

  const batches = new Map()  // batch key -> { material, members, object, dirty }
  const stillness = new Map() // entity id -> { signature, frames, batch }

  function leaveBatch(id) {
    const record = stillness.get(id)
    if (!record?.batch) return
    const batch = batches.get(record.batch)
    if (batch) { batch.members.delete(id); batch.dirty = true }
    record.batch = null
    const object = meshes.get(id)
    if (object) object.layers.set(DRAWN)
  }

  function joinBatch(entity, record, key, materialKey) {
    let batch = batches.get(key)
    if (!batch) {
      batch = { material: null, members: new Set(), object: null, dirty: true }
      batches.set(key, batch)
    }
    // Re-read the material on every join rather than only on the first. A hot
    // reload throws away every shared material, and a batch still holding the
    // one it was created with would go on drawing the texture that was edited.
    batch.material = meshMaterial(entity, materialKey)
    batch.members.add(entity.id)
    batch.dirty = true
    record.batch = key
  }

  function rebuildBatches() {
    for (const [key, batch] of batches) {
      if (!batch.dirty) continue
      batch.dirty = false

      if (batch.object) {
        scene.remove(batch.object)
        // The merged geometry belongs to this batch alone, unlike the cached
        // box geometry it was built from.
        batch.object.geometry.dispose()
        batch.object = null
      }

      const members = [...batch.members].map(id => meshes.get(id)).filter(Boolean)
      if (members.length < MERGE_MINIMUM) {
        for (const member of members) member.layers.set(DRAWN)
        if (!batch.members.size) batches.delete(key)
        continue
      }

      batch.object = new THREE.Mesh(mergeMeshes(members), batch.material)
      batch.object.matrixAutoUpdate = false
      batch.object.userData.batch = key
      // The merged copy is what is drawn, so it is what has to cast and receive.
      // Casting is part of the batch key, so every member agrees and the first
      // one speaks for all.
      batch.object.castShadow = members[0].castShadow
      batch.object.receiveShadow = members[0].receiveShadow
      scene.add(batch.object)
      for (const member of members) member.layers.set(MERGED)
    }
  }

  /** Whether this entity is standing still enough, and plainly enough, to merge. */
  function considerForMerging(entity, described, opacity, isModel) {
    // A model is a scene graph rather than one box, so there is nothing here to
    // merge; a dimmed entity has its own material and would take the whole batch
    // with it; a hidden one has to be able to disappear on its own.
    const canMerge = !isModel && opacity >= 1 && !entity.hidden
    const signature = `${entity.x},${entity.y},${entity.z || 0},${facingRadians(entity)},${entity.scale ?? 1}|${described.look}`

    let record = stillness.get(entity.id)
    if (!record) stillness.set(entity.id, record = { signature: null, frames: 0, batch: null })

    if (record.signature !== signature) {
      // It moved. Leave the batch this frame, before anything is drawn, or the
      // merged copy stays behind at the old place as a ghost.
      leaveBatch(entity.id)
      record.signature = signature
      record.frames = 0
      return
    }
    if (record.frames < SETTLE) record.frames++

    const wanted = canMerge && record.frames >= SETTLE
    if (wanted && !record.batch) {
      const cellX = Math.floor(entity.x / MERGE_CELL)
      const cellZ = Math.floor((entity.z || 0) / MERGE_CELL)
      // Casting is part of the key, not just material and cell. One merged mesh
      // has one castShadow flag, so a batch holding both a caster and a
      // non-caster has to pick one and is wrong for half its members.
      const casts = meshes.get(entity.id)?.castShadow === false ? 'flat' : 'casts'
      joinBatch(entity, record, `${described.material}|${casts}|${cellX},${cellZ}`, described.material)
    } else if (!wanted && record.batch) {
      leaveBatch(entity.id)
    }
  }

  // ------------------------------------------------------------- the viewmodel

  /**
   * The weapon in your hands, drawn in its own pass.
   *
   * A first-person weapon sits about half a metre from the eye, and in one
   * shared depth buffer that means it pushes into every wall you stand near.
   * There is no fix in the world pass — scaling it down or pulling it closer
   * only moves the distance at which it happens — so it is drawn afterwards,
   * against a cleared depth buffer, through a camera of its own. Its camera is
   * narrower, around 54 degrees against the world's 90, because a 90 degree view
   * of something 40 cm away is a fish-eye and reads as a toy. It has its own
   * light so a rifle looks the same in a tunnel as it does in the open, which is
   * what players actually expect even though it is not what light does.
   *
   * Its scene is in view space: the camera stays at the origin looking down -Z,
   * so a position is straight out of the eye and nothing has to track where the
   * player is.
   */
  const viewmodelScene = new THREE.Scene()
  const viewmodelCamera = new THREE.PerspectiveCamera(54, 1, 0.01, 20)
  const viewmodelRoot = new THREE.Group()
  viewmodelRoot.rotation.order = 'YXZ'
  viewmodelScene.add(viewmodelRoot)
  viewmodelScene.add(new THREE.AmbientLight(new THREE.Color('#aab6c8'), 1.1))
  const viewmodelKey = new THREE.DirectionalLight(new THREE.Color('#fff4e2'), 1.5)
  viewmodelKey.position.set(1.4, 2.2, 2.6)
  viewmodelScene.add(viewmodelKey)

  const viewmodelBase = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }
  const viewmodelShift = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }
  let viewmodelHeld = null

  function clearViewmodel() {
    if (!viewmodelHeld) return
    viewmodelRoot.remove(viewmodelHeld)
    // Anything still in flight for this pair of hands — the hands themselves, or
    // the weapon hanging off them — checks this before it does its work.
    viewmodelHeld.userData.stale = true
    attachedModels.delete(viewmodelHeld)
    namedNodes.delete(viewmodelHeld)
    // Only what was built here is disposed. A cloned model shares its geometry
    // and its materials with the cache and with every other copy of that file,
    // so disposing those would blank the character wearing the same rifle.
    viewmodelHeld.traverse(node => {
      if (!node.userData.ownGeometry) return
      node.geometry.dispose()
      eachMaterial(node, material => material.dispose())
    })
    viewmodelHeld = null
  }

  function placeViewmodel() {
    if (!viewmodelHeld) return
    viewmodelRoot.position.set(
      viewmodelBase.position.x + viewmodelShift.position.x,
      viewmodelBase.position.y + viewmodelShift.position.y,
      viewmodelBase.position.z + viewmodelShift.position.z)
    viewmodelRoot.rotation.set(
      viewmodelBase.rotation.x + viewmodelShift.rotation.x,
      viewmodelBase.rotation.y + viewmodelShift.rotation.y,
      viewmodelBase.rotation.z + viewmodelShift.rotation.z)
    viewmodelRoot.scale.setScalar(viewmodelBase.scale)
  }

  // --------------------------------------------------------- post-processing

  /**
   * An ordered list of passes, and no opinion whatever about what they do.
   *
   * The renderer must not grow a list of effects. Which effects a game wants —
   * bloom on the muzzle flash, a flashbang wash, a scope blur — is a decision
   * the game makes and therefore a decision a plugin makes, and putting the list
   * here is the tempting wrong answer that turns one GL context into a framework.
   * All this knows is the order, and that an empty list means draw straight to
   * the canvas: no composer, no render target, no cost.
   */
  let passList = []
  let composer = null
  let composerPass = null
  let composerFor = null

  function buildComposer() {
    const wanted = passList
    composerFor = wanted
    Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js')
    ]).then(([composerModule, renderModule]) => {
      if (composerFor !== wanted) return
      composer = new composerModule.EffectComposer(renderer)
      composerPass = new renderModule.RenderPass(scene, activeCamera())
      composer.addPass(composerPass)
      for (const pass of wanted) composer.addPass(pass)
      composer.setSize(viewport.width, viewport.height)
    }).catch(error => {
      report(`[render] passes: post-processing could not start (${error?.message}) — drawing straight to the canvas`)
      composer = null
      composerPass = null
    })
  }

  // ------------------------------------------------------------------- counts

  /**
   * What the last frame cost.
   *
   * Read as `context.renderer.stats`. It exists so that the next change to this
   * file can be measured rather than guessed at: `drawCalls` before and after is
   * the whole argument for merging, and `merged` against `entities` says how
   * much of the map the merge actually caught.
   */
  const stats = {
    drawCalls: 0, triangles: 0,
    entities: 0, merged: 0, batches: 0,
    materials: 0, textures: 0, geometries: 0, programs: 0
  }

  function resize() {
    const r = canvas.getBoundingClientRect()
    viewport.width = Math.max(1, r.width)
    viewport.height = Math.max(1, r.height)
    renderer.setSize(viewport.width, viewport.height, false)
    composer?.setSize(viewport.width, viewport.height)
    updateCamera()
  }

  /**
   * Draw at a stated size instead of the window's.
   *
   * A game is designed for a screen shape, and the shape of the window an
   * agent happens to have is not it. `resize()` puts the window's own size
   * back.
   */
  function frameSize(width, height) {
    viewport.width = Math.max(1, Math.round(width))
    viewport.height = Math.max(1, Math.round(height))
    renderer.setSize(viewport.width, viewport.height, false)
    composer?.setSize(viewport.width, viewport.height)
    updateCamera()
  }

  const flat = () => view.mode === 'ortho'
  const activeCamera = () => (flat() ? orthographic : perspective)

  function updateCamera() {
    if (flat()) {
      const hw = viewport.width / 2 / view.zoom
      const hh = viewport.height / 2 / view.zoom
      orthographic.left = -hw; orthographic.right = hw
      orthographic.top = hh;   orthographic.bottom = -hh
      orthographic.position.x = view.x
      orthographic.position.y = view.y
      orthographic.updateProjectionMatrix()
      return
    }
    perspective.position.set(view.x, view.y, view.z || 0)
    // The order was set once at construction, so this is yaw about +Y and pitch
    // about +X in the order the view object promises.
    perspective.rotation.set(view.pitch || 0, view.yaw || 0, 0)
    perspective.fov = view.fov || 90
    perspective.aspect = viewport.width / Math.max(1, viewport.height)
    perspective.updateProjectionMatrix()

    viewmodelCamera.aspect = perspective.aspect
    viewmodelCamera.updateProjectionMatrix()
  }

  /**
   * The camera, ready to be projected through outside of a draw.
   *
   * `render()` refreshes the world matrices as a side effect, so anything asking
   * where a point lands on screen between two frames would otherwise read the
   * matrices from the frame before the camera moved.
   */
  function readyCamera() {
    updateCamera()
    const camera = activeCamera()
    // A camera's updateMatrixWorld also refreshes matrixWorldInverse, which is
    // the half project() and the raycaster actually read.
    camera.updateMatrixWorld()
    return camera
  }

  const toNDC = (px, py) => new THREE.Vector2(
    (px / Math.max(1, viewport.width)) * 2 - 1,
    1 - (py / Math.max(1, viewport.height)) * 2
  )

  /** Everything the ray meets, nearest first, skipping what is not being drawn. */
  function rayHits(px, py) {
    readyCamera()
    scene.updateMatrixWorld()
    raycaster.setFromCamera(toNDC(px, py), activeCamera())
    // Recursive, because a model is a group of meshes rather than one mesh.
    return raycaster.intersectObjects([...meshes.values()], true).filter(hit => shownInTree(hit.object))
  }

  return {
    // Both are the session's objects, re-exposed so existing plugins that reach
    // for renderer.view keep working.
    view,
    get size() { return { w: viewport.width, h: viewport.height } },
    scene,
    // The one currently drawing, so a caller that wants the camera gets the one
    // the picture came out of rather than whichever was built first.
    get camera() { return activeCamera() },
    get stats() { return { ...stats } },
    /** 'loading' | 'ready' | 'failed' | null — so a capture can wait for a
        declared model instead of shipping the placeholder box. */
    modelState: file => modelCache.get(file)?.status || null,
    // Which lights cast is a decision about the level, and the plugin that owns
    // the lights needs somewhere to read the switch and set its quality.
    get shadowMap() { return renderer.shadowMap },

    resize,
    frameSize,

    /** Push entity state into the scene graph. Called every frame. */
    sync(world) {
      const painters = flat()
      const live = new Set()

      world.entities.forEach((entity, i) => {
        live.add(entity.id)
        const described = describe(entity)
        const object = objectFor(entity, described)
        object.position.set(entity.x, entity.y + anchorOffset(entity), entity.z || 0)
        object.visible = !entity.hidden

        if (entity.mesh) {
          const declared = meshOf(entity)
          // Solid geometry carries its own size, so scale multiplies rather
          // than sets. Rotation is about Y, not Z: on a wall, `rotation` means
          // which way it faces, and tipping it over is never what was meant.
          const s = (entity.scale ?? 1) * (declared.model ? number(declared.scale, 1, `${entity.type}.mesh.scale`) : 1)
          object.scale.set(s, s, s)
          object.rotation.set(0, facingRadians(entity), 0)
          // The editor dims a hovered entity to preview it.
          const opacity = entity.opacity ?? 1
          dim(object, opacity)
          // A named part of a body built from boxes poses exactly as a named
          // node of a model does, so a run cycle is the same four numbers
          // either way and game code never asks which the body is made of.
          if (entity.pose && (declared.model || declared.parts)) applyPose(object, entity.pose)
          // Unconditional for a model, because taking an attachment off is as
          // much a state as putting one on: a body that dropped its rifle stops
          // declaring one, and the hand has to empty.
          if (declared.model) applyAttachments(object, entity.attachments)
          // Depth decides what covers what, so there is nothing to order.
          object.renderOrder = 0
          considerForMerging(entity, described, opacity, !!declared.model || Array.isArray(declared.parts))
          return
        }

        const { w, h } = drawSize(entity)
        object.rotation.set(0, 0, (entity.rotation || 0) * Math.PI / 180)
        object.scale.set(w, h, 1)
        object.material.opacity = entity.opacity ?? 1
        // Painter's order is the layering in 2D: z first, then the order the
        // level lists them in. In a first-person scene the world in front is
        // real geometry, so a sprite has to be tested against it.
        object.renderOrder = (entity.z || 0) * 1000 + i
        object.material.depthTest = !painters

        // A tiled sprite repeats once per world unit unless told otherwise.
        if (entity.sprite?.tile && object.material.map) {
          object.material.map.repeat.set(w / entity.sprite.tile, h / entity.sprite.tile)
        }

        // A sheet shows one cell. `entity.frame` is set by whoever is animating
        // it — the animation plugin, or game code directly.
        const image = object.material.map?.image
        if (entity.sprite?.sheet && image?.width) {
          const win = frameWindow(entity.sprite, entity.frame, image)
          object.material.map.repeat.set(win.repeat[0], win.repeat[1])
          object.material.map.offset.set(win.offset[0], win.offset[1])
        }

        // Facing is a mirror, not a rotation: negative X scale flips the art
        // without touching the collider or the transform gizmo.
        if (entity.flip) object.scale.x = -object.scale.x
      })

      for (const [id, object] of meshes) {
        if (live.has(id)) continue
        leaveBatch(id)
        stillness.delete(id)
        discard(object)
        meshes.delete(id)
      }

      rebuildBatches()

      // Counted after the rebuild, and only from batches that actually drew:
      // a group that never reached MERGE_MINIMUM has members but no merged
      // geometry, and reporting those as merged would flatter the number this
      // exists to be honest about.
      stats.entities = world.entities.length
      stats.merged = 0
      stats.batches = 0
      for (const batch of batches.values()) {
        if (!batch.object) continue
        stats.batches++
        stats.merged += batch.members.size
      }
      stats.materials = sharedMaterials.size
    },

    draw() {
      const camera = readyCamera()
      renderer.info.reset()

      if (composer && composerPass) {
        composerPass.scene = scene
        composerPass.camera = camera
        // A fixed step rather than a wall clock: nothing this file does may
        // depend on how long the last frame took.
        composer.render(1 / 60)
      } else {
        renderer.clear()
        renderer.render(scene, camera)
      }

      if (viewmodelHeld && !flat()) {
        placeViewmodel()
        // The whole point of the second pass: the weapon is measured against an
        // empty depth buffer, so no wall can ever be in front of it.
        renderer.clearDepth()
        renderer.render(viewmodelScene, viewmodelCamera)
      }

      stats.drawCalls = renderer.info.render.calls
      stats.triangles = renderer.info.render.triangles
      stats.textures = renderer.info.memory.textures
      stats.geometries = renderer.info.memory.geometries
      stats.programs = renderer.info.programs?.length || 0
    },

    /**
     * One draw of the world scene into a caller-owned render target, the
     * pixels read straight back into `buffer`.
     *
     * This is how a query consumes a frame as data — the See plugin's ID
     * buffer — without the canvas being touched: the bound target and the
     * clear colour are restored before returning. The clear colour is forced
     * to zero for the draw so an unwritten pixel reads back as nothing rather
     * than as whatever the page background is. What the caller changed for
     * its pass — materials, layers, visibility, the scene background — is the
     * caller's to restore. `region` is in target pixels from the bottom left,
     * because that is the orientation GL reads back in.
     */
    drawInto(target, buffer, region = null) {
      const camera = readyCamera()
      scene.updateMatrixWorld()
      const keptTarget = renderer.getRenderTarget()
      const keptColour = renderer.getClearColor(new THREE.Color())
      const keptAlpha = renderer.getClearAlpha()
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(target)
      renderer.clear()
      renderer.render(scene, camera)
      const read = region || { x: 0, y: 0, width: target.width, height: target.height }
      renderer.readRenderTargetPixels(target, read.x, read.y, read.width, read.height, buffer)
      renderer.setRenderTarget(keptTarget)
      renderer.setClearColor(keptColour, keptAlpha)
    },

    // ---- the two hook points ----

    /**
     * What a surface can be made of. `mesh.material` picks one by name.
     *
     * Registering replaces every built material, because a plugin that loads
     * after a level would otherwise have no effect until something happened to
     * change a look — a hook that works only if you got the order right is worse
     * than no hook.
     */
    materials: {
      register(name, build) {
        if (typeof name !== 'string' || !name || typeof build !== 'function') {
          report(`[render] materials.register: needs a name and a build function, got ${JSON.stringify(name)}`)
          return
        }
        materialBuilders.set(name, build)
        invalidateEverything()
      },
      has: name => materialBuilders.has(name),
      get names() { return [...materialBuilders.keys()] }
    },

    /** The ordered post-processing passes; an empty list means none at all. */
    passes: {
      /** The current list, so a neutral draw can take it away and put it back. */
      get list() { return [...passList] },
      set(list) {
        passList = Array.isArray(list) ? list.filter(Boolean) : []
        if (!passList.length) {
          composerFor = null
          composer?.dispose?.()
          composer = null
          composerPass = null
          return
        }
        buildComposer()
      },
      get list() { return [...passList] }
    },

    /**
     * The weapon in first person, in its own pass with its own depth buffer.
     *
     * `set(null)` puts it away. Position and rotation are in view space: -Z is
     * straight ahead, +X is right, +Y is up, and the origin is the eye.
     *
     * `attachments` is the same declaration an entity carries, against the named
     * nodes of whatever `model` is — which is how a pair of hands and a weapon
     * are composed into one viewmodel:
     *
     *   set({ model: 'hands-terrorist.glb', attachments: { hands: 'ak47.glb' } })
     *
     * A second `model` parameter was the other way to spell that, and it is the
     * worse one: it would say where the weapon goes in this file, where the fact
     * actually lives in the export — the hands are authored with their origin at
     * the right wrist, so a grip at (0,0,0) under the node called `hands` lands
     * in the fist. One vocabulary for "hang a model off a named node" also means
     * a silencer, a torch or a shield needs nothing new here.
     */
    viewmodel: {
      scene: viewmodelScene,

      set(spec) {
        if (!spec || !spec.model) { clearViewmodel(); return }

        viewmodelBase.position = readVector(spec.position, 'viewmodel.position')
        viewmodelBase.rotation = readVector(spec.rotation, 'viewmodel.rotation')
        viewmodelBase.scale = number(spec.scale, 1, 'viewmodel.scale')

        // Setting the weapon you are already holding is a move, not a swap. A
        // plugin that calls this from update() every frame is the obvious way to
        // write one, and rebuilding the model sixty times a second would be a
        // stutter nobody could explain from the game code.
        if (viewmodelHeld?.userData.model === spec.model) {
          placeViewmodel()
          applyAttachments(viewmodelHeld, spec.attachments)
          return
        }

        clearViewmodel()
        viewmodelShift.position = { x: 0, y: 0, z: 0 }
        viewmodelShift.rotation = { x: 0, y: 0, z: 0 }

        const held = new THREE.Group()
        held.userData.model = spec.model
        // Everything in this pass is in front of the eye by construction; see
        // loadAttachment, which reads this to decide the same for the weapon.
        held.userData.neverCull = true
        viewmodelHeld = held
        viewmodelRoot.add(held)

        model(spec.model, loaded => {
          if (viewmodelHeld !== held) return
          const instance = loaded.clone(true)
          // Never culled: it is always in front of the eye by construction, and
          // a viewmodel that vanishes at the wrong angle is the classic bug.
          instance.traverse(node => { node.frustumCulled = false })
          held.add(instance)
          indexNodes(held, instance)
          // The weapon was asked for while the hands were still loading, which
          // is the normal case on the first frame of a round.
          applyAttachments(held, held.userData.attachmentsWanted)
        }, () => {
          if (viewmodelHeld !== held) return
          // The same rule as everywhere else: a thing that failed to load is a
          // visible block, never nothing at all.
          const block = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.1, 0.4),
            new THREE.MeshBasicMaterial({ color: tint(String(spec.model)) }))
          block.userData.ownGeometry = true
          held.add(block)
        })
        placeViewmodel()
        applyAttachments(held, spec.attachments)
      },

      /** Per-frame bob, sway and kick, added on top of whatever `set` declared. */
      offset(position, rotation) {
        viewmodelShift.position = readVector(position, 'viewmodel.offset position')
        viewmodelShift.rotation = readVector(rotation, 'viewmodel.offset rotation')
        placeViewmodel()
      }
    },

    // ---- what the level says about light, fog and sky ----

    /** A flat background colour, or null to leave the page showing through. */
    setSky(colour) {
      scene.background = colour === null || colour === undefined
        ? null
        : readColour(colour, 'setSky')
    },

    /**
     * Exponential-squared fog, which is the one that reads as air rather than
     * as a wall at a fixed distance. Density 0 turns it off outright — a fog
     * with no density still costs every material a recompile to carry.
     */
    setFog(density, colour) {
      const amount = Number(density) || 0
      if (amount <= 0) { scene.fog = null; return }
      scene.fog = new THREE.FogExp2(readColour(colour, 'setFog') || new THREE.Color('#8a94a3'), amount)
    },

    setAmbient(intensity, colour) {
      const amount = readIntensity(intensity, 'setAmbient')
      if (amount !== null) ambient.intensity = amount
      const c = readColour(colour, 'setAmbient')
      if (c) ambient.color = c
    },

    /** The sun: which way it shines, how hard, and what colour. */
    setSun(direction, intensity, colour) {
      aimSun(direction)
      const amount = readIntensity(intensity, 'setSun')
      if (amount !== null) sun.intensity = amount
      const c = readColour(colour, 'setSun')
      if (c) sun.color = c
    },

    // ---- coordinate helpers, used by every viewport tool ----

    /**
     * A world point in pixels. `z` is ignored by the flat camera, which is why
     * every existing 2D caller can keep passing two numbers.
     */
    toScreen(x, y, z = 0) {
      if (flat()) {
        return {
          x: (x - view.x) * view.zoom + viewport.width / 2,
          y: viewport.height / 2 - (y - view.y) * view.zoom
        }
      }
      const camera = readyCamera()
      const point = new THREE.Vector3(x, y, z)
      // Behind the eye is a question about the camera, not about the depth
      // range: a camera looks down its own -Z, so anything with a positive z in
      // camera space is behind it. Testing the projected depth instead — which
      // is what this used to do — called a point four hundred metres in front
      // "behind", and a point genuinely behind but within range "in front", so a
      // caller drew its gizmo at a convincing wrong place.
      const behind = point.clone().applyMatrix4(camera.matrixWorldInverse).z > 0
      const p = point.project(camera)
      return {
        x: (p.x * 0.5 + 0.5) * viewport.width,
        y: (0.5 - p.y * 0.5) * viewport.height,
        behind
      }
    },

    /**
     * A pixel as a point in the world.
     *
     * Flat, this is exact. In perspective a pixel is a ray rather than a point,
     * so it resolves to whatever the ray first hits — and to the ground plane
     * when it hits nothing, because dropping a type onto empty air should still
     * land where the person was pointing.
     */
    toWorld(px, py) {
      if (flat()) {
        return {
          x: (px - viewport.width / 2) / view.zoom + view.x,
          y: view.y - (py - viewport.height / 2) / view.zoom
        }
      }
      const [hit] = rayHits(px, py)
      if (hit) return { x: hit.point.x, y: hit.point.y, z: hit.point.z }

      // rayHits has just aimed the shared raycaster through this pixel, so the
      // ray is the one to intersect the ground with — no need to build a second.
      const ray = raycaster.ray
      const toGround = ray.direction.y < -1e-6 ? -ray.origin.y / ray.direction.y : 0
      const p = ray.at(toGround > 0 ? toGround : 10, new THREE.Vector3())
      return { x: p.x, y: p.y, z: p.z }
    },

    /** Every entity under a screen point, front to back. */
    pick(world, px, py) {
      if (flat()) {
        const p = this.toWorld(px, py)
        const hits = world.entities.filter(e => {
          const { w, h } = drawSize(e)
          const a = -(e.rotation || 0) * Math.PI / 180
          const dx = p.x - e.x, dy = p.y - e.y
          const lx = dx * Math.cos(a) - dy * Math.sin(a)
          const ly = dx * Math.sin(a) + dy * Math.cos(a)
          return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2
        })
        return hits.reverse()
      }
      // The ray already answers front to back, and it answers it against the
      // geometry actually on screen rather than against a box approximating it.
      const seen = new Set()
      const found = []
      for (const hit of rayHits(px, py)) {
        const id = entityIdOf(hit.object)
        if (!id || seen.has(id)) continue
        seen.add(id)
        const e = world.byId(id)
        if (e) found.push(e)
      }
      return found
    },

    /**
     * The world ray through a screen point, for tools that want to intersect
     * their own objects — a 3D gizmo — without going through entity picking.
     *
     * `rayHits` aims the shared raycaster through the same pixel, so a tool
     * that reaches for this and then casts against its own scene objects sees
     * exactly the ray the entity pick would have used.
     */
    ray(px, py) {
      readyCamera()
      scene.updateMatrixWorld()
      raycaster.setFromCamera(toNDC(px, py), activeCamera())
      return raycaster.ray
    },

    bounds: drawSize,

    /**
     * Drop a cached file so the next draw re-fetches it.
     *
     * Textures and models are cached by name for the life of the page, which is
     * right until someone edits one — then the cache is the reason the change
     * appears to do nothing. Every reading of the file goes, because a wall, a
     * sprite and a lightmap can all be looking at the same edited PNG, and the
     * complaints go with them so a file that is fixed can be complained about
     * again if it breaks a second time.
     */
    forget(file) {
      const name = file.replace(/^assets\//, '')
      const matches = key => {
        const src = key.slice(key.lastIndexOf(':') + 1)
        return src === file || src === name
      }
      for (const key of [...texCache.keys()]) {
        if (!matches(key)) continue
        texCache.delete(key)
        texState.delete(key)
      }
      for (const key of [...variantCache.keys()]) if (matches(key)) variantCache.delete(key)
      if (modelCache.has(file)) modelCache.delete(file)
      if (modelCache.has(name)) modelCache.delete(name)
      alreadySaid.clear()
      invalidateEverything()
    }
  }
}
