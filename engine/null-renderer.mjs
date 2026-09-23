/**
 * Kernel: the screen a node world pretends to have.
 *
 * Node has no canvas, so a headless world draws nothing. This module holds the
 * two pieces that let the draw-time commands run instead of refusing: a canvas
 * of a stated size holding no pixels, and a renderer surface with no GL behind
 * it. Nothing here may report a frame it did not draw.
 */

/**
 * A canvas of a stated size holding no pixels.
 *
 * `see.capture` copies the drawn frame onto one of these and reads it back to
 * check the frame is not blank. Nothing drew, so every pixel is transparent and
 * that check answers blank — which is the truth. `toDataURL` throws rather than
 * hand back an image of nothing.
 */
function nullCanvas(width = 1, height = 1) {
  /** A zeroed ImageData of one size, for a readback of a frame nothing drew. */
  // eslint-disable-next-line id-denylist -- ImageData names this field data.
  const blankPixels = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) })
  const pen = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    drawImage() {},
    fillRect() {},
    fillText() {},
    measureText: () => ({ width: 0 }),
    beginPath() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    save() {},
    restore() {},
    createImageData: (w, h) => blankPixels(w, h),
    putImageData() {},
    getImageData: (x, y, w, h) => blankPixels(w, h)
  }
  return {
    width,
    height,
    getContext: () => pen,
    toDataURL() {
      throw new Error('nothing drew this frame, so there is no image to encode')
    }
  }
}

/**
 * A pass graph with the real one's verbs and no executor.
 *
 * A plugin registers a pass whether or not anything draws, so this keeps the
 * pass set for a test to read and does nothing else. Nothing here reports a
 * frame it did not draw.
 */
function makeNullGraph() {
  const records = new Map()
  return {
    add(record) {
      if (record?.name) records.set(record.name, record)
    },
    remove(name) {
      records.delete(name)
    },
    replace(name, record) {
      records.set(name, { ...record, name })
    },
    disable(name) {
      const pass = records.get(name)
      if (pass) pass.enabled = false
    },
    enable(name) {
      const pass = records.get(name)
      if (pass) pass.enabled = true
    },
    get passes() {
      return [...records.values()].filter(pass => pass.enabled !== false)
    },
    run() {}
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
 *
 * @param {object} view The camera view.
 * @param {object} viewport The screen size, mutated by `frameSize`.
 * @param {object} shape The frame size `resize` restores.
 * @returns {object} The renderer surface, with `blank` true.
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

  /** Set the viewport to the frame size a capture asked for. */
  const frameSize = (width, height) => {
    viewport.width = Math.max(1, Math.round(width))
    viewport.height = Math.max(1, Math.round(height))
  }

  return {
    blank: true,
    view,
    scene,
    get size() {
      return { w: viewport.width, h: viewport.height }
    },
    get stats() {
      return { ...stats }
    },
    // No camera object, because nothing projects through one here. Headless
    // screen positions come from engine/camera-project.js and the view.
    camera: null,
    // No model is ever loaded, so a capture has nothing to wait for.
    modelState: () => null,
    shadowMap: { enabled: false },
    readability: { keyline: 0, contactShadow: false, groundRing: false },
    createCanvas: nullCanvas,

    resize() {
      frameSize(shape.width, shape.height)
    },
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

    draw() {
      stats.frames++
    },

    /** Every pixel unwritten, which is what a draw that draws nothing leaves. */
    drawInto(target, buffer) {
      buffer.fill(0)
      stats.readbacks++
    },

    materials: {
      register() {},
      has: () => false,
      get names() {
        return []
      }
    },

    graph: makeNullGraph()
  }
}

/**
 * Attach the stand-in as a world's screen.
 *
 * This is the hook the browser mounts its shell and renderer through, so the
 * two halves attach a screen at one point in the start-up order. The shell gets
 * the fake canvas, and the renderer gets the surface with no GL behind it.
 *
 * @param {object} context The started world.
 */
export function mountNullScreen(context) {
  const shape = { width: context.viewport.width, height: context.viewport.height }
  context.shell = { canvas: nullCanvas(shape.width, shape.height), draw() {} }
  context.renderer = nullRenderer(context.view, context.viewport, shape)
}
