/**
 * Decals — a mark left on the surface something happened to.
 *
 * A bullet hole, a blood splatter, a scorch mark, a footprint. One call, at the
 * point a ray came back with:
 *
 *   context.decals.place({
 *     at: hit.point, normal: hit.normal, size: 0.08,
 *     texture: 'decals/bullet-hole.png'
 *   })
 *
 * Three things make this an engine feature rather than "spawn a flat entity".
 *
 * 1. **It is oriented by the surface, not by the shooter.** The normal a
 *    raycast returns is the face the ray came in through, so a hole lies flat
 *    on the wall instead of facing whoever made it.
 *
 * 2. **It is nudged out of the wall.** A quad sitting exactly on a wall fights
 *    it for depth, and the result flickers as the camera moves — instantly
 *    visible and instantly cheap-looking. One millimetre along the normal is
 *    below what anyone can see at a metre and far above the depth buffer's
 *    resolution at forty.
 *
 * 3. **The total is capped and the oldest is recycled.** Shooters shipped with a
 *    fixed decal budget for machines with sixteen megabytes; a browser tab that
 *    has to stay at sixty frames while it garbage-collects needs it more, not
 *    less. A single fight puts down a mark per hit, and without a ceiling the
 *    wall grows without bound for as long as the round lasts.
 *
 * Every placement is recorded whether or not anything is drawing, so a headless
 * run still answers "did that shot mark the wall" —
 * `node bin/engine.mjs run decals.recent` — the same way the audio plugin
 * answers "did that make a noise".
 */
import { assetURL } from '../../engine/asset-path.js'

/**
 * How many marks exist at once.
 *
 * 300 is a good number for the same reason it always was: it is more than a
 * round's worth of marks on any one wall, so the recycling is invisible while
 * you play, and it is few enough that rebuilding every one of them into a
 * buffer is a few thousand float writes.
 */
const CAP = 300

/** One millimetre out of the surface. See the note above about depth fighting. */
const OFFSET = 0.001

/** How much of a decal's life is spent fading out, when it has a life at all. */
const FADE_TAIL = 0.25

// ---------------------------------------------------------------- the wall
/**
 * Every mark currently on the world, in a ring.
 *
 * A ring is the cap: the slot the cursor is about to write is by construction
 * the oldest one, so recycling costs nothing and there is no list to sort. The
 * alternative — grow, then prune when it gets long — has a pause in it, and the
 * pause lands in the middle of a firefight.
 */
