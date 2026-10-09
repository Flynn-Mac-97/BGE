<!--19ce34e6-->
parsed from source
  plugin See
  category agents
  commands see.editor
  see.gif
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
  arguments see.editor: options = {};see.gif: options = {};see.describe: options;see.view: options;see.occlusion: options;see.isolate: options;see.find: options;see.worn: options;see.diff: options;see.camera:;see.ray: options;see.identify: options;see.curve: options = {};see.sketch: options = {};see.moment: options = {};see.capture: options = {}
  input see.editor: { type: 'object', properties: { scope: { type: 'string', enum: ['editor', 'window'] }, name: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' } }, additionalProperties: false };see.gif: { type: 'object', properties: { lane: { type: 'string' }, panel: { type: 'string' }, selector: { type: 'string' }, seconds: { type: 'number', minimum: 0.5, maximum: 20 }, fps: { type: 'number', minimum: 1, maximum: 30 }, width: { type: 'number', minimum: 64, maximum: 1280 }, name: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' }, play: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'object' } }, required: ['command'], additionalProperties: false } }, additionalProperties: false }
  context see
  source 363 lines
