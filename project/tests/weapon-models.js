/**
 * The weapon in everybody's hands, and the weapon in yours.
 *
 * WHAT CAN BE CHECKED HERE AND WHAT CANNOT. There is no renderer in a headless
 * run — no canvas, no GL context, no model loader — so nothing below asserts
 * that a rifle is visible, that it sits in the fist rather than through it, or
 * that the viewmodel does not clip a wall. Those are three pairs of eyes on a
 * screen and they are named at the bottom of this file so that whoever does look
 * knows what to look at.
 *
 * What IS checkable, and is the whole of what this lane decides, is: which model
 * goes in which hand, when it changes, when it goes away, whose hands get a
 * viewmodel, and where that viewmodel is offset to on a given step. Those are
 * plain numbers and plain strings, and they are the part that can quietly go
 * wrong for a whole session without anybody noticing.
 *
 * `physics-3d-test` is the level because it is the smallest world with a floor
 * to stand on. Every body here is spawned by the test, so the numbers are the
 * test's own and not a map's.
 */
import {
  runningWeaponModels, attachmentFor, placementFor, freshViewmodel, advanceViewmodel
} from '../plugins/weapon-models.js'
import { runningWeapons } from '../plugins/weapons.js'
import { runningCamera } from '../../plugins/builtin/camera.js'

const MODELS = 'counter-strike/models/'

/** Counter-Strike's run, the speed the bob is measured against. */
const RUN_SPEED = 6.35

/** A step of the fixed clock, which is what the motion is fed one of at a time. */
const STEP = 1 / 60

