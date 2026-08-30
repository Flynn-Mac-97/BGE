/**
 * The See sweep: every See capability on one seeded played moment.
 *
 * Two readers. The assertions prove each query verb's numbers headless. The
 * frames — one per capability, captioned with the method — are for a human in
 * the Tests panel: real capture, types sketch, subject portrait, moment sheet,
 * and one drawn visualisation per query verb. Drawing needs a 2D canvas, so
 * headless notes what the browser would show instead of failing.
 */
const PLAY_CAMERA = { x: 0, y: 12.1, z: 13.4, pitch: -1.05, yaw: 0, fov: 50, mode: 'perspective' }

/** Frames drawn here are half the viewport, the same size see.sketch draws. */
const scaleOf = viewport => ({
  width: Math.round(viewport.width / 2),
  height: Math.round(viewport.height / 2)
})

/** A see reply's picture, whichever form it came in — files, dataUrl, or __files. */
const asFrame = shot => shot.files || shot.dataUrl
  || (shot.__files && `data:image/png;base64,${shot.__files[0].base64}`)

/** The sidecar JSON out of a browser reply's __files. Both encoders wrote UTF-8. */
const sidecarOf = shot => {
  const entry = shot.__files?.find(file => file.path.endsWith('.json'))
  return entry ? JSON.parse(decodeURIComponent(escape(atob(entry.base64)))) : null
}

/** A dark canvas with every visible entity as a dim box, far first, for overlays. */
function drawBase(description, viewport) {
  const { width, height } = scaleOf(viewport)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const pen = canvas.getContext('2d')
  pen.fillStyle = '#202830'
  pen.fillRect(0, 0, width, height)
  pen.fillStyle = 'rgba(150, 160, 170, 0.3)'
  for (const entry of [...description.visible].sort((a, b) => b.depth - a.depth)) {
    const box = boxOf(entry, canvas)
    pen.fillRect(box.x, box.y, box.w, box.h)
  }
  return { canvas, pen }
}

/** Screen-percent entry to canvas pixels, centre to top-left corner. */
function boxOf(entry, canvas) {
  const w = Math.max(1, entry.size[0] / 100 * canvas.width)
  const h = Math.max(1, entry.size[1] / 100 * canvas.height)
  return {
    x: entry.at[0] / 100 * canvas.width - w / 2,
    y: entry.at[1] / 100 * canvas.height - h / 2,
    w, h,
    cx: entry.at[0] / 100 * canvas.width,
    cy: entry.at[1] / 100 * canvas.height
  }
}

function drawArrow(pen, fromX, fromY, toX, toY) {
  pen.beginPath()
  pen.moveTo(fromX, fromY)
  pen.lineTo(toX, toY)
  pen.stroke()
  const angle = Math.atan2(toY - fromY, toX - fromX)
  pen.beginPath()
  pen.moveTo(toX, toY)
  pen.lineTo(toX - 6 * Math.cos(angle - 0.5), toY - 6 * Math.sin(angle - 0.5))
  pen.lineTo(toX - 6 * Math.cos(angle + 0.5), toY - 6 * Math.sin(angle + 0.5))
  pen.closePath()
  pen.fill()
}

