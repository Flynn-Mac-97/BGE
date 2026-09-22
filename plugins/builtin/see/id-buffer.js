/**
 * The ID buffer: one offscreen draw of the world scene with every entity
 * flat-coloured by its index, read back once and consumed as numbers. It
 * answers which entity is frontmost at every pixel — the occlusion truth
 * describe() can only approximate from boxes — and it is never an image.
 *
 * visibility() finds occluders by the solo-silhouette method: one extra draw
 * per queried entity with only that entity shown, read back over its
 * projected box. A silhouette pixel the full map gives to another entity
 * names the exact thing in front. Chosen over re-drawing the scene without
 * the entity, because a solo draw costs a few draw calls and one box-sized
 * readback rather than the whole frame; and over depth-sorting box overlaps
 * against the map, because a box is not a silhouette — a neighbour inside
 * the box but never in front of the entity would be counted.
 *
 * Everything touched is restored before returning — materials, layers,
 * object visibility, the scene background and fog, the bound render target —
 * and the visible canvas is never drawn to.
 */
import { describe } from './describe.js'
import { convexHull } from './frame-facts.js'

/** render.js keeps merged members on layer 1 for the raycaster. Change both together. */
const MERGED_LAYER = 1

/** A layer nothing else uses, so a solo pass can show one entity by mask alone. */
const SOLO_MASK = 1 << 30

/** Raster edges land within a pixel of the computed box; read a little past it. */
const EDGE_MARGIN = 2

/**
 * Index to unit-range RGB.
 *
 * The pass draws into a render target with no colour space and the renderer
 * does no tone mapping, so k/255 lands in the byte buffer as exactly k.
 */
const colourOf = index =>
  [((index >> 16) & 255) / 255, ((index >> 8) & 255) / 255, (index & 255) / 255]

const indexAt = (pixels, at) => (pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2]

const noRenderer = context =>
  typeof document === 'undefined' || !context.renderer || typeof context.renderer.drawInto !== 'function'
    ? { why: 'the ID buffer needs the browser renderer — headless, use see.describe' }
    : null

/**
 * The frame as a per-pixel entity map.
 *
 * `at(x, y)` takes pixels from the top left, x rightward and y downward, the
 * same orientation every screen answer in this plugin uses. `coverage` counts
 * the pixels on which each entity is the frontmost thing.
 *
 * `hidden` says whether this tab was backgrounded at the moment of the draw.
 * A hidden or throttled tab can stop drawing, and the buffer then decodes as
 * background everywhere — a fact about the tab, not about the scene. A
 * caller must check `hidden` before trusting an empty `at()` as "nothing is
 * there".
 */
export async function idMap(context) {
  const missing = noRenderer(context)
  if (missing) return missing
  const mounted = await mount(context)
  try {
    const map = decode(mounted, await mounted.fullPass())
    map.hidden = typeof document !== 'undefined' && document.hidden === true
    return map
  } finally {
    mounted.unmount()
  }
}

/**
 * How much of each entity the camera actually shows, and who hides the rest.
 *
 * `ids` limits the answer; without it, every entity the projector puts on
 * screen is measured. `expectedPixels` is the projected box clamped to the
 * frame — what is cut off by framing can never be visible, and counting it
 * would read framing as occlusion.
 */
export async function visibility(context, ids) {
  const missing = noRenderer(context)
  if (missing) return missing
  const description = describe(context)
  const entryOf = new Map(description.visible.map(entry => [entry.id, entry]))
  const queried = Array.isArray(ids) && ids.length
    ? ids
    : description.visible.map(entry => entry.id)
  const mounted = await mount(context)
  try {
    const pixels = await mounted.fullPass()
    const map = decode(mounted, pixels)
    // One at a time, not in parallel: a solo pass moves the camera's layer
    // mask and two of them at once would read each other's frame.
    const measured = []
    for (const id of queried) measured.push(await measure(mounted, pixels, map, id, entryOf.get(id)))
    return measured
  } finally {
    mounted.unmount()
  }
}

/**
 * Pixel-true screen hulls: the convex hull of each named entity's frontmost
 * pixels, from one full ID pass. For every row an entity appears on, only its
 * leftmost and rightmost pixel matter — the hull of those edge points is the
 * hull of the whole pixel set. Percent coordinates, top-down, like every
 * screen answer. An entity with no visible pixels is absent from the answer.
 */
