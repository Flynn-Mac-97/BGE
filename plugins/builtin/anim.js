/**
 * Sprite Animation — sprite sheet animation.
 *
 * Declared as data in the type file, next to everything else it belongs with:
 *
 *   sprite: { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },
 *   animation: {
 *     idle: 0,                                  // one frame
 *     walk: { frames: [1, 2], framesPerSecond: 8 },         // a cycle
 *     jump: { frames: [3], loop: false }
 *   }
 *
 * Game code chooses one by assignment:
 *
 *   e.animation = e.grounded ? (e.velocityX ? 'walk' : 'idle') : 'jump'
 *
 * Assignment rather than `play()` on purpose. Setting the same value every
 * frame does nothing, so an update hook can state what the entity *is* doing
 * without tracking what it *was* doing — which is the bug every hand-rolled
 * animation controller has.
 *
 * Runs on the fixed step, so a walk cycle advances the same number of frames in
 * a headless simulate() as it does on screen.
 */
export default {
  name: 'Sprite Animation',

  category: 'visuals',
  systems: [{
    phase: 'fixed',
    run(world, seconds) {
      for (const e of world.entities) {
        const clips = e._definition.animation
        if (!clips) continue

        const name = e.animation ?? e._definition.defaultAnim ?? Object.keys(clips)[0]
        const clip = normalise(clips[name])
        if (!clip) continue

        // Switching clip restarts it; staying on it continues.
        if (e._clip !== name) {
          e._clip = name
          e._clipTime = 0
          e._clipDone = false
        } else {
          e._clipTime = (e._clipTime ?? 0) + seconds
        }

        const i = Math.floor(e._clipTime * clip.framesPerSecond)
        if (clip.loop) {
          e.frame = clip.frames[i % clip.frames.length]
        } else {
          const last = clip.frames.length - 1
          e.frame = clip.frames[Math.min(i, last)]
          // Readable by game code: `if (e.animationDone) ...` for one-shots.
          e._clipDone = i >= last
        }
        e.animationDone = !!e._clipDone
      }
    }
  }],

  commands: [{
    id: 'animation.list',
    label: 'Animations by type',
    run: context => Object.fromEntries([...context.world.types]
      .filter(([, definition]) => definition.animation)
      .map(([name, definition]) => [name, Object.entries(definition.animation).map(([k, v]) => {
        const c = normalise(v)
        return `${k}: ${c.frames.join(',')}${c.loop ? '' : ' once'} @${c.framesPerSecond}framesPerSecond`
      })]))
  }]
}

/**
 * A clip is a number when it is one frame, a list when it is a cycle, and an
 * object when it needs a speed — the same widening the rest of the engine uses.
 */
function normalise(clip) {
  if (clip == null) return null
  if (typeof clip === 'number') return { frames: [clip], framesPerSecond: 1, loop: true }
  if (Array.isArray(clip)) return { frames: clip, framesPerSecond: 8, loop: true }
  return {
    frames: [].concat(clip.frames ?? 0),
    framesPerSecond: clip.framesPerSecond ?? 8,
    loop: clip.loop !== false
  }
}
