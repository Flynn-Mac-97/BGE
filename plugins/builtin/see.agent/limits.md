# Limits

- `coverage` sums boxes before overlap — comparison, not screen share.
- `see.capture` answers from the tab the call names. With two pages attached,
  name one with `--client <id>`; an untargeted call is refused with the list.
- Queries compute from entity bounds — no lighting, material, animation or
  texture truth. Those need `capture`.
- HUD and screens are words already: `hud.read`, `screen.read`.
- Headless projection and the renderer derive the camera from the same view
  fields (engine/camera-project.js beside render.js `updateCamera` — change
  both together).

`see/describe.js` assembles the shared description. `describe-facts.js` measures
projection and world relations; `describe-marks.js` selects marks, colours and
hulls. Preserve their order: relations need world boxes before the reply removes
them, and brief output must not reduce the counts for the full frame.