export default {
  name: 'an armed body visibly holds what it is carrying, and the local player gets a viewmodel that moves',
  level: 'physics-3d-test',

  run(test) {
    const live = runningWeaponModels()
    if (!live) return test.ok(false, 'the Weapon Models plugin is loaded')
    const armoury = runningWeapons()
    if (!armoury) return test.ok(false, 'the Weapons plugin is loaded')
    const camera = runningCamera()?.camera
    if (!camera) return test.ok(false, 'the Game Camera plugin is loaded')
    const { context, weapons } = armoury

    // ----------------------------------------- the decision, with no world at all
    // The mapping is the whole of what this lane decides about the world, so it
    // is worth checking on its own before any of it is arranged into bodies.
    test.is(attachmentFor('ak47')?.model, `${MODELS}ak47.glb`, 'an AK is drawn as the AK')
    test.is(attachmentFor('knife')?.model, `${MODELS}knife.glb`, 'a knife is drawn as the knife')
    test.is(attachmentFor('c4')?.model, `${MODELS}c4.glb`, 'the bomb is drawn as the C4')
    test.is(attachmentFor('galil')?.model, `${MODELS}ak47.glb`,
      'a Galil borrows the AK — a stand-in of the right length beats an empty hand')
    test.is(attachmentFor('hegrenade'), null,
      'a grenade has no model on disk yet, so it is deliberately drawn as nothing rather than as somebody else\'s rifle')
    test.is(attachmentFor(''), null, 'and an empty hand is an empty hand')

    // Every weapon the table upstairs holds must have an answer here, or a body
    // carrying one holds air with nothing on the console to say why.
    const unmapped = Object.keys(weapons.table).filter(id => attachmentFor(id) === null && id !== 'c4')
    test.is(unmapped.filter(id => !id.includes('grenade') && id !== 'flashbang').length, 0,
      `every weapon in the table has a model or is a named grenade — unmapped: ${unmapped.join(', ') || 'none'}`)

    // ------------------------------------------------ the weapon in a hand
    const body = { box: [0.81, 1.83, 0.81] }
    const you = test.spawn('ground', {
      id: 'you', at: [0, 1.415, 0], collider: body,
      properties: { body: 'dynamic', team: 'terrorist' }
    })
    const them = test.spawn('ground', {
      id: 'them', at: [0, 1.415, -10], collider: body,
      properties: { body: 'dynamic', team: 'counter-terrorist' }
    })
    test.attach('you', 'carries-weapons', { primary: 'ak47', secondary: 'usp' })
    test.attach('them', 'carries-weapons', { primary: 'awp' })

    // Long enough for the AK's 0.6 s deploy to finish and for one fixed step of
    // this lane to have run.
    test.simulate(1)
    test.is(you.carriesWeapons?.current, 'ak47', 'the rifle is the one deployed')
    test.is(you.attachments?.weaponMount?.model, `${MODELS}ak47.glb`,
      'and it is hung off the weaponMount node the character model carries at its right hand')
    test.is(them.attachments?.weaponMount?.model, `${MODELS}awp.glb`,
      'a second body across the map is holding its own weapon, not the first one\'s')

    // The same object every time, which is what makes "setting the same model
    // twice" a move rather than a rebuild sixty times a second.
    const wasHolding = you.attachments.weaponMount
    test.simulate(0.5)
    test.ok(you.attachments.weaponMount === wasHolding,
      'a body still holding the same rifle is handed the very same declaration, so the renderer has nothing to rebuild')

    weapons.select(you, 3)
    test.simulate(0.5)
    test.is(you.carriesWeapons.current, 'knife', 'slot three is the knife')
    test.is(you.attachments.weaponMount?.model, `${MODELS}knife.glb`,
      'and the hand changes with it')

    weapons.select(you, 2)
    test.simulate(0.6)
    test.is(you.attachments.weaponMount?.model, `${MODELS}usp.glb`, 'and again for the pistol')

    weapons.give(you, 'hegrenade')
    weapons.select(you, 4)
    test.simulate(0.6)
    test.is(you.carriesWeapons.current, 'hegrenade', 'a grenade can be taken out')
    test.is(you.attachments.weaponMount, undefined,
      'and the hand empties, because there is no grenade model — not silently keeps the pistol')

    // Disarming. This is what a corpse and a stripped-down body look like, and
    // the hand has to empty for both.
    you.carriesWeapons.current = ''
    test.simulate(STEP * 2)
    test.is(you.attachments.weaponMount, undefined, 'a body carrying nothing holds nothing')
    weapons.select(you, 1)
    test.simulate(0.7)
    test.is(you.attachments.weaponMount?.model, `${MODELS}ak47.glb`, 'and picking the rifle back up puts it back')

    // ------------------------------------------------------- whose hands
    // Nobody is being followed yet, so nobody is looking out of anybody: two
    // armed bodies and no viewmodel at all.
    test.is(live.shown, null,
      'with the camera following nothing, no viewmodel is drawn even though two bodies are armed')

    context.view.mode = 'first-person'
    camera.follow('you')
    test.simulate(0.2)
    test.ok(!!live.shown, 'the body the camera is looking out of gets a viewmodel')
    test.is(live.shown.model, `${MODELS}hands-terrorist.glb`, 'the hands are its own side\'s')
    test.is(live.shown.attachments?.hands?.model, `${MODELS}ak47.glb`,
      'with the weapon parented at the wrist, where a grip at the origin lands in the fist')
    test.is(live.shownWeapon, 'ak47', 'and the lane knows which weapon that is')

    // The placement is the low-right offset that makes it read as a game rather
    // than as a tech demo. Only its sense is worth asserting; the exact numbers
    // are meant to be nudged by somebody looking at the screen.
    test.ok(live.shown.position.x > 0, 'the viewmodel hangs to the RIGHT of the eye')
    test.ok(live.shown.position.y < 0, 'and below it')
    test.ok(live.shown.position.z < 0, 'and in front of it, down the -Z the view looks along')
    test.ok(placementFor('awp').position.z < placementFor('deagle').position.z,
      'a metre-sixteen AWP hangs further from the eye than a Desert Eagle does')

    camera.follow('them')
    test.simulate(0.2)
    test.is(live.shown.model, `${MODELS}hands-counter-terrorist.glb`,
      'looking out of the other side gets the other side\'s hands')
    test.is(live.shown.attachments.hands.model, `${MODELS}awp.glb`, 'holding what that body carries')

    camera.follow(null)
    test.simulate(0.2)
    test.is(live.shown, null, 'and a body nobody is looking out of has no viewmodel of its own')

    // Both bodies are still holding their world models throughout — the
    // viewmodel is an extra, not a replacement.
    test.is(you.attachments.weaponMount?.model, `${MODELS}ak47.glb`,
      'the world model stays in the hand the whole time the viewmodel comes and goes')

    // ------------------------------------------------------------ the motion
    // `advanceViewmodel` is a pure function of a bag and one plain input record:
    // no clock, no world, no random stream, because it is handed none of them.
    // So the same inputs really can be run twice and compared, which is the only
    // honest way to check "a replay bobs identically" without a replay.
    const walking = at => ({
      time: at, seconds: STEP, speed: RUN_SPEED, yaw: 0, pitch: 0,
      fired: false, selected: null, reloadFrom: 0, reloadUntil: 0, reloaded: false
    })

    const first = freshViewmodel()
    const second = freshViewmodel()
    for (let step = 1; step <= 120; step++) {
      advanceViewmodel(first, walking(step * STEP))
      advanceViewmodel(second, walking(step * STEP))
    }
    test.is(first.position.x, second.position.x, 'two runs fed the same steps bob to exactly the same place')
    test.is(first.position.y, second.position.y, 'in both axes')
    test.is(first.rotation.x, second.rotation.x, 'and hold the gun at exactly the same angle')

    // Amplitude from the speed, phase from the clock. Half the speed is half the
    // swing, once the ease has settled — and standing still is no swing at all.
    const half = freshViewmodel()
    for (let step = 1; step <= 120; step++) {
      advanceViewmodel(half, { ...walking(step * STEP), speed: RUN_SPEED / 2 })
    }
    test.near(first.position.x / (half.position.x || 1e-9), 2, 0.05,
      'the bob scales with ground speed: half as fast is half the swing')

    const still = freshViewmodel()
    for (let step = 1; step <= 120; step++) advanceViewmodel(still, { ...walking(step * STEP), speed: 0 })
    test.near(still.position.x, 0, 1e-6, 'a body standing still does not bob at all')
    test.near(still.position.y, 0, 1e-6, 'in either axis')

    // The same walk at a different moment of the clock is at a different point
    // of the figure of eight, which is what "a function of context.time" means.
    const later = freshViewmodel()
    for (let step = 1; step <= 120; step++) advanceViewmodel(later, walking(10 + step * STEP))
    test.ok(Math.abs(later.position.x - first.position.x) > 1e-6,
      'and the same walk ten seconds later is somewhere else in the cycle, because the phase is the clock')

    // ---- sway lags the turn and catches up
    const turning = freshViewmodel()
    advanceViewmodel(turning, walking(1))
    // A tenth of a radian to the LEFT, which is a positive yaw.
    advanceViewmodel(turning, { ...walking(1 + STEP), yaw: 0.1 })
    test.ok(turning.position.x > 0, 'turning left leaves the gun trailing to the right')
    test.ok(turning.rotation.y < 0, 'and pointing back the way you came')

    const lagged = Math.abs(turning.rotation.y)
    for (let step = 2; step <= 40; step++) advanceViewmodel(turning, { ...walking(1 + step * STEP), yaw: 0.1 })
    test.ok(Math.abs(turning.rotation.y) < lagged * 0.2,
      'and it catches up within about a third of a second of the turn stopping')

    const turnedUp = freshViewmodel()
    advanceViewmodel(turnedUp, walking(1))
    advanceViewmodel(turnedUp, { ...walking(1 + STEP), pitch: 0.1 })
    test.ok(turnedUp.position.y < 0, 'looking up leaves the gun trailing below the eye')

    // ---- the kick goes back and UP
    //
    // The 2D stand-in this lane replaces kicked the muzzle DOWN because of a
    // sign error. This assertion is the reason that cannot come back unnoticed.
    const shot = freshViewmodel()
    advanceViewmodel(shot, { ...walking(1), speed: 0 })
    advanceViewmodel(shot, { ...walking(1 + STEP), speed: 0, fired: true })
    test.ok(shot.position.z > 0, 'a shot pushes the gun back toward the eye')
    test.ok(shot.rotation.x > 0, 'and kicks the muzzle UP, which is the direction a gun actually recoils')
    const kicked = shot.rotation.x
    for (let step = 2; step <= 30; step++) advanceViewmodel(shot, { ...walking(1 + step * STEP), speed: 0 })
    test.ok(shot.rotation.x < kicked * 0.05, 'and it is off the shoulder within half a second')

    // ---- the switch is exactly as long as the weapon's own deploy
    const deploy = weapons.get('awp').deploySeconds
    const raising = freshViewmodel()
    advanceViewmodel(raising, { ...walking(5), speed: 0, selected: { at: 5, seconds: deploy } })
    test.ok(raising.position.y < -0.1, 'a weapon just selected starts well below where it ends up')
    test.ok(raising.rotation.x < -0.2, 'pointing at the floor')

    for (let step = 1; step <= Math.round(deploy / STEP); step++) {
      advanceViewmodel(raising, { ...walking(5 + step * STEP), speed: 0 })
    }
    test.near(raising.position.y, 0, 1e-6, `it is fully up after the AWP's own ${deploy} s deploy, not before or after`)

    // ---- the reload is exactly as long as the magazine takes
    //
    // Fed the carrying bag's own two stamps rather than a number copied into
    // this lane, so the motion and the ammunition counter cannot disagree.
    const reloadSeconds = weapons.get('ak47').reloadSeconds
    const reloading = freshViewmodel()
    const changing = (at, from) => ({
      ...walking(at), speed: 0, reloadFrom: from, reloadUntil: from + reloadSeconds
    })
    advanceViewmodel(reloading, changing(20 + STEP, 20))
    test.ok(reloading.position.y < 0, 'the gun drops as the magazine comes out')

    advanceViewmodel(reloading, changing(20 + reloadSeconds / 2, 20))
    const deepest = reloading.position.y
    advanceViewmodel(reloading, changing(20 + reloadSeconds * 0.95, 20))
    test.ok(reloading.position.y > deepest, 'is at its lowest halfway through and on its way back after')

    // The event fires when the magazine LANDS, so it ends the motion rather than
    // starting it — an animation started by it would play after the ammunition
    // had already gone up.
    advanceViewmodel(reloading, { ...changing(20 + reloadSeconds * 0.95, 20), reloaded: true })
    test.near(reloading.position.y, 0, 1e-6,
      'and "weapon:reloaded" puts the gun back up on exactly the step the rounds arrive')

    test.note('what is left needs a browser: that the rifle is visible in the fist rather than through it, that the viewmodel sits low-right without clipping a wall, and that the bob and sway read as a carried weapon rather than as a wobble')
  }
}
