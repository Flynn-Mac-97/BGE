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

    // The frames a human checks, shown in the Tests panel. A headless run
    // writes them to agent-runs/see/; a browser run answers a data URL and
    // the panel shows that directly.
    const sketch = await test.run('see.sketch', { camera: PLAY_CAMERA, name: 'test-battery-30s' })
    test.ok(sketch.files || sketch.dataUrl, 'the 0:30 sketch answered with a frame')
    test.frame(sketch.files || sketch.dataUrl, 'the field at 0:30, play camera')

    const portrait = await test.run('see.sketch', { subject: 'you', name: 'test-battery-kitten' })
    test.ok(portrait.marks?.['1'] === 'you', 'the subject is mark 1 in its own portrait')
    test.frame(portrait.files || portrait.dataUrl, 'the kitten, framed as the subject')
  }
}
