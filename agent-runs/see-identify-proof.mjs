/**
 * Proof that see/queries.js identify() answers pixel identity correctly and
 * names every failure honestly: bad input, no renderer, a hidden tab, a
 * stale id, an unpainted background, the frame's own edge, and a percent
 * converted against the wrong width.
 *
 * The renderer-truth cases build a fake context.renderer whose drawInto()
 * paints known id-colours into the readback buffer, so id-buffer.js's real
 * mount()/decode() code runs unchanged — only the GPU draw is faked, nothing
 * about the id-buffer or identify() logic is.
 *
 * A scratch file in agent-runs, not a test in the project.
 *
 *   node agent-runs/see-identify-proof.mjs
 */
import { identify } from '../plugins/builtin/see/queries.js'

const results = []
const check = (what, ok, detail = '') => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

// ------------------------------------------------------------- fixtures

/** The colour id-buffer.js's colourOf() writes for one index — its stable, documented encoding. */
const rgbOfIndex = index => [(index >> 16) & 255, (index >> 8) & 255, index & 255]

/** Write one pixel, converting a top-down (x, y) to the bottom-up row the GL buffer stores. */
function paintPixel(pixels, width, height, x, y, rgb) {
  const glRow = height - 1 - y
  const at = (glRow * width + x) * 4
  pixels[at] = rgb[0]; pixels[at + 1] = rgb[1]; pixels[at + 2] = rgb[2]; pixels[at + 3] = 255
}

/** Same index order mount() assigns: world entities, in order, that have a drawn child. */
function indexAssignments(entities, withMesh) {
  const assigned = new Map()
  let next = 1
  for (const entity of entities) if (withMesh.has(entity.id)) assigned.set(entity.id, next++)
  return assigned
}

/** A fake renderer: sync() and layers are no-ops, drawInto() paints the requested rectangles. */
function fakeRenderer(width, height, entities, withMesh, rectangles) {
  const assigned = indexAssignments(entities, withMesh)
  const children = entities.filter(entity => withMesh.has(entity.id)).map(entity => ({
    userData: { entity: entity.id },
    visible: true,
    material: {},
    traverse(run) { run(this) }
  }))
  return {
    sync() {},
    scene: { children, background: null, fog: null },
    camera: { layers: { mask: 0, enable(bit) { this.mask |= (1 << bit) } } },
    drawInto(target, pixels) {
      for (const rect of rectangles) {
        const index = assigned.get(rect.id)
        if (!index) continue
        const rgb = rgbOfIndex(index)
        for (let y = rect.y0; y <= rect.y1; y++) {
          for (let x = rect.x0; x <= rect.x1; x++) paintPixel(pixels, width, height, x, y, rgb)
        }
      }
    }
  }
}

const DEFAULT_VIEW = { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, fov: 90, mode: 'perspective' }

function makeContext({ viewport, entities, withMesh, rectangles, view, withRenderer = true }) {
  const context = {
    world: {
      entities,
      types: new Map(),
      byId(id) { return entities.find(entity => entity.id === id) }
    },
    view: view || DEFAULT_VIEW,
    viewport
  }
  if (withRenderer) context.renderer = fakeRenderer(viewport.width, viewport.height, entities, withMesh || new Set(), rectangles || [])
  return context
}

const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance

// --------------------------------------------------- input validation

const results1 = await Promise.all([
  identify({}, {}),
  identify({}, { at: [50] }),
  identify({}, { at: [50, 'x'] }),
  identify({}, { at: [50, NaN] }),
  identify({}, { at: [-1, 50] }),
  identify({}, { at: [50, 101] })
])
check('a missing "at" is a named error, not a throw', /identify needs/.test(results1[0].error || ''), results1[0].error)
check('a one-element "at" is rejected', /identify needs/.test(results1[1].error || ''))
check('a non-numeric "at" element is rejected', /identify needs/.test(results1[2].error || ''))
check('a NaN "at" element is rejected', /identify needs/.test(results1[3].error || ''))
check('a negative percent is rejected', /0-100/.test(results1[4].error || ''), results1[4].error)
check('a percent over 100 is rejected', /0-100/.test(results1[5].error || ''), results1[5].error)

// ---------------------------------------------- headless: no renderer

// document is undefined in plain Node, so identify() must fall to geometry
// on its own, honestly, with no renderer attached at all.
const near8 = { id: 'near', type: 'rat', x: 0, y: 0, z: 8, mesh: { box: [2, 2, 2] } }
const far2 = { id: 'far', type: 'rat', x: 0, y: 0, z: -2, mesh: { box: [2, 2, 2] } }
const headlessContext = makeContext({
  viewport: { width: 100, height: 100 }, entities: [near8, far2], withRenderer: false
})

const headlessHit = await identify(headlessContext, { at: [50, 50] })
check('headless: no renderer answers, geometry does', headlessHit.method?.startsWith('boxes:'), headlessHit.method)
check('headless: names why the renderer did not answer', /headless/.test(headlessHit.rendererWhy || ''), headlessHit.rendererWhy)
check('headless: two overlapping boxes, the nearer (smaller depth) wins', headlessHit.id === 'near', headlessHit.id)

const headlessMiss = await identify(headlessContext, { at: [5, 5] })
check('headless: a point no box covers is background, not a guess',
  headlessMiss.hitBackground === true && headlessMiss.id === null, JSON.stringify(headlessMiss))

