/**
 * Weapon Models — the gun in everybody's hands, and the gun in yours.
 *
 * Twelve GLBs were on disk and not one of them was being drawn: every body in
 * the map held air, and the weapon in first person was a silhouette painted onto
 * a 2D canvas by `counter-strike-hud.js`. That was the right answer when it was
 * written, before `engine/render.js` grew a viewmodel pass, and it is the wrong
 * answer now. This file is the whole lane, and it does two things.
 *
 * IN THE WORLD. Every character GLB carries an empty node called `weaponMount`
 * at the right hand. Whatever a body is carrying is declared against that node —
 *
 *   entity.attachments = { weaponMount: { model: 'ak47.glb', position, rotation } }
 *
 * — and the renderer loads it through the model cache it already keeps, clones
 * it per body and parents it to the node. Declaring rather than calling is what
 * makes this lane one line long: this file states what a body IS holding, every
 * step, without ever tracking what it WAS holding, exactly the way animation is
 * assignment rather than `play()`.
 *
 * IN YOUR HANDS. The local player is `context.camera.target`, and that body is
 * hidden from its own camera — so the viewmodel is the only thing the person at
 * the keyboard sees of themselves. It is a pair of hands with a weapon parented
 * at the wrist, through the same attachment mechanism, positioned low and to the
 * right the way 1.6 does. A centred viewmodel reads as a tech demo; the offset
 * to the right is most of what makes it read as a game.
 *
 * THE MOTION MATTERS MORE THAN THE MODEL, and it is the reason this file is
 * mostly arithmetic. `advanceViewmodel` is a pure function of a bag and one
 * plain input record — no clock, no world, no context — so the same inputs give
 * the same offsets on every replay, and a test can run it twice and compare
 * rather than needing a screen. Everything it reads is either `context.time` or
 * a field somebody else already publishes.
 *
 * What this file does NOT do: decide which weapon anybody is holding, or when.
 * That is the weapons lane, read through `entity.carriesWeapons` — a plain field
 * on the entity, which is the only way two lanes are allowed to agree here.
 */

/** A bare name resolves from project/assets/, so the folder is spelled out once. */
const MODELS = 'counter-strike/models/'

/** Counter-Strike's run, the speed the bob is measured against. */
const RUN_SPEED = 6.35

// ------------------------------------------------------------- the motion
/**
 * The bob: a lazy figure of eight, and deliberately small.
 *
 * The horizontal runs at BOB_RATE and the vertical at twice it, which is what a
 * figure of eight is — and the vertical therefore lands on exactly the rate the
 * camera bobs the eye at (`camera.js`, BOB_RATE 12). Two bobs at rates that do
 * not divide would beat against each other and read as a limp. Driven from
 * `context.time` rather than from a phase this file accumulates, so a replay
 * bobs identically and two bodies at the same speed bob together.
 */
const BOB_RATE = 6            // radians a second; the eye's own bob is twice this
const BOB_SWING = 0.014       // metres of sideways swing at a full run
const BOB_RISE = 0.008        // and of rise — half, because a figure of eight is wider than it is tall
const BOB_EASE = 0.07         // the swing fades in and out over about 0.2 s

/**
 * The sway: the gun trails your turn and catches up.
 *
 * This single detail does more for the feel than the geometry does. A viewmodel
 * bolted rigidly to the view reads as a photograph taped to the screen; one that
 * lags a tenth of a second reads as something being carried. The lag is fed by
 * how far the AIM turned between steps rather than by the mouse, because reading
 * the mouse here would drain the accumulator the camera consumes and steal the
 * player's turn — and because a bot aiming with its own fields then sways its
 * gun exactly like a human.
 */
const SWAY_GAIN = 0.9         // radians of turn become radians of lag
const SWAY_EASE = 0.10        // and the lag is gone in about a third of a second
const SWAY_LIMIT = 0.30       // radians, so a fast spin cannot throw the gun off screen
const SWAY_SHIFT = 0.10       // metres the gun slides per radian of lag
const SWAY_TURN = 0.35        // radians the gun turns per radian of lag
const SWAY_ROLL = 0.25        // and rolls, which is what makes a hard turn look heavy

