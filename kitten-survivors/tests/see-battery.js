/**
 * The See battery: one played moment, proved by numbers and kept as frames.
 *
 * Two readers. The assertions are for the machine — the horde arrives, the
 * kitten stays on screen, every mark carries a hull and a legend colour, and
 * every command that refuses hands the world back exactly as it found it. The
 * frames written to agent-runs/see/ are for a human, whose eyes catch what a
 * number cannot; the run is seeded, so the frames are the same every time and
 * a change to them means the game changed.
 *
 * The whole file runs in both places. In the browser the frames are real
 * renders and the studio, the post chain and the overlays are real state to put
 * back; headless the same calls sketch from the same facts and the browser-only
 * commands answer with their refusal. Either way a refusal must leave nothing
 * behind, so the restore checks below assert the same thing in both.
 */

/** The meadow's play camera, by name. `see.view` keeps it in kitten-survivors/views.json. */
const PLAY_VIEW = 'meadow-play'

/** A see reply's picture, whichever form it came in — files, dataUrl, or __files. */
const asFrame = shot => shot.files || shot.dataUrl
  || (shot.__files && `data:image/png;base64,${shot.__files[0].base64}`)

/** The sidecar JSON out of a browser reply's __files. Both encoders wrote UTF-8. */
const sidecarOf = shot => {
  const entry = shot.__files?.find(file => file.path.endsWith('.json'))
  return entry ? JSON.parse(decodeURIComponent(escape(atob(entry.base64)))) : null
}

/**
 * Everything an image command is allowed to borrow, in one comparable value.
 *
 * Where every entity stands and whether it is hidden, the camera, the clock,
 * and — where a renderer answers — the scene's grade, its lights, its post
 * chain and its overlays. A command takes these to get its picture and must
 * give every one of them back, including on the paths where no picture
 * arrives. Two of these either side of a failing call must be the same string.
 */
const fingerprint = context => {
  const scene = context.renderer?.scene
  return JSON.stringify({
    entities: context.world.entities.map(e => [e.id, e.x, e.y, e.z, !!e.hidden]),
    camera: ['x', 'y', 'z', 'yaw', 'pitch', 'fov', 'mode', 'zoom'].map(field => context.view[field]),
    clock: [context.loop.time, context.loop.holds.join()],
    scene: scene
      ? {
          passes: context.renderer.passes?.list?.length ?? null,
          background: !!scene.background,
          fog: !!scene.fog,
          children: scene.children.length,
          shown: scene.children.filter(child => child.visible).length,
          overlays: scene.children.filter(child => child.userData?.overlay).map(child => child.visible)
        }
      : null
  })
}

/** Which field moved, so a leak names itself instead of printing the whole world. */
function whatMoved(before, after) {
  const [was, is] = [JSON.parse(before), JSON.parse(after)]
  for (const field of Object.keys(was)) {
    if (JSON.stringify(was[field]) === JSON.stringify(is[field])) continue
    if (field !== 'entities') return `${field}: ${JSON.stringify(was[field])} became ${JSON.stringify(is[field])}`
    if (was.entities.length !== is.entities.length) {
      return `entities: ${was.entities.length} became ${is.entities.length}`
    }
    const at = was.entities.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(is.entities[index]))
    return `entity ${was.entities[at][0]}: ${JSON.stringify(was.entities[at])} became ${JSON.stringify(is.entities[at])}`
  }
  return 'something changed'
}