export async function silhouettes(context, ids) {
  const missing = noRenderer(context)
  if (missing) return missing
  const mounted = await mount(context)
  try {
    const pixels = await mounted.fullPass()
    const { width, height } = mounted
    const wanted = new Set(ids)
    const idOfIndex = new Map()
    mounted.ids.forEach((id, index) => { if (id && wanted.has(id)) idOfIndex.set(index, id) })

    const edges = new Map()
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const id = idOfIndex.get(indexAt(pixels, (row * width + column) * 4))
        if (!id) continue
        // GL stored the rows bottom-up; the answer speaks top-down.
        const y = height - 1 - row
        let spans = edges.get(id)
        if (!spans) edges.set(id, spans = new Map())
        const span = spans.get(y)
        if (!span) spans.set(y, [column, column])
        else if (column < span[0]) span[0] = column
        else if (column > span[1]) span[1] = column
      }
    }

    const hulls = {}
    for (const [id, spans] of edges) {
      const points = []
      // Both edges of the span's pixels on both edges of the row, so the
      // hull encloses the pixels instead of stopping at their top-left —
      // and a one-row silhouette still makes a real polygon.
      for (const [y, [left, right]] of spans) {
        points.push(
          [left / width * 100, y / height * 100], [(right + 1) / width * 100, y / height * 100],
          [left / width * 100, (y + 1) / height * 100], [(right + 1) / width * 100, (y + 1) / height * 100])
      }
      hulls[id] = convexHull(points).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
    }
    return hulls
  } finally {
    mounted.unmount()
  }
}

/**
 * Swap the scene into its ID form and hand back the passes over it.
 *
 * Every caller must run `unmount()` when done — it is what puts the real
 * materials, layers and visibility back.
 */
async function mount(context) {
  const [THREE, TSL] = await Promise.all([import('three/webgpu'), import('three/tsl')])
  const renderer = context.renderer
  // The scene must match the world before it is read; the loop is not
  // guaranteed to have run since the last mutation.
  renderer.sync(context.world)

  const scene = renderer.scene
  const camera = renderer.camera
  const width = Math.max(1, Math.round(context.viewport.width))
  const height = Math.max(1, Math.round(context.viewport.height))

  const objectOf = new Map()
  const hidden = []
  for (const child of scene.children) {
    if (child.userData.entity) { objectOf.set(child.userData.entity, child); continue }
    // Lights, merged batches, plugin helpers: none is an entity, and anything
    // else drawing would put a colour in the map that decodes as a wrong id.
    // A hidden batch loses nothing — its members each keep a mesh of their
    // own on the raycaster's layer, drawn below instead.
    if (child.visible) { hidden.push(child); child.visible = false }
  }

  // Index 0 is the background. Entities are numbered in world order, so two
  // maps of one unchanged world agree.
  const ids = [null]
  const swapped = []
  const made = []

  function idMaterial(original, index) {
    const map = original.map
    // A texture with an alpha edge draws its shape, not its quad. The cutout
    // shader keeps that shape while writing the exact id colour — a plain
    // textured material would tint the colour and corrupt the id. 0.5 is the
    // binary reading of a surface that really blends.
    const { texture, uniform, uv, vec3 } = TSL
    const [red, green, blue] = colourOf(index)
    const material = new THREE.MeshBasicNodeMaterial()
    material.colorNode = vec3(red, green, blue)
    if (map && (original.alphaTest > 0 || original.transparent)) {
      map.updateMatrix()
      // The map's own repeat and offset, applied by hand. UVs are in metres
      // here, which is the set the real draw samples too.
      const point = uniform(map.matrix, 'mat3').mul(vec3(uv(), 1)).xy
      material.opacityNode = texture(map, point).a
      material.alphaTest = original.alphaTest || 0.5
    }
    // The silhouette must match the real draw: the same faces culled, the
    // same depth rules — in 2D depth is off and painter's order decides,
    // exactly as it does on the canvas.
    material.side = original.side
    material.depthTest = original.depthTest
    material.depthWrite = original.depthWrite
    made.push(material)
    return material
  }

  for (const entity of context.world.entities) {
    const object = objectOf.get(entity.id)
    if (!object) continue
    const index = ids.push(entity.id) - 1
    // Every node of the entity carries its colour: a model's meshes, its
    // attachments, a part-built body's pieces, the waiting box of a model
    // still loading.
    object.traverse(node => {
      if (!node.material) return
      swapped.push({ node, material: node.material })
      node.material = idMaterial(Array.isArray(node.material) ? node.material[0] : node.material, index)
    })
  }

  // A background colour would fill the frame with a value that decodes as an
  // id; fog does nothing to these shaders but is cleared for the same reason.
  const background = scene.background
  const fog = scene.fog
  scene.background = null
  scene.fog = null

  // Merged entities are drawn by their batch, hidden above; their own meshes
  // sit on the raycaster's layer, so the camera reads that layer for the pass.
  const cameraMask = camera.layers.mask
  camera.layers.enable(MERGED_LAYER)
  const passMask = camera.layers.mask

  // No multisampling — the default — because a blended edge would average two
  // ids into a third.
  const target = new THREE.WebGLRenderTarget(width, height)

  return {
    width,
    height,
    ids,
    objectOf,

    async fullPass() {
      const pixels = new Uint8Array(width * height * 4)
      await renderer.drawInto(target, pixels)
      return pixels
    },

    /** One entity alone, read back only over `region` (GL bottom-left pixels). */
    async soloPass(object, region) {
      const kept = []
      object.traverse(node => { kept.push([node, node.layers.mask]); node.layers.mask = SOLO_MASK })
      camera.layers.mask = SOLO_MASK
      const pixels = new Uint8Array(region.width * region.height * 4)
      await renderer.drawInto(target, pixels, region)
      camera.layers.mask = passMask
      for (const [node, mask] of kept) node.layers.mask = mask
      return pixels
    },

    unmount() {
      for (const { node, material } of swapped) node.material = material
      for (const material of made) material.dispose()
      for (const child of hidden) child.visible = true
      camera.layers.mask = cameraMask
      scene.background = background
      scene.fog = fog
      target.dispose()
    }
  }
}