export default {
  name: 'the see sweep — every See capability on one played moment',
  level: 'meadow',

  async run(test) {
    const see = test.context.see
    const viewport = test.context.viewport
    const inBrowser = typeof document !== 'undefined'

    // Play to 0:30 the way the battery does, taking the first card at the
    // level-up screen; drain any queued choices, because a held world answers
    // a screen, not the field.
    test.simulate(8)
    await test.run('choice.pick', 1)
    test.simulate(22)
    for (let taken = 0; test.context.choiceScreen?.isOpen && taken < 5; taken++) {
      await test.run('choice.pick', 1)
    }

    // The played framing on the live view: see.diff and see.camera read
    // context.view, and the frames below must show the same moment the
    // numbers measure. The runner reloads the level afterwards, which puts
    // the editor camera back.
    Object.assign(test.context.view, PLAY_CAMERA)

    // ---- describe: the index every other answer builds on
    const description = see.describe()
    test.ok(description.visible.some(entry => entry.id === 'you'), 'describe puts the kitten on screen at 0:30')
    const regionTotal = Object.values(description.regions)
      .reduce((sum, cell) => sum + Object.values(cell).reduce((n, count) => n + count, 0), 0)
    test.is(regionTotal, description.counts.visible, 'region counts add up to the visible count')

    // ---- between: the computed pair relation, through describe
    const pair = see.describe({ between: ['you', 'floor'] })
    test.ok(Number.isFinite(pair.between?.distance), 'between answers a distance for a named pair')

    // ---- find: predicate search over every entity
    const rats = see.find({ type: 'rat' })
    test.ok(rats.count > 0, `find returns rats — ${rats.count} matched`)

    // ---- occlusion: visible fraction and blockers
    const cover = await see.occlusion({ of: 'you' })
    test.ok(cover.visibleFraction >= 0 && cover.visibleFraction <= 1,
      `occlusion fraction ${cover.visibleFraction} is between 0 and 1, by ${cover.method}`)

    // ---- camera: whose box holds the eye, what presses the lens
    const lens = see.camera()
    test.ok(lens.insideOf.length === 0 || lens.insideOf.every(entry => entry.id),
      lens.insideOf.length === 0
        ? 'the eye is inside nothing'
        : `the eye is inside ${lens.insideOf.map(entry => entry.id).join(', ')} — named, not guessed`)
    test.ok(Array.isArray(lens.nearerThanHalfAMetre), 'the near-plane test answered')

    // ---- the real capture, kept for the light frame below
    let capture = null
    if (inBrowser) {
      capture = await test.run('see.capture', { camera: PLAY_CAMERA, name: 'see-sweep-capture' })
      test.frame(asFrame(capture), 'see.capture — the rendered frame at 0:30, marks stamped')
    } else {
      test.note('see.capture needs the browser renderer — run in the editor for the real frame')
    }

    // ---- the types sketch, drawn from the same facts everywhere
    const sketch = await test.run('see.sketch', { camera: PLAY_CAMERA, name: 'see-sweep-types' })
    test.ok(!!asFrame(sketch), 'the types sketch answered')
    test.frame(asFrame(sketch), 'see.sketch — flat type-colour boxes from describe facts, no renderer')

    // ---- the subject portrait
    const portrait = await test.run(inBrowser ? 'see.capture' : 'see.sketch',
      { subject: 'you', name: 'see-sweep-portrait' })
    test.ok(portrait.marks?.['1'] === 'you', 'the subject is mark 1 in its own portrait')
    test.frame(asFrame(portrait),
      `${inBrowser ? 'see.capture' : 'see.sketch'} with subject — the kitten framed by frameSubject, mark 1`)

    // ---- isolate: the one-entity dossier; costs one fixed step for velocity
    const dossier = await see.isolate({ subject: 'you' })
    test.ok(dossier.onScreen, 'isolate finds the kitten on screen')
    test.ok(Array.isArray(dossier.velocity) && dossier.velocity.every(Number.isFinite),
      `isolate measured velocity [${dossier.velocity}] by one fixed step`)

    // ---- diff: what moved over exact steps
    const change = see.diff({ steps: 30 })
    const after = see.describe()
    test.ok(change.moved.length > 0, `diff names ${change.moved.length} movers over ${change.steps} fixed steps`)

    // ---- drawn visualisations, one per query verb — a 2D canvas is browser only
    if (inBrowser) {
      // Occlusion: the subject's box in green, each blocker's box tinted red.
      const occlusionDrawn = drawBase(description, viewport)
      const subject = description.visible.find(entry => entry.id === 'you')
      const blockers = new Set(cover.blockedBy.map(entry => entry.id))
      for (const entry of description.visible) {
        if (!blockers.has(entry.id)) continue
        const box = boxOf(entry, occlusionDrawn.canvas)
        occlusionDrawn.pen.fillStyle = 'rgba(220, 60, 60, 0.55)'
        occlusionDrawn.pen.fillRect(box.x, box.y, box.w, box.h)
      }
      if (subject) {
        const box = boxOf(subject, occlusionDrawn.canvas)
        occlusionDrawn.pen.strokeStyle = '#40d060'
        occlusionDrawn.pen.lineWidth = 2
        occlusionDrawn.pen.strokeRect(box.x, box.y, box.w, box.h)
      }
      test.frame(occlusionDrawn.canvas.toDataURL('image/png'),
        `see.occlusion — subject green, blockers red; ${cover.visibleFraction} visible by ${cover.method}`)

      // Diff: an arrow per mover from its old screen place to its new one,
      // drawn over the after moment. Length tripled or a half-second walk is
      // an invisible arrow.
      const diffDrawn = drawBase(after, viewport)
      diffDrawn.pen.strokeStyle = '#f0c040'
      diffDrawn.pen.fillStyle = '#f0c040'
      diffDrawn.pen.lineWidth = 1.5
      const afterById = new Map(after.visible.map(entry => [entry.id, entry]))
      for (const mover of change.moved) {
        const entry = afterById.get(mover.id)
        if (!entry) continue
        const box = boxOf(entry, diffDrawn.canvas)
        const dx = mover.by[0] / 100 * diffDrawn.canvas.width * 3
        const dy = mover.by[1] / 100 * diffDrawn.canvas.height * 3
        drawArrow(diffDrawn.pen, box.cx - dx, box.cy - dy, box.cx, box.cy)
      }
      test.frame(diffDrawn.canvas.toDataURL('image/png'),
        `see.diff — movement arrows (length x3) over ${change.steps} steps; ${change.moved.length} moved`)

      // Camera: a dashed inset stands for the near plane; anything nearer
      // than half a metre is filled red; containers of the eye are written out.
      const cameraDrawn = drawBase(description, viewport)
      const near = new Set(lens.nearerThanHalfAMetre.map(entry => entry.id))
      for (const entry of description.visible) {
        if (!near.has(entry.id)) continue
        const box = boxOf(entry, cameraDrawn.canvas)
        cameraDrawn.pen.fillStyle = 'rgba(230, 40, 40, 0.7)'
        cameraDrawn.pen.fillRect(box.x, box.y, box.w, box.h)
      }
      cameraDrawn.pen.strokeStyle = '#e04040'
      cameraDrawn.pen.setLineDash([6, 4])
      cameraDrawn.pen.strokeRect(cameraDrawn.canvas.width * 0.12, cameraDrawn.canvas.height * 0.12,
        cameraDrawn.canvas.width * 0.76, cameraDrawn.canvas.height * 0.76)
      cameraDrawn.pen.setLineDash([])
      cameraDrawn.pen.fillStyle = '#ffffff'
      cameraDrawn.pen.font = 'bold 14px system-ui, sans-serif'
      cameraDrawn.pen.fillText(
        `inside: ${lens.insideOf.map(entry => entry.id).join(', ') || 'nothing'} · near: ${lens.nearerThanHalfAMetre.length}`,
        8, 20)
      test.frame(cameraDrawn.canvas.toDataURL('image/png'),
        'see.camera — dashed near-plane inset, sub-half-metre entities red, eye containers named')

      // Regions: the 3x3 grid describe counts in, each cell captioned with
      // its total and its commonest type.
      const regionsDrawn = drawBase(description, viewport)
      const { width, height } = regionsDrawn.canvas
      regionsDrawn.pen.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      regionsDrawn.pen.lineWidth = 1
      for (const third of [1, 2]) {
        regionsDrawn.pen.strokeRect(width * third / 3, 0, 0.1, height)
        regionsDrawn.pen.strokeRect(0, height * third / 3, width, 0.1)
      }
      regionsDrawn.pen.fillStyle = '#ffffff'
      regionsDrawn.pen.font = 'bold 14px system-ui, sans-serif'
      const columns = ['left', 'centre', 'right']
      const rowNames = ['top', 'middle', 'bottom']
      for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
        const cellName = rowNames[row] === 'middle' && columns[column] === 'centre'
          ? 'centre' : `${rowNames[row]}-${columns[column]}`
        const cell = description.regions[cellName] || {}
        const total = Object.values(cell).reduce((sum, count) => sum + count, 0)
        const commonest = Object.entries(cell).sort((a, b) => b[1] - a[1])[0]
        regionsDrawn.pen.fillText(
          `${total}${commonest ? ` (${commonest[0]} ${commonest[1]})` : ''}`,
          column * width / 3 + 8, row * height / 3 + 22)
      }
      test.frame(regionsDrawn.canvas.toDataURL('image/png'),
        `see.describe regions — 3x3 counts by type, ${description.counts.visible} visible in all`)

      // Light: the capture sidecar's 4x4 brightness cells as grey squares.
      const light = capture && sidecarOf(capture)?.light
      if (light) {
        test.ok(light.mean >= 0 && light.mean <= 100, `capture light mean ${light.mean} is 0-100`)
        const lightCanvas = document.createElement('canvas')
        const cell = 80
        lightCanvas.width = cell * 4
        lightCanvas.height = cell * 4
        const pen = lightCanvas.getContext('2d')
        pen.font = 'bold 16px system-ui, sans-serif'
        pen.textAlign = 'center'
        pen.textBaseline = 'middle'
        light.grid.forEach((value, index) => {
          const grey = Math.round(value * 2.55)
          pen.fillStyle = `rgb(${grey},${grey},${grey})`
          pen.fillRect((index % 4) * cell, Math.floor(index / 4) * cell, cell, cell)
          pen.fillStyle = value > 50 ? '#000000' : '#ffffff'
          pen.fillText(String(value), (index % 4) * cell + cell / 2, Math.floor(index / 4) * cell + cell / 2)
        })
        test.frame(lightCanvas.toDataURL('image/png'),
          `capture light — 4x4 mean-brightness cells 0-100, frame mean ${light.mean}`)
      }
    } else {
      test.note('the occlusion, diff, camera, regions and light frames need a 2D canvas — run in the browser to draw them')
    }

    // ---- the moment sheet, last: it advances the world again
    if (inBrowser) {
      const moment = await test.run('see.moment', { steps: [0, 6, 30], name: 'see-sweep-moment' })
      test.ok(moment.moments?.length === 3, 'the moment sheet answered all three instants')
      test.frame(asFrame(moment), 'see.moment — render beside its type layer at +0, +6, +30 steps')
    } else {
      test.note('see.moment needs the browser renderer — the sheet pairs render and type layer per instant')
    }
  }
}