/**
 * The kick: back toward the eye and UP, recovering fast.
 *
 * Up, not down. The 2D stand-in this replaces pushed the muzzle DOWN on a shot
 * because of a sign error, and a gun that dips when it fires reads as a gun that
 * is being pulled rather than fired. Deleting that drawing deleted the bug; this
 * comment exists so it does not come back.
 */
const KICK_PER_SHOT = 0.6
const KICK_EASE = 0.055       // back on the shoulder in about a fifth of a second
const KICK_BACK = 0.045       // metres straight back toward the eye
const KICK_RISE = 0.012
const KICK_PITCH = 0.07       // radians, muzzle up

/** The lower and raise on a switch. Its length is the weapon's own deploySeconds. */
const DEPLOY_DROP = 0.22      // metres the hands start below where they end up
const DEPLOY_PITCH = 0.55     // radians of muzzle-down while they are down there

/**
 * The reload. Its length is the weapon's own reloadSeconds, taken from the two
 * stamps the carrying bag keeps rather than from a number copied here, so the
 * motion and the ammunition counter cannot disagree about when the magazine is
 * back in.
 */
const RELOAD_DROP = 0.13
const RELOAD_PITCH = 0.45
const RELOAD_ROLL = 0.30      // the gun turns in the hand to take the magazine

// ----------------------------------------------------------- the placements
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 })
const vector = (x, y, z) => Object.freeze({ x, y, z })

/**
 * One weapon model, with the two placements that are facts about the MODEL
 * rather than about the weapon — which is why this table is keyed by file and
 * not by weapon id. Twenty-nine weapons, seven models, and a fit that belongs to
 * the mesh.
 *
 * `grip` is how the model sits in a fist, and it is used in both places a fist
 * appears: the character's `weaponMount` node and the first-person hands' wrist.
 * One number for one fact, so a knife that is canted right in your own hand is
 * canted right in everybody else's.
 *
 * `view` is where the whole hands-and-weapon assembly hangs in front of the eye,
 * in view space: -Z straight ahead, +X right, +Y up, origin at the eye.
 *
 * WHERE THESE NUMBERS CAME FROM. Not derived from anything — there is nothing to
 * derive them from. They were set from the models' own measured bounds against
 * the viewmodel camera's 54 degrees: a rifle is 0.88 m long with 0.32 m of
 * receiver, and half a metre from the eye that fills a bit over half the screen
 * height with the magazine running off the bottom edge, which is what 1.6 looks
 * like. They are a starting point and they are meant to be nudged by somebody
 * looking at the screen, which is the only way this kind of number is ever
 * finished. That is also why they are all in one table: nudging them should be
 * one file open, not seven.
 */
function heldModel(file, { grip, view }) {
  return Object.freeze({
    // Frozen and shared on purpose. Every body holding an AK is handed this
    // exact object, so "is it already holding this" is an identity test rather
    // than a comparison, and the renderer treats setting the same model as a
    // move rather than a rebuild.
    attachment: Object.freeze({
      model: MODELS + file,
      position: grip?.position || ZERO,
      rotation: grip?.rotation || ZERO
    }),
    view: Object.freeze({
      position: view.position,
      rotation: view.rotation
    })
  })
}

const RIFLE = heldModel('ak47.glb', {
  view: { position: vector(0.155, -0.145, -0.50), rotation: vector(0.02, 0.04, 0.05) }
})

const CARBINE = heldModel('m4a1.glb', {
  view: { position: vector(0.155, -0.145, -0.50), rotation: vector(0.02, 0.04, 0.05) }
})

const SNIPER = heldModel('awp.glb', {
  // A metre sixteen of rifle, so it hangs further from the eye than the others
  // or the scope alone would fill a third of the screen.
  view: { position: vector(0.165, -0.150, -0.55), rotation: vector(0.02, 0.045, 0.05) }
})

const HAND_CANNON = heldModel('deagle.glb', {
  view: { position: vector(0.130, -0.130, -0.40), rotation: vector(0.03, 0.05, 0.04) }
})

const PISTOL = heldModel('glock18.glb', {
  view: { position: vector(0.125, -0.125, -0.38), rotation: vector(0.03, 0.05, 0.04) }
})

const SIDEARM = heldModel('usp.glb', {
  view: { position: vector(0.125, -0.125, -0.38), rotation: vector(0.03, 0.05, 0.04) }
})

