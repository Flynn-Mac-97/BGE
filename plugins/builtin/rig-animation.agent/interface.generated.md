<!--f08e5c01-->
parsed from source
  plugin Rig Animation
  category visuals
  commands rig.pose
  rig.faults
  rig.clips
  rig.load
  rig.sources (Stored motion, refuses without a host)
  rig.retarget (Retarget motion, refuses without a host)
  rig.skeleton (Write a model skeleton, refuses without a host)
  rig.check (Clips against capture, refuses without a host)
  rig.compare (Clip beside capture, refuses without a host)
  rig.play
  arguments rig.pose: options = {};rig.faults: options = {};rig.clips:;rig.load:;rig.sources:;rig.retarget: options = {};rig.skeleton: options = {};rig.check: options = {};rig.compare: options = {};rig.play: { entity, clip }
  input rig.pose: { type: 'object', properties: { type: { type: 'string', description: 'a rigged type in the level, such as player' }, clip: { type: 'string', description: 'the clip name the type declares' }, file: { type: 'string', description: 'or a clip file under assets/, such as a take' }, skeleton: { type: 'string', description: 'the skeleton file a clip file is for' }, at: { type: 'number', description: 'rig.pose only: seconds into the clip' } } };rig.faults: { type: 'object', properties: { type: { type: 'string', description: 'a rigged type in the level, such as player' }, clip: { type: 'string', description: 'the clip name the type declares' }, file: { type: 'string', description: 'or a clip file under assets/, such as a take' }, skeleton: { type: 'string', description: 'the skeleton file a clip file is for' }, at: { type: 'number', description: 'rig.pose only: seconds into the clip' } } }
  context rigAnimation
  systems fixed
  source 480 lines
