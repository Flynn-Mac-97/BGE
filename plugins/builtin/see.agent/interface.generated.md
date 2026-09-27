<!--4b955e99-->
parsed from source
  plugin See
  category agents
  commands see.editor
  see.describe
  see.view
  see.occlusion
  see.isolate
  see.find
  see.worn
  see.diff
  see.camera
  see.ray
  see.identify
  see.curve
  see.sketch
  see.moment
  see.capture
  arguments see.editor: options = {};see.describe: options;see.view: options;see.occlusion: options;see.isolate: options;see.find: options;see.worn: options;see.diff: options;see.camera:;see.ray: options;see.identify: options;see.curve: options = {};see.sketch: options = {};see.moment: options = {};see.capture: options = {}
  input see.editor: { type: 'object', properties: { scope: { type: 'string', enum: ['editor', 'window'] }, name: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' } }, additionalProperties: false }
  context see
  source 330 lines
