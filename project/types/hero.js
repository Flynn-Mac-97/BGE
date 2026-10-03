/**
 * The descending hero, seen side on behind the grid UI. It walks while a new floor begins,
 * stands ready while it fights, and swings when its gear deals damage. Gear it does not hold
 * hangs on its back. All of it is read from the Black Bell scene facts; it decides nothing.
 */
const WALK_SECONDS = 1.8
const isHeldAttachment = name => name === 'held' || name === 'heldOff'

export default {
  about: 'the hero of a Descent run: the Kimodo mannequin, side on, carrying its grid gear',
  appearance: 'A pale grey 1.8 m mannequin of flat boxes facing right on the left of the stage, one weapon in hand and other gear on its back; it walks while the stair scrolls past.',
  looksWrongWhen: 'it faces left, slides without walking, floats, or carries no gear while its grid has weapons',

  mesh: { model: 'models/kimodo-mannequin.glb', anchor: 'feet', faces: '+Z', tint: '#e6e6e6' },
  rig: { skeleton: 'motion/kimodo-mannequin.skeleton.json', rootMotion: false },
  animationStates: 'animation/hero.states.json',

  start(entity) {
    entity.yaw = Math.PI / 2
    entity.walkLeft = 0
    entity.lastFloor = 0
    entity.lastSerial = 0
  },

  update(entity, seconds, context) {
    const facts = context.blackBell?.scene() ?? { isShown: false }
    entity.hidden = !facts.isShown
    if (!facts.isShown) { context.descentScene = { walkLeft: 0, speed: 0 }; return }
    // The first floor of a run starts in place; every later floor starts with a short walk.
    if (facts.floor !== entity.lastFloor) { entity.walkLeft = facts.floor > 1 ? WALK_SECONDS : 0; entity.lastFloor = facts.floor }
    entity.walkLeft = Math.max(0, entity.walkLeft - seconds)
    const isWalking = entity.walkLeft > 0
    entity.heldItem = facts.held
    entity.offHandItem = facts.offHand
    const held = Object.fromEntries(Object.entries(entity.attachments ?? {}).filter(([name]) => isHeldAttachment(name)))
    entity.attachments = { ...held, ...Object.fromEntries(facts.back.map((gear, index) => [`back${index}`, { model: gear.model, node: 'Spine2', position: gear.position, rotation: gear.rotation, scale: gear.scale }])) }
    entity.animationInputs = { moving: isWalking, gait: 'walk', crouched: facts.phase === 'dead', sneaking: false, direction: 'forward', armed: Boolean(facts.held), turning: null }
    if (facts.attacker === 'recruit' && facts.serial !== entity.lastSerial) entity.animationAction = 'attack'
    entity.lastSerial = facts.serial
    // The stair scrolls at the walk clip's own speed, so the feet do not slide.
    context.descentScene = { walkLeft: entity.walkLeft, speed: isWalking ? context.animationStates?.travelOf(entity) || 1.2 : 0 }
  }
}