const KNIFE = heldModel('knife.glb', {
  // The one grip that is genuinely not the identity: a knife is held canted in
  // the fist rather than in line with the forearm, and at the origin the export
  // gave it, it would otherwise lie flat like a baton.
  grip: { position: vector(0, 0.01, 0.02), rotation: vector(0, 0, 0.25) },
  view: { position: vector(0.140, -0.140, -0.36), rotation: vector(0.06, 0.09, 0.10) }
})

const BOMB = heldModel('c4.glb', {
  // The C4 is a block whose origin is its base, not a grip, so it is laid flat
  // in the palm and tipped toward its carrier — which is also the only angle
  // from which the `led` child is visible, and somebody will want that.
  grip: { position: vector(0, -0.02, 0.02), rotation: vector(1.1, 0, 0) },
  view: { position: vector(0.090, -0.180, -0.42), rotation: vector(0.05, 0.02, 0) }
})

/** Where the hands hang when what is in them has no model of its own. */
const EMPTY_HANDED = Object.freeze({
  position: vector(0.130, -0.140, -0.40), rotation: vector(0.03, 0.05, 0.04)
})

/**
 * Which model each weapon is drawn with.
 *
 * Twenty-nine weapons and seven models, so most of this table is stand-ins, and
 * they are stand-ins on purpose: a Galil drawn as an AK is wrong in the details
 * and right in every dimension a player reads at a distance — length, silhouette,
 * which side of the map it is on. The alternative is an empty pair of hands,
 * which is wrong in all of them. `weapon-models.table` lists what is a stand-in
 * so nobody has to guess whether an asset is missing or merely shared.
 *
 * A null is a weapon that is deliberately not drawn. The three grenades have no
 * model on disk yet; until one exists the hands come up empty rather than
 * silently holding a rifle, and that is the honest picture.
 *
 * A weapon that is in the table upstairs and missing from here says so once, by
 * name, because the symptom is otherwise a body that quietly holds nothing.
 */
const MODEL_FOR = {
  knife: KNIFE,
  c4: BOMB,

  // The AK's own family, plus everything a terrorist carries that looks like it.
  ak47: RIFLE,
  galil: RIFLE,
  sg552: RIFLE,
  m249: RIFLE,

  // The M4 stands in for every other two-handed weapon: the carbines, the
  // submachine guns and both shotguns.
  m4a1: CARBINE,
  famas: CARBINE,
  aug: CARBINE,
  mp5navy: CARBINE,
  tmp: CARBINE,
  mac10: CARBINE,
  ump45: CARBINE,
  p90: CARBINE,
  m3: CARBINE,
  xm1014: CARBINE,

  // Everything with a scope on it.
  awp: SNIPER,
  scout: SNIPER,
  g3sg1: SNIPER,
  sg550: SNIPER,

  deagle: HAND_CANNON,
  glock18: PISTOL,
  elites: PISTOL,
  usp: SIDEARM,
  p228: SIDEARM,
  fiveseven: SIDEARM,

  // No grenade model exists yet. Named here rather than left out, so that a
  // missing mapping and a deliberate absence are two different things.
  hegrenade: null,
  flashbang: null,
  smokegrenade: null
}

/** The hands, by side. Both are authored with their origin at the right wrist. */
const HANDS = {
  terrorist: MODELS + 'hands-terrorist.glb',
  'counter-terrorist': MODELS + 'hands-counter-terrorist.glb'
}

// --------------------------------------------------------------- the plugin
/**
 * The running lane, for a test to read.
 *
 * A test file is handed `test` and nothing else, so it can reach neither the
 * context nor this plugin's state. A plugin module is a singleton in node and in
 * the browser alike, so importing this file from `project/tests` reaches the very
 * bag the live world is using — the same arrangement Game Camera and Weapons
 * both use, and for the same reason.
 */
let running = null
export const runningWeaponModels = () => running

const alreadySaid = new Set()
function report(key, message) {
  if (alreadySaid.has(key)) return
  alreadySaid.add(key)
  console.error(`[weapon-models] ${message}`)
}

