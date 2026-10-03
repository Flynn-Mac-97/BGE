/** The enemy of the current floor, side on and facing the hero. It comes in with the stair while the hero walks, and swings when it hits. */
const STAND_X = 1.3

export default {
  about: 'the enemy of a Descent floor: the Kimodo mannequin in dark grey, facing left',
  appearance: 'A dark grey mannequin facing left, on the right of the stage. Elites and bosses hold a greatsword. It arrives from the right while the hero walks.',
  looksWrongWhen: 'it faces right, overlaps the hero, or stays on stage after the run ends',

  mesh: { model: 'models/kimodo-mannequin.glb', anchor: 'feet', faces: '+Z', tint: '#7a7a7a' },
  rig: { skeleton: 'motion/kimodo-mannequin.skeleton.json', rootMotion: false },
  animationStates: 'animation/hero.states.json',

  start(entity) {
    entity.yaw = -Math.PI / 2
    entity.lastSerial = 0
  },

  update(entity, seconds, context) {
    const facts = context.blackBell?.scene() ?? { isShown: false }
    const scene = context.descentScene ?? { walkLeft: 0, speed: 0 }
    entity.hidden = !facts.isShown || facts.phase === 'chest' || facts.phase === 'levelUp'
    if (!facts.isShown) return
    entity.x = STAND_X + scene.walkLeft * scene.speed
    entity.heldItem = facts.foeKind === 'normal' ? null : 'greatsword'
    entity.animationInputs = { moving: false, gait: 'walk', crouched: false, sneaking: false, direction: 'forward', armed: facts.foeKind !== 'normal', turning: null }
    if (facts.attacker === 'enemy' && facts.serial !== entity.lastSerial) entity.animationAction = 'attack'
    entity.lastSerial = facts.serial
  }
}
