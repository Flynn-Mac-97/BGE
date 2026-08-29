/**
 * Drive the kitten headless: press play, hold a key, and report what the camera
 * and the body did. `simulate` never enters play mode, so the level's camera
 * rule is never applied by it — this is the only way to see the game camera
 * without a browser.
 *
 *   node agent-runs/kitten-camera-drive.mjs
 */
import { startWorldInNode } from '../engine/start-world-node.mjs'

const { engine, context, world, loop } = await startWorldInNode({ project: 'kitten-survivors' })

const round = n => Math.round(n * 1000) / 1000
const place = e => [round(e.x), round(e.y), round(e.z ?? 0)]
const eye = () => [round(context.view.x), round(context.view.y), round(context.view.z)]

// The level's camera block is read off disk, and pressing play inside that read
// starts a world whose camera has no rule yet.
await context.camera.ruleRead
engine.play()
const you = world.byId('you')

const report = label => {
  const focus = context.camera.focus
  console.log(JSON.stringify({
    label,
    mode: context.view.mode,
    kitten: place(you),
    yawDegrees: round((you.yaw ?? 0) * 180 / Math.PI),
    velocity: [round(you.velocityX ?? 0), round(you.velocityZ ?? 0)],
    speed: round(Math.hypot(you.velocityX ?? 0, you.velocityZ ?? 0)),
    eye: eye(),
    focus: focus ? [round(focus.x), round(focus.y), round(focus.z)] : null,
    aboveFocus: focus ? round(context.view.y - focus.y) : null,
    behindFocus: focus ? round(context.view.z - focus.z) : null,
    pitch: round(context.view.pitch),
    yaw: round(context.view.yaw)
  }))
}

const hold = (keys, seconds) => {
  for (const key of keys) context.input.press(key)
  loop.step(Math.round(seconds * 60))
  for (const key of keys) context.input.release(key)
}

report('standing still, one step in')
loop.step(30)
report('half a second, no keys')

hold(['KeyW'], 1)
report('after 1s of forward')

hold(['KeyD'], 1)
report('after 1s of right')

hold(['KeyW', 'KeyD'], 1)
report('after 1s of forward+right (diagonal)')

loop.step(30)
report('half a second after letting go')

console.log(JSON.stringify(await engine.run('camera.state'), null, 2))
process.exit(0)
