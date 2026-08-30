/**
 * Rat — the floor of the whole game. Every other enemy is tuned against it, so
 * a change to these numbers is a change to what every other enemy means.
 *
 * It is drawn from `models/rat.glb`. The renderer swings a named node of a
 * model exactly as it swings a named part — `applyPose` in engine/render.js —
 * so the model keeps four legs named `legFrontLeft` through `legBackRight`,
 * each with its origin at the hip, and the scurry below drives them unchanged.
 */
const WIDTH = 0.42
const HEIGHT = 0.32
const LENGTH = 0.62

/**
 * The scurry: radians of leg swing per metre travelled, and how far.
 *
 * Tied to speed rather than to the clock, so a rat the schedule has sped up
 * takes quicker steps instead of skating.
 */
const STRIDE_PER_METRE = 11
const STRIDE_SWING = 0.42

export default {
  // What a rat IS, for anyone — person or agent — who has to recognise one.
  // `about` is repeated once per marked type in every See sidecar, which is why
  // it is held to 100 characters. None of these may restate a number from
  // `properties` below: the copy is the part that goes stale.
  about: 'the weakest and commonest enemy, and the one every other enemy is measured against',
  appearance: 'A stubby rosy-rust quadruped a third of the kitten tall, carrying two enormous pink ear discs and two white front teeth. The ears are wider than the body and are what names it at a glance.',
  looksWrongWhen: 'it is a plain tinted box — models/rat.glb has not loaded',

  // Feet-on-origin lowpoly model; the tinted box only stands in while it loads.
  mesh: { model: 'models/rat.glb', anchor: 'feet', box: [WIDTH, HEIGHT, LENGTH], tint: '#c2603f' },

  // A trigger, not a body: the horde moves itself, and the crowd it moves in
  // would cost more in Physics 3D than everything else in the game put
  // together. The collider is here so a weapon can raycast it and so touching
  // the kitten reports a contact.
  collider: { box: [WIDTH, HEIGHT, LENGTH] },

  properties: {
    body: 'trigger',
    family: 'rat',

    /** Metres a second. The kitten runs at 5, so a rat is outrun and never escaped. */
    speed: 1.95,

    health: 10,
    maxHealth: 10,

    /** How much ground it claims in the crowd. Roughly its own half-width. */
    radius: 0.32,

    /** Metres its centre floats above the ground. A rat walks on it. */
    hover: 0,

    /** Radians the heading wobbles by. Just enough that a hundred rats are not one line. */
    wander: 0.14,

    contactDamage: 6,
    bounty: 1
  },

  update(entity, seconds) {
    scurry(entity, seconds)
  }
}

/**
 * The trot: diagonal legs swing together, so one sine wave drives all four.
 *
 * The phase is kept on the entity and advanced by the step rather than read
 * off the clock, so a boar-style change of pace never snaps a leg, and it
 * starts from the id so sixty rats do not march in time.
 */
function scurry(entity, seconds) {
  if (!Number.isFinite(entity.gaitPhase)) entity.gaitPhase = phaseFromId(entity.id)
  entity.gaitPhase += seconds * STRIDE_PER_METRE * (entity.properties.speed || 0)

  const swing = Math.sin(entity.gaitPhase) * STRIDE_SWING
  entity.pose = {
    legFrontLeft: swing,
    legBackRight: swing,
    legFrontRight: -swing,
    legBackLeft: -swing
  }
}

/** A fixed angle from an id, so a replay steps the same rat the same way. */
function phaseFromId(id) {
  let total = 0
  for (let index = 0; index < id.length; index += 1) {
    total = (total * 31 + id.charCodeAt(index)) % 997
  }
  return (total / 997) * Math.PI * 2
}