export default {
  name: 'Weapon Models',
  // Ordering only. Both are still guarded at the point of use, because a plugin
  // switched off in the Plugin Browser must cost the game its guns rather than
  // take the world down.
  needs: ['Weapons', 'Game Camera'],

  onLoad(context) {
    const state = {
      context,
      viewmodel: freshViewmodel(),
      // What the frame system is to draw, rebuilt only when the hands or the
      // weapon change — the renderer is called with it sixty times a second.
      shown: null,
      shownWeapon: null,
      // Whether the fixed step has ever run. Everything here is decided there,
      // so "nothing to draw" and "nothing has happened yet" need telling apart.
      stepped: false,
      // What happened on the bus since the last fixed step. Drained every step,
      // so a shot fired between two steps lands on exactly one of them.
      pending: { firedBy: null, selected: null, reloadedBy: null }
    }
    running = state

    /**
     * Only what happened to the body the camera is looking out of.
     *
     * Filtered at the listener rather than at the step because there is one of
     * these records and nine other bodies on a real map: a bot selecting a rifle
     * after you did, in the same step, would otherwise overwrite your deploy and
     * your gun would simply fail to come up. The step checks the entity again,
     * because the camera can move to somebody else in between.
     */
    const isYou = entity => !!entity && entity === context.camera?.target

    context.bus.on('weapon:fired', event => {
      if (isYou(event?.entity)) state.pending.firedBy = event.entity
    })
    context.bus.on('weapon:selected', event => {
      if (isYou(event?.entity)) state.pending.selected = { entity: event.entity, weapon: event.weapon }
    })
    // Fired when the magazine is BACK IN, not when the reload starts — so it
    // ends the motion rather than starting it. Starting a reload animation from
    // this event would play the whole thing after the ammunition counter had
    // already gone up, which is the one thing a reload animation must not do.
    // Its length comes from the bag's own two stamps, which span reloadSeconds.
    context.bus.on('weapon:reloaded', event => {
      if (isYou(event?.entity)) state.pending.reloadedBy = event.entity
    })

    /**
     * Put the gun away and forget how it was moving.
     *
     * A level load throws away who was holding what and where the gun was in its
     * bob — keeping any of it would raise the new round's rifle out of the last
     * round's recoil. Stopping play has to say it out loud rather than leaving it
     * to the frame system, because in edit mode there IS no frame system: the
     * paint loop syncs and draws without running one. A project whose editor view
     * is a perspective camera would otherwise keep a rifle stuck in the corner of
     * the viewport with nothing left running to take it away.
     */
    const putAway = () => {
      state.viewmodel = freshViewmodel()
      state.shown = null
      state.shownWeapon = null
      state.pending = { firedBy: null, selected: null, reloadedBy: null }
      context.renderer?.viewmodel?.set(null)
    }
    context.bus.on('level:loaded', putAway)
    context.bus.on('play:stopped', putAway)
  },

  systems: [
    {
      /**
       * Everything that decides. On the fixed clock, so a replay decides the
       * same way, and so all of it is checkable in a headless run where there is
       * no renderer at all.
       */
      phase: 'fixed',
      run(world, seconds, context) {
        const state = running
        if (!state) return
        state.stepped = true
        for (const entity of world.entities) {
          const carried = weaponsCarriedBy(entity)
          if (carried) showInHand(entity, carried.current)
        }
        driveViewmodel(state, seconds, context)
        state.pending.firedBy = null
        state.pending.selected = null
        state.pending.reloadedBy = null
      }
    },
    {
      /**
       * Everything that draws, and it decides nothing. Guarded rather than
       * skipped: a headless world has no `context.renderer`, and this is the one
       * part of the lane that genuinely cannot run without a screen.
       */
      phase: 'frame',
      run(world, seconds, context) {
        const state = running
        const viewmodel = context.renderer?.viewmodel
        if (!state || !viewmodel) return
        if (!state.shown) { viewmodel.set(null); return }
        // Both every frame, and both deliberately. `set` treats the model it is
        // already holding as a move rather than a swap, so this is the cheap
        // call it looks like; `offset` is where all the motion actually lands.
        viewmodel.set(state.shown)
        viewmodel.offset(state.viewmodel.position, state.viewmodel.rotation)
      }
    }
  ],

  commands: [
    {
      id: 'weapon-models.held',
      label: 'What every armed body is visibly holding',
      run: context => context.world.entities
        .filter(entity => !!weaponsCarriedBy(entity))
        .map(entity => ({
          id: entity.id,
          weapon: weaponsCarriedBy(entity).current || '',
          model: entity.attachments?.weaponMount?.model || null
        }))
    },
    {
      id: 'weapon-models.viewmodel',
      label: 'The weapon in your own hands, and where it is',
      run: () => {
        const state = running
        if (!state) return { error: 'the Weapon Models plugin has not loaded' }
        if (!state.shown) {
          // Two different states with two different fixes, so they are two
          // different sentences. Everything here is produced on the fixed step,
          // and a world that has never been stepped genuinely has nothing to say.
          return {
            drawn: false,
            why: state.stepped
              ? 'the camera is not looking out of a living body that carries weapons'
              : 'the world has not been stepped yet — press play, or simulate at least one step'
          }
        }
        return {
          drawn: true,
          hands: state.shown.model,
          weapon: state.shownWeapon,
          model: state.shown.attachments?.hands?.model || null,
          base: state.shown.position,
          offsetPosition: rounded(state.viewmodel.position),
          offsetRotation: rounded(state.viewmodel.rotation)
        }
      }
    },
    {
      id: 'weapon-models.table',
      label: 'Which model each weapon is drawn with, and which of those are stand-ins',
      run: () => Object.keys(MODEL_FOR).map(id => {
        const entry = MODEL_FOR[id]
        const model = entry?.attachment.model || null
        return {
          weapon: id,
          model,
          // A weapon whose model is named after it is its own; anything else is
          // borrowing one, and an agent wondering why the Galil looks familiar
          // should be able to find that out without reading this file.
          standIn: !!model && !model.endsWith(`${id}.glb`)
        }
      })
    }
  ]
}

