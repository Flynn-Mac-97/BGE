<!-- Generated from plugins/builtin/see.js; sha256 d21f6834016f7c1756632f61d396ac670cd25ff3dd6a803e86aa6bb9fcb28fbd. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/see.js). Where the prose below it disagrees, this is the code.

```
  plugin     See
  category   agents
  commands   see.describe (What is on screen, as computed facts — no pixels, no vision read)
             see.view (Save, list, drop, or aim the camera — a view worth returning to is a word)
             see.occlusion (How much of one entity the camera sees, and who blocks the rest)
             see.isolate (One entity in full — world box, screen box, cover, velocity, camera relation)
             see.find (Every entity matching the given predicates, on screen or off)
             see.diff (What appeared, moved, or left over exact fixed steps)
             see.camera (Why the frame looks wrong, asked of the camera itself)
             see.ray (What sits at a screen point, a grid of them, or in a direction from an entity)
             see.identify (What is drawn at this screen point, by the renderer that drew it)
             see.sketch (A flat-colour frame of screen hulls, drawn without a renderer)
             see.moment (One moment through several lenses, stepped forward, on one labelled sheet)
             see.capture (The real rendered frame, hulls outlined, with a JSON sidecar)
  arguments  see.describe: options
  arguments  see.view: options
  arguments  see.occlusion: options
  arguments  see.isolate: options
  arguments  see.find: options
  arguments  see.diff: options
  arguments  see.camera: none
  arguments  see.ray: options
  arguments  see.identify: options
  arguments  see.sketch: options = {}
  arguments  see.moment: options = {}
  arguments  see.capture: options = {}
  context    context.see
  source     309 lines
```