export default {
  name: 'the see battery — a played moment, in numbers, frames and clean exits',
  level: 'meadow',

  async run(test) {
    const context = test.context
    const inBrowser = typeof document !== 'undefined'
    /** The rendered frame where there is a renderer, the same facts sketched where there is not. */
    const look = (options, name) =>
      test.run(inBrowser ? 'see.capture' : 'see.sketch', { ...options, name })

    /** A call that must refuse, and must leave nothing behind when it does. */
    const leavesNothing = async (label, command, options) => {
      const before = fingerprint(context)
      const reply = await test.run(command, options)
      const after = fingerprint(context)
      test.ok(after === before, after === before
        ? `${label} left the world exactly as it found it`
        : `${label} LEAKED — ${whatMoved(before, after)}`)
      return reply
    }

    // ---- the level as authored, through the named play camera
    const before = await test.run('see.describe', { view: PLAY_VIEW })
    test.ok(before.visible.some(entry => entry.id === 'you'), 'the kitten starts on screen')
    test.is(before.counts.offscreenByType.rat ?? 0, 0, 'no rats before the run starts')

    // Play to thirty seconds, taking the first card at each level-up screen —
    // a held world is a screen asking, and snapshot's `paused` names it.
    test.simulate(8)
    await test.run('choice.pick', 1)
    test.simulate(22)
    for (let taken = 0; context.choiceScreen?.isOpen && taken < 5; taken++) {
      await test.run('choice.pick', 1)
    }

    const during = await test.run('see.describe', { view: PLAY_VIEW, between: ['you', 'floor'] })
    const rats = during.visible.filter(entry => entry.type === 'rat')
    test.ok(rats.length >= 8, `a crowd is on screen at 0:30 — ${rats.length} rats visible`)
    test.ok(during.visible.some(entry => entry.id === 'you'), 'the kitten is still on screen')
    test.ok(during.counts.offscreen > 0, 'more of the horde is arriving from off screen')

    // ---- between: assert the answer it claims to give, not where the kitten
    // happened to walk. The one geometric fact that is true by construction is
    // that a kitten standing on the ground touches the ground.
    const pair = during.between
    test.is(pair.ids, ['you', 'floor'], 'between echoes the pair it was asked about')
    test.ok(Number.isFinite(pair.distance), `between measured a distance — ${pair.distance}m`)
    test.is(typeof pair.touching, 'boolean', 'between answers touching as a boolean')
    test.ok(/you is (left|right) of and (above|below) floor/.test(pair.onScreen),
      `between says where each sits on screen — "${pair.onScreen}"`)
    test.ok(Number.isFinite(pair.facing.you.degreesOff) && Number.isFinite(pair.facing.floor.degreesOff),
      'between answers a facing for each id')
    test.is(pair.touching, true, 'the kitten stands on the ground, so their boxes touch')

    // ---- marks are hulls in the type's colour, with a legend
    const marked = during.visible.filter(entry => entry.mark)
    test.ok(marked.length > 0, `${marked.length} entities carry a mark`)
    test.ok(marked.every(entry => Array.isArray(entry.hull) && entry.hull.length >= 3),
      'every marked entity carries a hull of at least three screen points')
    test.ok(marked.every(entry => entry.hull.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))),
      'every hull point is a finite screen percentage')
    const markedTypes = [...new Set(marked.map(entry => entry.type))]
    test.ok(markedTypes.every(type => /^#[0-9a-f]{6}$/i.test(during.palette[type] || '')),
      `the palette gives every marked type one hex colour — ${markedTypes.length} types`)
    test.is(Object.keys(during.palette).length, markedTypes.length,
      'the palette names the marked types and nothing else')

    // ---- the frames a human checks, shown in the Tests panel
    const field = await look({ view: PLAY_VIEW }, 'test-battery-30s')
    test.ok(!!asFrame(field), 'the 0:30 frame answered')
    test.frame(asFrame(field), `the field at 0:30, play camera${inBrowser ? '' : ' (sketch — run in the browser for the render)'}`)

    // The legend travels with the picture. A vision reader is handed the PNG
    // and its sidecar and never sees this reply, so both have to carry it.
    test.ok(Object.keys(field.marks || {}).length > 0,
      `the frame's reply binds ${Object.keys(field.marks || {}).length} mark numbers to ids`)
    test.ok(Object.values(field.marks).every(id => context.world.byId(id)),
      'every bound mark names an entity that exists')
    test.ok(markedTypes.every(type => field.palette?.[type]), 'the frame ships the palette legend')
    if (inBrowser) {
      const sidecar = sidecarOf(field)
      test.ok(!!sidecar?.marks && !!sidecar?.palette,
        'the sidecar FILE carries the mark map and the palette, not only the reply')
      test.is(sidecar.marks, field.marks, 'sidecar and reply bind the same marks')
    } else {
      test.note('the sidecar file is checked in the browser here; headless it is checked by agent-runs/see-restore/restore-probe.mjs')
    }

    // ---- ui: false — overlays are HUD in the scene, not world
    const worldOnly = await look({ view: PLAY_VIEW, ui: false }, 'test-battery-no-ui')
    test.ok(!!asFrame(worldOnly), 'the ui: false frame answered')
    test.is(worldOnly.counts.visible, field.counts.visible,
      'hiding the overlays changes no entity count — an overlay is not an entity')
    test.frame(asFrame(worldOnly), 'the same moment with ui: false — damage numbers and their kin left out')

    // ---- subject shots, and aiming the live camera at one
    const portrait = await look({ subject: 'you' }, 'test-battery-kitten')
    test.is(portrait.marks?.['1'], 'you', 'the subject is mark 1 in its own portrait')
    test.frame(asFrame(portrait), 'the kitten, framed as the subject')

    // A named shot is measured from the subject's own facing, so two of them
    // must not answer with one camera.
    const quarter = await test.run('see.describe', { subject: 'you' })
    const front = await test.run('see.describe', { subject: 'you', shot: 'front' })
    test.ok(quarter.camera.yaw !== front.camera.yaw,
      `three-quarter and front are different angles — yaw ${quarter.camera.yaw} against ${front.camera.yaw}`)

    // aim moves the LIVE camera, so the query verbs answer from it too.
    const aimed = await test.run('see.view', { aim: 'you', back: 3 })
    test.is(aimed.aimed, 'you', 'see.view aim names what it aimed at')
    test.ok(['x', 'y', 'z', 'yaw', 'pitch'].every(field => context.view[field] === aimed.camera[field]),
      'the live camera really moved to the camera aim reported')
    const fromAim = await test.run('see.describe', {})
    test.ok(fromAim.visible.some(entry => entry.id === 'you'),
      'the queries answer from the aimed view — the kitten is in it')
    await test.run('see.view', { go: PLAY_VIEW })
    test.ok(context.view.y === before.camera.y, 'going back to the saved view restores the play camera')

    // ---- restore safety: every error path hands the world back untouched.
    // In the browser these mutate real render state before they fail; headless
    // the browser-only pair answer with their refusal. Both must be clean.
    await leavesNothing('capture of a name that is neither entity nor type',
      'see.capture', { subject: 'not-a-thing' })
    await leavesNothing('capture of an empty studio',
      'see.capture', { subject: 'you', alone: true, camera: { x: 9999, y: 9999, z: 9999 } })
    await leavesNothing('sketch of a name that is neither entity nor type',
      'see.sketch', { subject: 'not-a-thing' })
    await leavesNothing('sketch of an empty studio',
      'see.sketch', { subject: 'you', alone: true, camera: { x: 9999, y: 9999, z: 9999 } })
    await leavesNothing('aiming the camera at nothing',
      'see.view', { aim: 'not-a-thing' })

    // A preview spawns a type that has no live instance, frames it and destroys
    // it. The world must not keep the body, and the id counter must not have
    // been spent — a look cannot rename what the run spawns next.
    const nextName = context.spawn('rat', { at: [40, 0, 40] }).id
    context.destroy(context.world.byId(nextName))
    const preview = await leavesNothing('previewing a type with no live instance',
      'see.sketch', { subject: 'boar', name: 'test-battery-preview' })
    test.ok(preview.preview?.spawnedAndRemoved || preview.why,
      'the preview reply says the type was spawned and removed')
    test.is(context.count('boar'), 0, 'the previewed body is gone')
    test.is(context.spawn('rat', { at: [40, 0, 40] }).id, nextName,
      'the preview left the id counter alone — the next spawn keeps its name')
    context.destroy(context.world.byId(nextName))

    // A held clock cannot be stepped, and a verb that steps must say so rather
    // than report a frozen world as a still one.
    context.loop.hold('see-battery')
    try {
      const held = await leavesNothing('diff against a held clock', 'see.diff', { steps: 30 })
      test.ok(/held by/.test(held.error || ''), `see.diff names the holder — "${held.error}"`)
      const sheet = await leavesNothing('a moment sheet against a held clock',
        'see.moment', { steps: [0, 6, 30] })
      test.ok(/held by/.test(sheet.error || '') || !!sheet.why,
        inBrowser ? 'see.moment names the holder' : 'see.moment refuses headless before stepping anything')
      const dossier = await test.run('see.isolate', { subject: 'you' })
      test.is(dossier.velocity, null, 'isolate reports no velocity rather than a false standstill')
      test.ok(/held by/.test(dossier.velocityWhy || ''), `isolate names the holder — "${dossier.velocityWhy}"`)
    } finally {
      context.loop.release('see-battery')
    }

    // The plain frame last: it must come back a picture or a named refusal,
    // never a blank labelled as a frame, and it borrows the camera to do it.
    const plain = await leavesNothing('a plain frame through the saved view',
      inBrowser ? 'see.capture' : 'see.sketch', { view: PLAY_VIEW, name: 'test-battery-plain' })
    test.ok(!!asFrame(plain) || typeof plain.hidden === 'boolean' || !!plain.why,
      'a frame comes back a picture, or a refusal that names why — never a blank')
  }
}
