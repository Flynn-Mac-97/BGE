/**
 * Kernel: what each entity is drawn as, computed without a GL context.
 *
 * The renderer works out, every frame and for every entity, its material key,
 * shape, turn and stillness signature. None of that needs a card: it is
 * arithmetic on the entity and its type declaration. Keeping it here rather
 * than inside `makeRenderer` is what lets a headless run measure the per-frame
 * cost — `profile.plan` times `planFrame` — and it leaves one implementation of
 * a thing's size and look instead of one per consumer.
 *
 * `meshMaterial` and `geometryFor` stay in render.js. Those build real GPU
 * objects, they are cached, and they are not the per-frame cost.
 */

/** Everything already complained about, so each distinct message is said once. */
const alreadySaid = new Set()

/**
 * Complain once per distinct message.
 *
 * The shape and the numbers are read for every entity every frame, so a
 * message about a bad declaration would otherwise arrive sixty times a second.
 */
function report(message) {
  if (alreadySaid.has(message)) return
  alreadySaid.add(message)
  console.error(message)
}

/**
 * A number a declaration promised, or the fallback — and never silently.
 *
 * A value that was never given is not a failure — a missing size is answered by
 * the deliberately visible metre cube — so only a value that was written down
 * and cannot be read is worth a line.
 */
export function number(value, fallback = 1, where = null) {
  if (Number.isFinite(value)) return value
  if (where && value !== undefined && value !== null) {
    report(`[render] ${where}: ${JSON.stringify(value)} is not a number — using ${fallback}`)
  }
  return fallback
}

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
export function meshOf(entity) {
  const declared = entity.mesh
  if (!declared) return null
  return typeof declared === 'string' ? { texture: declared } : declared
}

/**
 * How much bigger than its declared box a thing is actually drawn.
 *
 * Two scales multiply: the placement's `scale`, and a model's own `mesh.scale`.
 * Every answer about a thing's size has to use the same product the draw uses,
 * or a query reports one size and the screen shows another.
 */
export function totalScale(entity) {
  const declared = meshOf(entity)
  const model = declared?.model ? number(declared.scale, 1, `${entity.type}.mesh.scale`) : 1
  return (entity.scale ?? 1) * model
}

/** Degrees off a declaration, in radians. A missing axis is zero, not a complaint. */
export const degrees = (value, where) =>
  value === undefined || value === null ? 0 : number(value, 0, where) * Math.PI / 180

/**
 * How a body is turned, in radians about X, Y and Z.
 *
 * `rotation` is the editor's handle, in degrees. `yaw` is what game code sets
 * while the world runs, in radians, and it beats the declared yaw while leaving
 * a declared pitch and roll alone. `rotation` takes either a bare number of
 * degrees of yaw or `[x, y, z]`, the two forms `mesh.parts` takes.
 */
export function turnRadians(entity) {
  const declared = entity.rotation
  const turn = Array.isArray(declared)
    ? {
      x: degrees(declared[0], `${entity.type}.rotation[0]`),
      y: degrees(declared[1], `${entity.type}.rotation[1]`),
      z: degrees(declared[2], `${entity.type}.rotation[2]`)
    }
    : { x: 0, y: degrees(declared, `${entity.type}.rotation`), z: 0 }
  if (Number.isFinite(entity.yaw)) turn.y = entity.yaw
  return turn
}

/**
 * How far a flat sprite is spun on screen, in radians about Z.
 *
 * A sprite is drawn on the screen plane, so its single number is a spin about Z
 * where a solid body's is a yaw about Y. Same key, two planes, because a flat
 * game and a solid one mean different things by "turned".
 */
export const spinRadians = entity => Array.isArray(entity.rotation)
  ? degrees(entity.rotation[2], `${entity.type}.rotation[2]`)
  : degrees(entity.rotation, `${entity.type}.rotation`)

const partsCache = new WeakMap()

/**
 * A mesh declaration's part list, measured once.
 *
 * The parts of a declaration never change while it is the same array, so the
 * box, the offsets and the signature are computed once and handed back. The
 * signature is what tells an edited type to rebuild.
 */