function decode({ width, height, ids }, pixels) {
  const coverage = new Map()
  for (let at = 0; at < pixels.length; at += 4) {
    const id = ids[indexAt(pixels, at)]
    if (id) coverage.set(id, (coverage.get(id) || 0) + 1)
  }
  return {
    width,
    height,
    total: width * height,
    coverage,
    at(x, y) {
      const column = Math.floor(x)
      const row = Math.floor(y)
      if (column < 0 || row < 0 || column >= width || row >= height) return null
      // GL stored the rows bottom-up; the answer is asked for top-down.
      return ids[indexAt(pixels, ((height - 1 - row) * width + column) * 4)] || null
    }
  }
}

async function measure(mounted, fullPixels, map, id, entry) {
  const visiblePixels = map.coverage.get(id) || 0
  if (!entry) {
    // Off screen by projection. Any pixels the map still shows are honest —
    // the projector and the raster can disagree at the frame's edge.
    return { id, visiblePixels, expectedPixels: 0, visibleFraction: 0, occludedBy: [], offScreen: true }
  }

  const { width, height } = mounted
  const boxWidth = entry.size[0] / 100 * width
  const boxHeight = entry.size[1] / 100 * height
  const left = Math.max(0, entry.at[0] / 100 * width - boxWidth / 2)
  const right = Math.min(width, entry.at[0] / 100 * width + boxWidth / 2)
  const top = Math.max(0, entry.at[1] / 100 * height - boxHeight / 2)
  const bottom = Math.min(height, entry.at[1] / 100 * height + boxHeight / 2)
  const expectedPixels = Math.round(Math.max(0, right - left) * Math.max(0, bottom - top))

  const columnFirst = Math.max(0, Math.floor(left) - EDGE_MARGIN)
  const columnLast = Math.min(width, Math.ceil(right) + EDGE_MARGIN)
  const rowFirst = Math.max(0, Math.floor(top) - EDGE_MARGIN)
  const rowLast = Math.min(height, Math.ceil(bottom) + EDGE_MARGIN)
  const region = {
    x: columnFirst,
    // Rows here are measured from the top; GL reads from the bottom left.
    y: height - rowLast,
    width: columnLast - columnFirst,
    height: rowLast - rowFirst
  }

  const occluders = new Map()
  const object = mounted.objectOf.get(id)
  if (object && region.width > 0 && region.height > 0) {
    const solo = await mounted.soloPass(object, region)
    for (let row = 0; row < region.height; row++) {
      for (let column = 0; column < region.width; column++) {
        if (!indexAt(solo, (row * region.width + column) * 4)) continue
        // The entity covers this pixel; whoever the full map shows instead is
        // in front of it there. Both buffers are bottom-up GL rows, so the
        // offsets line up with no flip.
        const front = mounted.ids[indexAt(fullPixels, ((region.y + row) * width + region.x + column) * 4)]
        if (!front || front === id) continue
        occluders.set(front, (occluders.get(front) || 0) + 1)
      }
    }
  }

  return {
    id,
    visiblePixels,
    expectedPixels,
    visibleFraction: expectedPixels ? Math.round(visiblePixels / expectedPixels * 1000) / 1000 : 0,
    occludedBy: [...occluders]
      .map(([by, pixels]) => ({ id: by, pixels }))
      .sort((a, b) => b.pixels - a.pixels)
  }
}