export function makeDecalWall() {
  const slots = new Array(CAP).fill(null)
  let cursor = 0
  let placed = 0
  let recycled = 0
  /**
   * Bumped whenever what should be on screen has changed, so a renderer can
   * rebuild its buffers on change rather than every frame. It is a number
   * rather than a flag because the renderer attaches later than the first
   * placement and has to be able to tell that it has missed something.
   */
  let revision = 1
  let clock = () => 0

  const live = () => slots.filter(Boolean).sort((a, b) => a.id - b.id)

  const wall = {
    /**
     * The clock this measures lives against. Handed in rather than read from
     * anywhere, because a decal's life is engine seconds — the same clock a
     * test steps — and nothing here may reach the wall clock.
     */
    bind(timeSource) { clock = timeSource },

    get cap() { return CAP },
    get count() { return slots.reduce((n, d) => n + (d ? 1 : 0), 0) },
    get revision() { return revision },
    /** Read, do not mutate: the renderer walks this list every rebuild. */
    get all() { return live() },

    /**
     * Put one mark on a surface.
     *
     * @param at       where the ray hit, in world metres
     * @param normal   the face it hit, as the raycast reported it
     * @param size     a number for a square, or [width, height]
     * @param texture  the picture, resolved the way every other asset is
     * @param life     seconds before it disappears; 0 (the default) means it
     *                 stays until the cap recycles it, which is what a bullet
     *                 hole should do
     * @param tint     multiplied into the texture — the colour of the surface
     *                 for dust, of the blood for blood
     * @param rotation radians about the normal. Handed in rather than rolled
     *                 here, because the only honest source of a random number
     *                 is the caller's `context.random`.
     */
    place(options = {}) {
      const at = asVector(options.at)
      if (!at) {
        report('at', 'decals.place needs an "at" of { x, y, z } — nothing was placed')
        return null
      }
      const normal = normalise(asVector(options.normal)) || { x: 0, y: 1, z: 0 }
      const [width, height] = sizeOf(options.size)
      if (!(width > 0 && height > 0)) {
        report('size', `decals.place was asked for a decal ${width} by ${height} metres — nothing was placed`)
        return null
      }

      const life = Math.max(0, Number(options.life) || 0)
      const now = clock()
      const decal = {
        id: ++placed,
        // Where it is drawn: the hit point, lifted out of the wall.
        x: at.x + normal.x * OFFSET,
        y: at.y + normal.y * OFFSET,
        z: at.z + normal.z * OFFSET,
        // And where the ray actually landed, kept so a test can assert the
        // offset was applied rather than assert the offset it just computed.
        point: { x: at.x, y: at.y, z: at.z },
        normal,
        width,
        height,
        rotation: Number(options.rotation) || 0,
        texture: options.texture || '',
        tint: options.tint || '#ffffff',
        placedAt: round(now),
        expiresAt: life > 0 ? now + life : 0
      }

      if (slots[cursor]) recycled++
      slots[cursor] = decal
      cursor = (cursor + 1) % CAP
      revision++
      return decal
    },

    /**
     * Age the wall by one fixed step.
     *
     * Only decals with a life have anything to do here, so a wall of permanent
     * marks costs one pass over 300 slots and no rebuild.
     */
    step() {
      const now = clock()
      let fading = false
      for (let i = 0; i < CAP; i++) {
        const decal = slots[i]
        if (!decal || !decal.expiresAt) continue
        if (now >= decal.expiresAt) { slots[i] = null; revision++; continue }
        fading = true
      }
      // A fading decal changes what is on screen without anything being placed,
      // so the renderer has to be told to look again.
      if (fading) revision++
    },

    /** How opaque one decal is now: full, then out over the last of its life. */
    alpha(decal, now = clock()) {
      if (!decal.expiresAt) return 1
      const life = decal.expiresAt - decal.placedAt
      const left = (decal.expiresAt - now) / (life || 1)
      return Math.max(0, Math.min(1, left / FADE_TAIL))
    },

    clear() {
      slots.fill(null)
      cursor = 0
      revision++
    },

    /** The most recent marks, oldest first — what `decals.recent` answers with. */
    recent(n = 20) {
      return live().slice(-n).map(decal => ({
        id: decal.id,
        at: [round(decal.x), round(decal.y), round(decal.z)],
        normal: [decal.normal.x, decal.normal.y, decal.normal.z],
        size: [round(decal.width), round(decal.height)],
        texture: decal.texture,
        tint: decal.tint,
        placedAt: decal.placedAt,
        expiresAt: decal.expiresAt ? round(decal.expiresAt) : 0
      }))
    },

    get state() {
      return { cap: CAP, alive: wall.count, placed, recycled, revision }
    }
  }

  return wall
}

/**
 * The one wall, at module scope for the same reason Physics 3D keeps its grid
 * there: a test imports this file directly and has to be looking at the marks
 * the running world actually made, not at a second copy of the machinery.
 */
export const decals = makeDecalWall()

// ------------------------------------------------------------------ the plugin
export default {
  name: 'Decals',
  category: 'visuals',
  about: 'Marks on the surfaces they hit — bullet holes, blood, scorch — within a fixed budget.',
  inspect: context => {
    const s = context.decals.state
    return [{ title: 'Budget', rows: [['alive', s.alive], ['cap', s.cap], ['placed', s.placed], ['recycled', s.recycled]] }]
  },

  onLoad(context) {
    if (context.decals) {
      console.error('[decals] something else already put decals on context — replacing it')
    }
    decals.bind(() => context.time)
    context.decals = decals

    // A new level is a clean wall. Otherwise the marks from the last level are
    // still there, at coordinates that now mean somewhere else entirely.
    context.bus.on('level:loaded', () => { decals.clear(); said.clear() })

    // Drawing waits for the shell, because the renderer does not exist until
    // then — and in a headless world it never does, which is not an error.
    context.bus.on('shell:ready', () => attachDrawing(context))
  },

  systems: [
    {
      phase: 'fixed',
      run() { decals.step() }
    },
    {
      phase: 'frame',
      run() { painter?.sync(decals) }
    }
  ],

  commands: [
    {
      id: 'decals.recent',
      label: 'Marks left on the world',
      run: (context, n) => context.decals.recent(typeof n === 'number' ? n : 20)
    },
    {
      id: 'decals.state',
      label: 'How full the decal budget is',
      run: context => context.decals.state
    },
    {
      id: 'decals.clear',
      label: 'Wipe every decal',
      run: context => { context.decals.clear(); return context.decals.state }
    }
  ]
}