// --------------------------------------------- renderer truth: exact hit

globalThis.document = { hidden: false }
try {
  const rat = { id: 'rat-1', type: 'rat', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] }, note: 'a test rat' }
  const exactContext = makeContext({
    viewport: { width: 100, height: 100 },
    entities: [rat],
    withMesh: new Set(['rat-1']),
    rectangles: [{ id: 'rat-1', x0: 40, y0: 40, x1: 60, y1: 60 }]
  })
  const exactHit = await identify(exactContext, { at: [50, 50] })
  check('id-buffer: an exact drawn pixel names the entity', exactHit.id === 'rat-1' && exactHit.type === 'rat', JSON.stringify(exactHit))
  check('id-buffer: method says renderer truth', exactHit.method === 'id-buffer: exact drawn pixel', exactHit.method)
  check('id-buffer: authored note travels with the hit', exactHit.description?.note === 'a test rat', JSON.stringify(exactHit.description))

  const exactBackground = await identify(exactContext, { at: [5, 5] })
  check('id-buffer: an unpainted pixel is background, not an error',
    exactBackground.hitBackground === true && exactBackground.id === null, JSON.stringify(exactBackground))

  // ------------------------------------------- renderer truth: stale id
  const ghost = { id: 'ghost-1', type: 'ghost', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] } }
  const staleContext = makeContext({
    viewport: { width: 20, height: 20 },
    entities: [ghost],
    withMesh: new Set(['ghost-1']),
    rectangles: [{ id: 'ghost-1', x0: 0, y0: 0, x1: 19, y1: 19 }]
  })
  staleContext.world.byId = () => undefined // the buffer drew it; the world has since lost it
  const staleHit = await identify(staleContext, { at: [50, 50] })
  check('id-buffer: an id the world no longer knows is named, not dropped',
    staleHit.id === 'ghost-1' && staleHit.type === null && /no longer exists/.test(staleHit.why || ''),
    JSON.stringify(staleHit))

  // ---------------------------------------- renderer truth: edge clamp
  const edge = { id: 'edge-1', type: 'coin', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] } }
  const edgeContext = makeContext({
    viewport: { width: 10, height: 10 },
    entities: [edge],
    withMesh: new Set(['edge-1']),
    rectangles: [{ id: 'edge-1', x0: 9, y0: 9, x1: 9, y1: 9 }]
  })
  const edgeHit = await identify(edgeContext, { at: [100, 100] })
  check('id-buffer: percent 100 lands on the last pixel, not one past it', edgeHit.id === 'edge-1', JSON.stringify(edgeHit))
  const originHit = await identify(edgeContext, { at: [0, 0] })
  check('id-buffer: percent 0 reads the first pixel, unpainted here, as background',
    originHit.hitBackground === true, JSON.stringify(originHit))

  // ------------------------------ renderer truth: device pixel ratio
  // Painted at columns 40-45, rows 10-15 of a 64x48 buffer. The query percent
  // is chosen to land inside that rectangle ONLY when converted against this
  // buffer's own 64x48 — converted against a 2x backing buffer (128x96, the
  // shape a devicePixelRatio of 2 would produce) the same percent lands at
  // column 85, row 25, which this test leaves unpainted.
  const coin = { id: 'coin-1', type: 'coin', x: 0, y: 0, z: 0, mesh: { box: [1, 1, 1] } }
  const dprContext = makeContext({
    viewport: { width: 64, height: 48 },
    entities: [coin],
    withMesh: new Set(['coin-1']),
    rectangles: [{ id: 'coin-1', x0: 40, y0: 10, x1: 45, y1: 15 }]
  })
  const xPercent = (42.5 / 64) * 100
  const yPercent = (12.5 / 48) * 100
  const wrongColumn = Math.floor(xPercent / 100 * 128)
  const wrongRow = Math.floor(yPercent / 100 * 96)
  check('the wrong (2x) denominator would have missed the paint — the test is a real trap',
    wrongColumn < 40 || wrongColumn > 45 || wrongRow < 10 || wrongRow > 15,
    `wrong column ${wrongColumn}, row ${wrongRow}`)
  const dprHit = await identify(dprContext, { at: [xPercent, yPercent] })
  check('id-buffer: percent converts against the buffer\'s own width and height, never a backing-buffer size',
    dprHit.id === 'coin-1', JSON.stringify(dprHit))

  // -------------------------------------------- hidden tab is refused
  document.hidden = true
  const hiddenContext = makeContext({
    viewport: { width: 100, height: 100 },
    entities: [near8, far2],
    withMesh: new Set(['near', 'far']),
    // Painted so a broken guard would answer from here — proving the guard,
    // not just an absence of paint, is what forces the geometry path.
    rectangles: [{ id: 'near', x0: 40, y0: 40, x1: 60, y1: 60 }]
  })
  const hiddenHit = await identify(hiddenContext, { at: [50, 50] })
  check('a hidden tab is refused rather than trusted', hiddenHit.method?.startsWith('boxes:'), hiddenHit.method)
  check('a hidden tab names itself as the reason geometry answered instead',
    /hidden/.test(hiddenHit.rendererWhy || ''), hiddenHit.rendererWhy)
  check('geometry still answers correctly once the renderer is refused', hiddenHit.id === 'near', hiddenHit.id)
} finally {
  delete globalThis.document
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
