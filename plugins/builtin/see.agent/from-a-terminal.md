# From a terminal

- With the editor open, plain `node bin/engine.mjs run see.<verb> '{...}'`
  drives it over the bridge. `--project` is only for `--headless` runs, and it
  takes a path to the project directory — a bare name is one inside the
  checkout, `../x` or an absolute path is one anywhere. Never `.`.
- `script '[...]'` is headless-only. Over the bridge, run one verb per call —
  the browser world keeps its state between calls.
- Add `"brief": true` in a busy scene: only marked entities are listed, with
  every count kept. A full meadow lists 700 props without it. It works on
  `capture` and `sketch` too, and it is the difference between a 16KB sidecar
  and a 9KB one on the meadow at 0:30.
- `simulate` answers compactly, like `snapshot`. Ask for the entity list with
  `{"entities": true}` when the list is the point.
- Simulating does not move the camera. The view stays where the editor left
  it, which in a headless run is the editor's own camera looking at an empty
  field — so a moment simulated but not aimed shows scenery and no creatures.
  Aim first: `see.view '{"aim":"you","back":3}'` frames the followed entity
  and every later query answers from there. The meadow's play camera is saved
  as the view `meadow-play`.