// ------------------------------------------------------------------ drawing
/**
 * One mesh per texture, not one mesh per decal.
 *
 * Three hundred marks drawn one at a time is three hundred draw calls
 * for something nobody looks at directly. Merged into one buffer per texture it
 * is two or three, and rebuilding the whole buffer on change is cheaper than
 * the bookkeeping that would let us update one quad in place.
 */
let painter = null

function attachDrawing(context) {
  if (painter || !context.renderer?.scene) return
  // Loaded on demand rather than imported at the top of the file, because a
  // headless world has no renderer and should not pay to parse a 3D library
  // it will never call. Ten of them start at once; it adds up.
  import('three/webgpu')
    .then(THREE => { painter = makePainter(THREE, context.renderer.scene) })
    .catch(e => console.error(`[decals] could not load three, so decals will be recorded but not drawn — ${e.message}`))
}

function makePainter(THREE, scene) {
  const loader = new THREE.TextureLoader()
  const textures = new Map()
  const groups = new Map()      // texture -> { geometry, mesh, capacity }
  let drawn = 0

  function textureFor(src) {
    if (textures.has(src)) return textures.get(src)
    const t = loader.load(assetURL(src), undefined, undefined, () => {
      console.error(`[decals] missing texture ${assetURL(src)} (referenced as "${src}")`)
    })
    t.colorSpace = THREE.SRGBColorSpace
    textures.set(src, t)
    return t
  }

  function groupFor(src, capacity) {
    let group = groups.get(src)
    if (group && group.capacity >= capacity) return group
    if (group) {
      scene.remove(group.mesh)
      group.geometry.dispose()
    }

    const size = Math.max(32, 1 << Math.ceil(Math.log2(Math.max(1, capacity))))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))
    // A Lambert material with no normals is lit by nothing but ambient, and the
    // symptom is a decal that is a black smudge in full sun.
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(size * 4 * 3), 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(size * 4 * 2), 2))
    // Four components, so alpha travels with the tint and a decal can fade out
    // without needing a material of its own.
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(size * 4 * 4), 4))
    const index = new Uint32Array(size * 6)
    for (let quad = 0; quad < size; quad++) {
      const v = quad * 4
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6)
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1))

    const material = new THREE.MeshLambertMaterial({
      map: src ? textureFor(src) : null,
      transparent: true,
      vertexColors: true,
      // Depth is tested — a hole behind a crate is hidden by it — but not
      // written, so two overlapping decals blend instead of clipping each
      // other. The polygon offset is belt and braces beside the millimetre:
      // the millimetre survives a camera far away, the offset survives one
      // pressed against the wall.
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      // A decal is a flat quad on a surface, and which way its winding came out
      // depends on a cross product with a helper axis. Drawing both sides costs
      // nothing here and removes a whole class of "my decal is invisible
      // from the left" bugs.
      side: THREE.DoubleSide
    })
    // Lambert rather than Basic so a mark in a dark corner is dark. A
    // full-bright decal on a lit wall reads as a sticker.
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    scene.add(mesh)

    group = { geometry, mesh, capacity: size }
    groups.set(src, group)
    return group
  }

  return {
    sync(wall) {
      if (wall.revision === drawn) return
      drawn = wall.revision

      const byTexture = new Map()
      for (const decal of wall.all) {
        const list = byTexture.get(decal.texture)
        if (list) list.push(decal)
        else byTexture.set(decal.texture, [decal])
      }
      // A texture that has no decals left this frame still has a mesh, and the
      // mesh has to be emptied or its last state stays on screen forever.
      for (const src of groups.keys()) if (!byTexture.has(src)) byTexture.set(src, [])

      for (const [src, list] of byTexture) {
        const group = groupFor(src, list.length)
        const position = group.geometry.attributes.position
        const normal = group.geometry.attributes.normal
        const uv = group.geometry.attributes.uv
        const colour = group.geometry.attributes.color

        list.forEach((decal, i) => {
          const [tangent, bitangent] = basis(decal.normal, decal.rotation)
          const halfWidth = decal.width / 2
          const halfHeight = decal.height / 2
          const rgb = readColour(decal.tint)
          const alpha = wall.alpha(decal)

          // Corners anticlockwise from bottom-left, which is the winding the
          // shared index buffer above expects.
          const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]
          corners.forEach(([sx, sy, u, v], corner) => {
            const at = i * 4 + corner
            position.setXYZ(at,
              decal.x + tangent.x * sx * halfWidth + bitangent.x * sy * halfHeight,
              decal.y + tangent.y * sx * halfWidth + bitangent.y * sy * halfHeight,
              decal.z + tangent.z * sx * halfWidth + bitangent.z * sy * halfHeight)
            normal.setXYZ(at, decal.normal.x, decal.normal.y, decal.normal.z)
            uv.setXY(at, u, v)
            colour.setXYZW(at, rgb.r, rgb.g, rgb.b, alpha)
          })
        })

        // Everything past the live decals is collapsed to a point rather than
        // left holding the previous frame's geometry.
        for (let at = list.length * 4; at < group.capacity * 4; at++) {
          position.setXYZ(at, 0, 0, 0)
          colour.setXYZW(at, 0, 0, 0, 0)
        }

        position.needsUpdate = true
        normal.needsUpdate = true
        uv.needsUpdate = true
        colour.needsUpdate = true
        group.geometry.setDrawRange(0, list.length * 6)
      }
    }
  }
}