// ------------------------------------------------------ the weapon in a hand
/**
 * Which model a weapon is drawn with, as the attachment declaration itself.
 *
 * Exported because it is the whole decision this lane makes about the world, and
 * a test that can call it directly does not have to arrange a body, a camera and
 * a renderer to find out whether an AK draws as an AK.
 */
export function attachmentFor(weaponId) {
  if (!weaponId) return null
  const entry = MODEL_FOR[weaponId]
  if (entry === undefined) {
    report(`no-model-${weaponId}`,
      `nothing in this file says which model "${weaponId}" is drawn with, so anybody holding one holds air. Add it to MODEL_FOR — a stand-in from another weapon of the same size beats nothing.`)
    return null
  }
  return entry ? entry.attachment : null
}

/** Where the first-person assembly hangs for this weapon. */
export function placementFor(weaponId) {
  const entry = weaponId ? MODEL_FOR[weaponId] : null
  return entry ? entry.view : EMPTY_HANDED
}

/**
 * Put the right weapon in a body's hand, and take the old one out.
 *
 * Written every step and compared by identity, so the common case — a body
 * holding the same rifle it held last step — is one property read and a return.
 * The attachment object is mutated rather than replaced so that anything else
 * hanging off this body survives; this lane owns `weaponMount` and no other node.
 */
function showInHand(entity, weaponId) {
  const wanted = attachmentFor(weaponId)
  const held = entity.attachments?.weaponMount || null
  if (held === wanted) return
  if (!wanted && !entity.attachments) return
  const attachments = entity.attachments || (entity.attachments = {})
  if (wanted) attachments.weaponMount = wanted
  else delete attachments.weaponMount
}

// --------------------------------------------------------- the viewmodel
/**
 * Decide what is in your own hands, and advance how it is moving.
 *
 * The local player is whichever body the camera is looking out of, which is the
 * same answer the HUD uses and the only one that survives the map being redrawn.
 */
