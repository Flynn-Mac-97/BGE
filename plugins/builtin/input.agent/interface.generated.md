<!--48c7d570-->
parsed from source
  plugin Keyboard Input
  category engine
  commands input.press
  input.release
  arguments input.press: options;input.release: options
  input input.press: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', description: 'an action name, as input.actions lists it' } } };input.release: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', description: 'an action name, as input.actions lists it' } } }
  context input
  systems frame
  listens shell:ready
  emits step:end
  source 178 lines