// ------------------------------------------------------------------ small print
/**
 * Two axes across the surface, from the one axis out of it.
 *
 * The helper is swapped when the normal is nearly vertical, because a cross
 * product with a parallel vector has no length and the decal would come out
 * with no size at all — a floor is exactly the case that hits it.
 */
function basis(normal, rotation) {
  const helper = Math.abs(normal.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const tangent = normalise(cross(helper, normal)) || { x: 1, y: 0, z: 0 }
  const bitangent = cross(normal, tangent)
  if (!rotation) return [tangent, bitangent]
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [
    { x: tangent.x * cos + bitangent.x * sin, y: tangent.y * cos + bitangent.y * sin, z: tangent.z * cos + bitangent.z * sin },
    { x: bitangent.x * cos - tangent.x * sin, y: bitangent.y * cos - tangent.y * sin, z: bitangent.z * cos - tangent.z * sin }
  ]
}

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})

function normalise(vector) {
  if (!vector) return null
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!(length > 0)) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

/** A point written as {x,y,z} or [x,y,z] — an argument typed at a terminal is an array. */
function asVector(value) {
  if (Array.isArray(value)) return { x: +value[0] || 0, y: +value[1] || 0, z: +value[2] || 0 }
  if (value && typeof value === 'object') return { x: +value.x || 0, y: +value.y || 0, z: +value.z || 0 }
  return null
}

const sizeOf = size => (Array.isArray(size)
  ? [Number(size[0]) || 0, Number(size[1]) || 0]
  : [Number(size) || 0.25, Number(size) || 0.25])

/**
 * A hex colour as linear floats.
 *
 * Three works in linear light and converts a texture for you, but not a vertex
 * colour — so a tint written the way a person writes one, `#c9b489`, has to be
 * converted here or every decal comes out visibly too bright.
 */
function readColour(value) {
  const text = String(value || '#ffffff').trim()
  const hex = /^#([0-9a-f]{3})$/i.test(text)
    ? text[1] + text[1] + text[2] + text[2] + text[3] + text[3]
    : (/^#([0-9a-f]{6})$/i.test(text) ? text.slice(1) : null)
  if (!hex) {
    report(`colour:${text}`, `cannot read the colour ${JSON.stringify(value)} — using white`)
    return { r: 1, g: 1, b: 1 }
  }
  const n = parseInt(hex, 16)
  return {
    r: toLinear(((n >> 16) & 255) / 255),
    g: toLinear(((n >> 8) & 255) / 255),
    b: toLinear((n & 255) / 255)
  }
}

const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

/**
 * Say it once, not sixty times a second. Silence is the enemy, but a caller
 * placing a broken decal every frame would otherwise fill the log until
 * nothing else in it can be read.
 */
const said = new Set()
function report(key, message) {
  if (said.has(key)) return
  said.add(key)
  console.error(`[decals] ${message}`)
}

const round = n => Math.round(n * 1000) / 1000
