/**
 * The See battery: one played moment, proved by numbers and kept as frames.
 *
 * Two readers. The assertions are for the machine — the horde arrives, the
 * kitten stays on screen, spawns start off screen. The sketches written to
 * agent-runs/see/ are for a human, whose eyes catch what a number cannot;
 * the run is seeded, so the frames are the same every time and a change to
 * them means the game changed.
 */
const PLAY_CAMERA = { x: 0, y: 12.1, z: 13.4, pitch: -1.05, yaw: 0, fov: 50, mode: 'perspective' }

export default {
  name: 'the see battery — a played moment, in numbers and in frames',
  level: 'meadow',

  async run(test) {
    const before = test.context.see.describe({ camera: PLAY_CAMERA })
    test.ok(before.visible.some(entry => entry.id === 'you'), 'the kitten starts on screen')
    test.is(before.counts.offscreenByType.rat ?? 0, 0, 'no rats before the run starts')

    // Play to thirty seconds, taking the first card at each level-up screen —
    // a held world is a screen asking, and snapshot's `paused` names it.
    test.simulate(8)
    await test.run('choice.pick', 1)
    test.simulate(22)

    const during = test.context.see.describe({ camera: PLAY_CAMERA, between: ['you', 'floor'] })
    const rats = during.visible.filter(entry => entry.type === 'rat')
    test.ok(rats.length >= 8, `a crowd is on screen at 0:30 — ${rats.length} rats visible`)
    test.ok(during.visible.some(entry => entry.id === 'you'), 'the kitten is still on screen')
    test.ok(during.counts.offscreen > 0, 'more of the horde is arriving from off screen')
    test.ok(during.between.touching === false || during.between.distance < 1,
      'between answers for a named pair')

    // The frames a human checks, shown in the Tests panel. In the browser the
    // renderer is right there, so the frames are real renders; headless has no
    // renderer and sketches the same facts to agent-runs/see/ instead.
    const inBrowser = typeof document !== 'undefined'
    const look = (options, name) =>
      test.run(inBrowser ? 'see.capture' : 'see.sketch', { ...options, name })
    const asFrame = shot => shot.files || shot.dataUrl
      || (shot.__files && `data:image/png;base64,${shot.__files[0].base64}`)

    const field = await look({ camera: PLAY_CAMERA }, 'test-battery-30s')
    test.ok(!!asFrame(field), 'the 0:30 frame answered')
    test.frame(asFrame(field), `the field at 0:30, play camera${inBrowser ? '' : ' (sketch — run in the browser for the render)'}`)

    const portrait = await look({ subject: 'you' }, 'test-battery-kitten')
    test.ok(portrait.marks?.['1'] === 'you', 'the subject is mark 1 in its own portrait')
    test.frame(asFrame(portrait), 'the kitten, framed as the subject')
  }
}
