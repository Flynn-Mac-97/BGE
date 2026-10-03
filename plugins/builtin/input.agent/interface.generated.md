<!--e4bfc974-->
parsed from source
  plugin Keyboard Input
  category engine
  commands input.press
  input.release
  input.point
  arguments input.press: options;input.release: options;input.point: options
  input input.press: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', description: 'an action name, as input.actions lists it' } } };input.release: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', description: 'an action name, as input.actions lists it' } } };input.point: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number', description: 'viewport pixels from the left' }, y: { type: 'number', description: 'viewport pixels from the top' } } }
  context input
  systems frame
  listens shell:ready
  emits step:end
  source 217 lines
