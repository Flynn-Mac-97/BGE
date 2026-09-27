# Image commands

- `see.editor` captures the active desktop editor, including its panels.
  `{"scope":"window"}` also includes desktop tabs and the console; the OS
  title bar is excluded. `name` selects `agent-runs/see/<name>.png` and its
  JSON sidecar (default `editor`, replaces the same name). Names accept only
  letters, numbers, underscores and hyphens. Pixels use one pixel per DIP.
  The desktop must be restored and the targeted engine view active. Chrome
  and headless worlds return an explicit refusal. After host changes, rebuild
  and restart the desktop. `desktop capture` uses the same capture without
  needing an editor bridge connection. Captures do not change the game camera.

- `see.curve` — a chart of engine curves (`context.curve`), headless or not. No
  arguments lists every ease and preset. `{"curve":"pop"}` draws one, with
  `duration`, `from`, `to` and `loop` as `context.curve` takes them; keys work
  in place of a name. `{"curves":[...]}` overlays several to compare.
  `{"group":"motion"}` draws a named sheet: `ui`, `motion`, `object`,
  `effect`, `presets` or `eases`. A colour curve also paints its colours in a
  strip under the chart.
- `see.sketch '{...}'` — flat-colour frame from computed facts: marked
  entities fill their screen hull in their type's colour, the rest are
  rectangles. Headless it writes `agent-runs/see/<name>.png` + `.json`; in
  the browser it also answers a `dataUrl`. An `alone` sketch whose subject is
  outside the frame is refused, never answered with a blank. A sketch says
  where things are and how the frame is arranged; it cannot say whether a
  shape reads as a rat — that needs `capture` with `subject`.
- `see.capture '{...}'` — the rendered canvas, marks drawn on top, same
  files. Needs a browser. A tab that is not drawing is refused with an error
  and a `hidden` flag, never returned as a blank frame. `framing` appears in
  the reply and the sidecar when the frame holds under 5% of the level's
  entities: the camera is pointed where the game never looks, and brightness
  and coverage measured there say nothing about the art. The sidecar's
  `light` block holds mean and 4x4-cell brightness, 0–100, measured over the
  pixels the draw put down; `over` names which pixels answered and
  `measuredFraction` how many, and a cell with nothing drawn reads `null`.
  Never ask vision if a frame is too dark.
- `see.moment '{"steps":[0,6,30]}'` — one sheet: the real render and its
  flat type layer at the same instants, stepped forward, every cell
  labelled. In the pixels but not the scene is a rendering artifact; in the
  scene but not the pixels is an invisible entity. Needs a browser; advances
  the world; `stop` restores. A held clock is refused before any step.
  `camera`, `view` and `subject` aim the LIVE camera for the sheet and put it
  back, so both lenses show one moment. Use a sheet to decide which single
  moment to capture, then ask your question of that one capture — a model
  reading several pictures at once is markedly worse than one reading one.

Image options: `camera` (view field overrides; top-down map shot: high y,
pitch -1.57), `shot` (a named angle with `subject`: `three-quarter` default,
`front`, `back`, `side-left`, `side-right`, `top`, `low` — measured from the
subject's facing; a model whose face points +Z at yaw 0 declares `mesh.faces: '+Z'`
on its type, or front and back swap), `view` (a saved camera by name — `see.view '{"save":"arena-south"}'`
keeps the current camera, saved in `<project>/views.json`, committed;
`see.view` alone lists; `'{"go":"arena-south"}'` aims the LIVE camera,
so the queries answer from that view too; `'{"aim":"you","back":3}'` aims it
at an entity or type, framed the way subject shots frame, pulled `back` times
out), `rig: true` (draw the control rig over a scene frame: bones white, targets as rings in their kind's colour — reach green, lookAt blue, plant orange — joined to their bone, poles as diamonds joined to their joint, a path a control follows as a thin line; not drawn on a cropped `alone` frame), `subject` (frame one entity; add `"alone": true` to hide the
rest — the studio: neutral light, no post, cropped to the drawn pixels, TRANSPARENT
background by default, and UNMARKED, with `silhouette` giving the subject's
traced outline in the crop's own coordinates; pass `background` with a colour
when a test needs a known backdrop), `between` (two ids — distance, touching, relative screen position,
facing), `ui: false` (hide everything player-facing — the HUD, any game screen,
damage numbers, anything marked `userData.overlay` — when the question is the
world; leave it on to judge the interface, which is drawn over the frame and is
in it by default), `size` (`[width, height]` in pixels — override the shape for
one frame; the window's own size is put back after), `marks` (`"tags"` for the
old numbered stamps, `false` for none), `name`
(writes `agent-runs/see/<name>.png`), `file` (the whole path, which must end
`.png` and stay under `agent-runs/`; the sidecar takes the same path with a
`.json` ending).