export function partsOf(declared, where = 'mesh') {
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
      // The same three degrees an entity's own `rotation` array takes, read the
      // same way, because a part and the body it belongs to are turned alike.
      turn: {
        x: degrees(turn[0], `${spot}.rotation[0]`),
        y: degrees(turn[1], `${spot}.rotation[1]`),
        z: degrees(turn[2], `${spot}.rotation[2]`)
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
 * How finely a shape is divided, from the declaration.
 *
 * One by default, because a wall wants four vertices and not four hundred. It
 * is only worth raising for a material that moves them.
 */
function subdivisionOf(declared, entity) {
  if (declared.segments === undefined) return 1
  return number(declared.segments, 1, `${entity.type}.mesh.segments`)
}

/**
 * What an entity's mesh is: a shape and three numbers, or null for a sprite.
 *
 * `box` and `quad` say it outright. `parts` is measured from the boxes it lists,
 * unless the type also states a box. A `model` brings its own geometry, so the
 * numbers only describe how big it counts as, and the collider is the honest
 * source for that. Anything else takes the collider's box. A metre cube is the
 * last resort, and it is deliberately a size you can see.
 */
export function meshShape(entity) {
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
  if (declared.sphere !== undefined) {
    const said = Array.isArray(declared.sphere) ? declared.sphere : [declared.sphere, declared.sphere, declared.sphere]
    const r = index => number(said[index], 0.5, `${entity.type}.mesh.sphere[${index}]`) * 2
    return { kind: 'sphere', w: r(0), h: r(1), d: r(2), segments: subdivisionOf(declared, entity) }
  }

  if (Array.isArray(declared.quad)) {
    const w = declared.quad[0], h = declared.quad[1]
    const segments = subdivisionOf(declared, entity)
    if (Number.isFinite(w) && Number.isFinite(h)) return { kind: 'quad', w, h, d: 0, segments }
    return {
      kind: 'quad',
      w: number(w, 1, `${entity.type}.mesh.quad[0]`),
      h: number(h, 1, `${entity.type}.mesh.quad[1]`),
      d: 0,
      segments
    }
  }

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
  if (Number.isFinite(w) && Number.isFinite(h) && Number.isFinite(d)) return { kind: 'box', w, h, d, segments: subdivisionOf(declared, entity) }
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
 * it collides with. The collider is the fallback so an untextured entity still
 * has an honest size, and a circle reports its diameter rather than silently
 * becoming 1x1. `d` is depth: zero for anything flat.
 */
export function drawSize(entity) {
  const s = totalScale(entity)
  const shape = meshShape(entity)
  if (shape) return { w: shape.w * s, h: shape.h * s, d: shape.d * s }
  const diameter = entity.collider?.circle ? entity.collider.circle * 2 : null
  return {
    w: (entity.sprite?.width ?? entity.collider?.box?.[0] ?? diameter ?? 1) * s,
    h: (entity.sprite?.height ?? entity.collider?.box?.[1] ?? diameter ?? 1) * s,
    d: 0
  }
}

/** The image a sprite points at: a sheet or a single picture. */
export const source = s => s?.sheet || s?.image || null

// ------------------------------------------------------------- the material

/**
 * How many times a texture repeats, from the declaration and the shape.
 *
 * An array is absolute — three repeats across this box, whatever its size — so
 * the bricks stay the same size instead of stretching. A single density repeats
 * once per world unit. A quad with nothing declared shows its picture once,
 * because one of those is one picture.
 */
export function tilingOf(tiling, shape, where = null) {
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
 * Which material a mesh is asking for.
 *
 * Both forms a declaration may use: `material: 'toon'`, and
 * `material: { name: 'toon', steps: 5 }` where the rest of the object is that
 * material's own parameters. `unlit: true` predates the registry and means
 * exactly `basic`.
 */
export function materialNameFor(declared) {
  const chosen = declared.material
  if (typeof chosen === 'string' && chosen.trim()) return chosen.trim()
  if (chosen && typeof chosen === 'object' && !Array.isArray(chosen) && typeof chosen.name === 'string' && chosen.name.trim()) {
    return chosen.name.trim()
  }
  return declared.unlit ? 'basic' : 'lambert'
}

/** Keys that describe the shape or choose the material, rather than tune it. */
const SHAPE_KEYS = new Set([
  'box', 'quad', 'sphere', 'segments', 'model', 'scale', 'material', 'unlit', 'tiling',
  // A part says where it is and which way it is turned. Both describe shape,
  // and a key left out of this set is stringified into the material key on
  // every part of every frame — which would also give twelve identically
  // coloured boxes twelve materials, one per position.
  'parts', 'at', 'rotation', 'name',
  // The keyline, the contact shadow and the ground ring are drawn BESIDE the
  // mesh, in their own materials. None changes what the surface is made of.
  'keyline', 'keylineColour', 'shadow', 'shadowStrength',
  'ring', 'ringColour', 'ringStrength'
])

/**
 * Everything about a mesh that decides its material, and nothing about its size.
 *
 * Dropping size from the key is what lets a 12 m wall and a 0.4 m step share one
 * material, which is what lets them be merged into one draw call. Every
 * remaining key goes in, so two toons with different step counts get two
 * materials rather than one drawing twice.
 */
export function materialLook(entity, declared, shape) {
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

// ----------------------------------------------------------------- the plan

/**
 * What one entity looks like this frame: its material key, its keyline and the
 * stillness signature that says whether its look changed.
 *
 * The signature is what `objectFor` compares to decide a rebuild, and what
 * `considerForMerging` compares to decide a move. It is kept OUT of any
 * decision about the keyline: a change to `look` counts as a move, and outlining
 * a thing must not hand it a contact shadow.
 */
export function describeEntity(entity) {
  if (!entity.mesh) {
    return {
      material: null,
      keyline: 0,
      look: source(entity.sprite)
        ? `${source(entity.sprite)}|${entity.sprite.tile ?? 0}|${entity.sprite.sheet ? 'sheet' : 'one'}`
        : `tint:${entity.type}`
    }
  }
  const declared = meshOf(entity)
  const parts = declared.model ? null : partsOf(declared, `${entity.type}.mesh`)
  if (parts) {
    // Every part carries its own material, so the entity has no single one —
    // and nothing to be merged into. The signature says when the shape changed.
    return { material: null, keyline: 0, look: `parts|${parts.signature}` }
  }
  const shape = meshShape(entity)
  const material = materialLook(entity, declared, shape)
  return {
    material,
    keyline: Number(declared.keyline) > 0 ? Number(declared.keyline) : 0,
    look: ['mesh', shape.kind, shape.w, shape.h, shape.d,
      declared.model || '', declared.scale ?? 1, material].join('|')
  }
}

/**
 * Whether a mesh entity has held still and unchanged, as one string.
 *
 * Position, turn and draw scale are in it because any of them moving takes the
 * entity out of its merged batch. The material key is in it because a texture
 * change has to show up without a reload.
 */
export function mergeSignature(entity, described, turn) {
  return `${entity.x},${entity.y},${entity.z || 0},${turn.x},${turn.y},${turn.z},${entity.scale ?? 1}|${described.look}`
}

/**
 * The pure per-entity cost of one frame, over every entity in a world.
 *
 * This is what the renderer recomputes for every entity every frame before it
 * touches a GPU object: the look, the turn, the drawn size and the stillness
 * signature. Kept callable with no card so `profile.plan` can measure it.
 */
export function planFrame(world) {
  const entities = world?.entities || []
  let meshes = 0
  let sprites = 0
  for (const entity of entities) {
    const described = describeEntity(entity)
    if (entity.mesh) {
      meshes++
      mergeSignature(entity, described, turnRadians(entity))
    } else {
      sprites++
      drawSize(entity)
      spinRadians(entity)
    }
  }
  return { entities: entities.length, meshes, sprites }
}