function driveViewmodel(state, seconds, context) {
  const you = context.camera?.target || null
  const carried = weaponsCarriedBy(you)
  const alive = !you?.damageable || you.damageable.alive !== false

  if (!you || !carried || !alive) {
    state.shown = null
    state.shownWeapon = null
    // Forget the motion with it. Coming back from a death has to raise the gun
    // from the bottom of the screen, not resume it mid-bob from wherever the
    // last living frame left it.
    state.viewmodel = freshViewmodel()
    return
  }

  const weapon = carried.current || ''
  const hands = HANDS[you.properties?.team] || HANDS.terrorist
  if (state.shownWeapon !== weapon || state.shown?.model !== hands) {
    const placement = placementFor(weapon)
    const attachment = attachmentFor(weapon)
    state.shown = {
      model: hands,
      position: placement.position,
      rotation: placement.rotation,
      // The export puts the hands' origin at the right wrist, so a weapon whose
      // origin is its grip lands in the fist with the left hand already forward
      // on the handguard. A weapon with no model — a grenade — leaves the hands
      // empty rather than borrowing somebody else's silhouette.
      attachments: attachment ? { hands: attachment } : {}
    }
    state.shownWeapon = weapon
  }

  advanceViewmodel(state.viewmodel, {
    time: context.time,
    seconds,
    speed: groundSpeed(you),
    // Recoil included, because the aim is what the gun is actually pointing
    // along — a kick that moved the crosshair and not the gun would look like
    // the two had come loose from each other.
    ...aimOf(you, context),
    fired: state.pending.firedBy === you,
    selected: state.pending.selected?.entity === you
      ? { at: context.time, seconds: deploySecondsOf(state.pending.selected.weapon, context) }
      : null,
    reloadFrom: number(carried.reloadStartedAt, 0),
    reloadUntil: number(carried.reloadingUntil, 0),
    reloaded: state.pending.reloadedBy === you
  })
}

/** Everything the motion knows, in one bag, so forgetting it is one assignment. */
export function freshViewmodel() {
  return {
    lastYaw: null,
    lastPitch: null,
    swayYaw: 0,
    swayPitch: 0,
    bobEffort: 0,
    kick: 0,
    deployAt: null,
    deploySeconds: 0.5,
    reloadFrom: null,
    reloadUntil: null,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }
  }
}

/**
 * One step of bob, sway, kick, deploy and reload — and nothing else.
 *
 * A pure function of the bag and one plain input record. It cannot reach the
 * clock, the world, the context or the random stream, because it is not given
 * any of them, so two runs fed the same inputs produce the same offsets by
 * construction rather than by inspection. That is also what lets the test for
 * this run it twice, side by side, in a world with no screen.
 *
 * The input:
 *   time, seconds      the engine clock and the length of this step
 *   speed              how fast the body is moving across the ground, m/s
 *   yaw, pitch         where it is aiming, radians, recoil included
 *   fired              did a shot leave the barrel since the last step
 *   selected           { at, seconds } when a weapon was just deployed
 *   reloadFrom, reloadUntil   the carrying bag's own two stamps
 *   reloaded           did the magazine land on this step
 */
export function advanceViewmodel(bag, input) {
  const seconds = Math.max(0, number(input.seconds, 0))
  const time = number(input.time, 0)

  // ---- sway: the gun trails the turn and catches up
  //
  // Read through `number` rather than trusted. One missing angle would make
  // every offset below NaN, and a viewmodel at NaN is not a wrong picture — it
  // is no picture at all, with nothing on the console to say why.
  const yaw = number(input.yaw, 0)
  const pitch = number(input.pitch, 0)
  if (bag.lastYaw === null) { bag.lastYaw = yaw; bag.lastPitch = pitch }
  const turnedYaw = wrap(yaw - bag.lastYaw)
  const turnedPitch = pitch - bag.lastPitch
  bag.lastYaw = yaw
  bag.lastPitch = pitch

  const settle = Math.exp(-seconds / SWAY_EASE)
  bag.swayYaw = clamp(bag.swayYaw + turnedYaw * SWAY_GAIN, -SWAY_LIMIT, SWAY_LIMIT) * settle
  bag.swayPitch = clamp(bag.swayPitch + turnedPitch * SWAY_GAIN, -SWAY_LIMIT, SWAY_LIMIT) * settle

  // ---- bob: amplitude from the speed, phase from the clock
  //
  // Eased in and out rather than switched. The sine is anywhere in its cycle
  // when a player stops, so cutting the amplitude in one step moves the gun by
  // up to a whole swing — a visible jolt at exactly the moment the picture is
  // supposed to settle.
  const wanted = clamp(number(input.speed, 0) / RUN_SPEED, 0, 1)
  bag.bobEffort += (wanted - bag.bobEffort) * (1 - Math.exp(-seconds / BOB_EASE))
  const phase = time * BOB_RATE
  const bobX = Math.sin(phase) * BOB_SWING * bag.bobEffort
  const bobY = Math.sin(phase * 2) * BOB_RISE * bag.bobEffort

  // ---- kick: one per shot, back and up, gone in a fifth of a second
  if (input.fired) bag.kick = Math.min(1, bag.kick + KICK_PER_SHOT)
  bag.kick *= Math.exp(-seconds / KICK_EASE)

  // ---- deploy: the old gun goes down, the new one comes up over deploySeconds
  if (input.selected) {
    bag.deployAt = number(input.selected.at, time)
    bag.deploySeconds = Math.max(0.001, number(input.selected.seconds, 0.5))
  }
  const raised = bag.deployAt === null ? 1 : clamp((time - bag.deployAt) / bag.deploySeconds, 0, 1)
  const lowered = 1 - easeOut(raised)

  // ---- reload: exactly as long as the magazine takes, because it is the same
  // two numbers the magazine is counted by.
  if (input.reloaded || !(number(input.reloadUntil, 0) > time)) {
    bag.reloadFrom = null
    bag.reloadUntil = null
  } else {
    bag.reloadFrom = number(input.reloadFrom, time)
    bag.reloadUntil = number(input.reloadUntil, 0)
  }
  const span = bag.reloadUntil === null ? 0 : bag.reloadUntil - bag.reloadFrom
  const reload = span > 0 ? Math.sin(clamp((time - bag.reloadFrom) / span, 0, 1) * Math.PI) : 0

  // Turning left is a positive yaw, so a gun that lags a left turn is left
  // pointing to the RIGHT of where the view now points — it slides to +X and
  // turns to -Y. Looking up is a positive pitch, so the same gun lags DOWN.
  bag.position = {
    x: bobX + bag.swayYaw * SWAY_SHIFT,
    y: bobY - bag.swayPitch * SWAY_SHIFT + bag.kick * KICK_RISE
      - lowered * DEPLOY_DROP - reload * RELOAD_DROP,
    z: bag.kick * KICK_BACK
  }
  bag.rotation = {
    x: bag.kick * KICK_PITCH - bag.swayPitch * SWAY_TURN
      - lowered * DEPLOY_PITCH - reload * RELOAD_PITCH,
    y: -bag.swayYaw * SWAY_TURN,
    z: bag.swayYaw * SWAY_ROLL + reload * RELOAD_ROLL
  }
  return bag
}

// ------------------------------------------------------------------ helpers
/**
 * Both spellings of the carrying bag.
 *
 * The engine files a behaviour's bag under its file name, so it is really at
 * `entity['carries-weapons']`, while every lane was handed `entity.carriesWeapons`.
 * The weapons plugin points both at one object once it has started, and reading
 * either means this lane is right before it has.
 */
const weaponsCarriedBy = entity => entity?.carriesWeapons || entity?.['carries-weapons'] || null

/**
 * Where a body is aiming.
 *
 * Off the camera when this is the body the camera is looking out of, and off the
 * two plain fields otherwise — the same order the weapons lane fires along, so
 * the gun sways toward where the bullet is going to go.
 */
function aimOf(entity, context) {
  const camera = context.camera
  if (camera && camera.target === entity && typeof camera.aim === 'function') {
    const aim = camera.aim()
    return { yaw: number(aim.yaw, 0), pitch: number(aim.pitch, 0) }
  }
  return { yaw: number(entity.aimYaw, 0), pitch: number(entity.aimPitch, 0) }
}

/** How long this weapon takes to come up. The weapons table knows; without it, half a second. */
function deploySecondsOf(weaponId, context) {
  const record = context.weapons?.get?.(weaponId)
  return number(record?.deploySeconds, 0.5)
}

/**
 * How fast this body is going across the ground.
 *
 * From the velocity physics actually integrates rather than from what the
 * movement lane asked for. Running into a wall makes those two disagree, and the
 * gun should stop bobbing, because you have stopped.
 */
const groundSpeed = entity => Math.hypot(number(entity?.velocityX, 0), number(entity?.velocityZ, 0))

const rounded = ({ x, y, z }) => ({ x: round(x), y: round(y), z: round(z) })

const number = (value, fallback) => (Number.isFinite(value) ? value : fallback)
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const round = value => Math.round(value * 10000) / 10000
const easeOut = through => 1 - (1 - through) * (1 - through)

/** Into plus or minus PI, so crossing behind you is a small turn and not a whole one. */
function wrap(angle) {
  let turned = angle
  while (turned > Math.PI) turned -= Math.PI * 2
  while (turned < -Math.PI) turned += Math.PI * 2
  return turned
}
