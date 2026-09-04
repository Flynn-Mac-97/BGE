---
name: glass-see-frames
description: Produce an actual image of the running game and read it — sketches, marked captures, saved moments, the size a frame comes out at, and how to prompt a vision model on one. Use only after the data verbs in See cannot answer, because a picture costs about fifty times a query and answers less. Also covers getting a frame from a terminal with no tab of your own.
---
<!-- generated from plugins/builtin/see-frames.agent.md at server start; edits are lost -->

# See Frames

Pixels, and only pixels. Every question that can be answered from engine data
is answered in the **See** guide, and should be asked there first: a frame
costs about fifty times a query, and a model reading one can be wrong about
what it sees in a way a query never is.

Reach for a frame when the question is genuinely about appearance — does this
read as a wall, is the silhouette right, does the lighting sell it — or when a
person asked to see something.

## Image commands

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
subject's facing), `view` (a saved camera by name — `see.view '{"save":"arena-south"}'`
keeps the current camera, saved in `<project>/views.json`, committed;
`see.view` alone lists; `'{"go":"arena-south"}'` aims the LIVE camera,
so the queries answer from that view too; `'{"aim":"you","back":3}'` aims it
at an entity or type, framed the way subject shots frame, pulled `back` times
out), `subject` (frame one entity; add `"alone": true` to hide the
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

## The shape a frame comes out at

A game declares the screen it is drawn for once, as `device` in `game.json`:
`{ "device": { "width": 540, "height": 960, "pixelRatio": 2, "orientation":
"portrait" } }`. `see.capture` draws at that shape with nothing asked for, so
every frame of one game is the same shape and a set can be compared. A game that
declares no device gets the window. `size` overrides both for one call.

Every capture reply and sidecar carries `profile`: `width`, `height`,
`orientation`, `from` (`game.json device` | `the size given` | `the window`),
`frame` — the PNG's own pixels — and the measured `pixelRatio`. Check a frame's
shape against `profile`, not against a reply nobody kept. A studio crop is
smaller than the screen it was drawn on, so it reports `cropped: true` instead
of a ratio.

The PNG is the profile multiplied by the page's device pixel ratio. A lane
browser is started at ratio 1, so a lane's frame is exactly the profile; a
HiDPI tab writes the same profile at twice the pixels. `profile.frame` and
`profile.pixelRatio` say which you have, so compare frames on `profile`, never
on file dimensions.

The HUD is laid out for the WINDOW. Whenever the frame shape differs from the
window's it is left out and the reply's `interface` field says so; `{"ui":true}`
puts it in, stretched. A declared portrait profile on a landscape editor window
therefore captures the world alone by default.

A generated frame name carries the page's client name — `meadow-alpha-1.png`,
`meadow-bravo-1.png` — so two lanes capturing at once never write one path, and
the counter steps past frames already on disk. A path given as `name` or `file`
is yours to reuse; the reply carries `replaced: <path>` when it overwrote one.

`see.capture` needs the dev server and a page on it — your own tab, or a lane
browser (see "A frame from a terminal"). Under `--headless` there is no renderer
and the refusal names `see.sketch`, which takes the same options.

The tab must be in front. A hidden tab runs no frames, so the HUD and screen
layers hold whatever was painted last while the world is drawn fresh — capture
refuses rather than hand back half a stale picture. `{"ui":false}` captures the
world alone and works in any tab.

Marks are HULLS: each marked entity is outlined in its TYPE's colour, drawn
on its own pixels — one colour per type, so a busy frame is a handful of
colours. The reply and sidecar both carry `palette` (type → hex), `marks`
(number → id) and each marked entry's `hull` (its screen outline as [x, y]
percent points). In a capture the hull traces the entity's drawn silhouette
from the ID buffer; in a sketch or bare describe it is the projected box.
The subject is white and wider — except in an `alone` studio frame, which is
unmarked on purpose. `palette` names OUTLINE colours and never a thing's own
material colour: a rat outlined in `#e06c72` is not a pink rat.

Which entities get marked: marks are dealt out by type, not by size. Every
type on screen takes its first mark before any type takes a second, rarest
first, so `palette` names every kind in frame. After that a type's turn comes
round in proportion to how much of it the camera holds — a sea of props is
sampled once or twice and the creatures take the rest. In a subject shot the
subject is always mark 1. Anything wider or taller than half the frame is a
backdrop and is never marked.

**Marks help you find a thing, and they make a frame score better than it
is.** An outline drawn on a picture measurably inflates a vision model's
judgement of it, and saying so in the prompt does not undo it. So a frame is
either for identification or for judgement, never both: keep the marks when
the question is which thing is which, and ask for a clean frame when the
question is whether the art is any good. An `alone` studio frame is already
unmarked and ships no `palette`, because judging the model is the only thing
it is for.

## A moment in time

Simulate to the moment, then look — one call, one world, deterministic:

```sh
node bin/engine.mjs --headless --project <p> script \
  '[["simulate",30],["run","see.diff",{"steps":60}],["run","see.sketch",{"name":"at-30s"}]]'
```

In the browser drive time with `simulate`, never by waiting. If time will
not advance, read `snapshot`; `paused` names who holds the clock.

## A frame from a terminal, with no tab of your own

`see.capture` and `see.moment` draw through a browser. `lanes.start` gives you
a headless one, so an agent that must not touch the person's tab still gets a
real rendered frame. Four commands, in this order:

```sh
ENGINE_PORT=5187 npx vite --port 5187 &          # 1. a dev server for THIS checkout
node bin/engine.mjs --port 5187 lanes.start sight # 2. a headless browser on it
node bin/engine.mjs --port 5187 run see.capture '{"ui":false}' --client sight
node bin/engine.mjs lanes.stop sight              # 4. always, before you finish
```

- **A worktree needs its own server and its own port.** The default port serves
  the main checkout; a lane started against it renders another workspace's code.
  `run` refuses that rather than answer from the wrong tree, and the refusal
  names the fix.
- **`--port` goes on every call after step 1**, including `lanes.start`. Without
  it the CLI reaches the default port.
- In the main workspace with a server already running, skip step 1 and the
  `--port` flag.
- A lane browser is started at device pixel ratio 1, so its PNG is exactly the
  declared profile.
- `lanes` lists every lane browser, each proved against its debugging port. One
  left running holds the work lock.

## A world with no GL at all

`startWorldInNode({ renderer: 'null' })` gives a headless world the renderer
SURFACE with nothing behind it. The drawing commands then run their whole
mutate-and-restore path — camera borrow, hidden entities, nulled background and
fog, dimmed lights, emptied post chain — instead of refusing on the first line.
Every frame comes back blank and every reply says so: `blank: true` and a `why`
naming the null renderer. This is for testing that path (`test/see-headless.test.mjs`),
not for looking at a game. To look at a game headless, use `see.sketch`.

## Reading a frame with a vision model

- Send the PNG and its `.json` sidecar together. The sidecar is ground truth
  for the fields it lists and silent on everything else. Where the sidecar
  and the picture disagree about something the sidecar measures, the sidecar
  wins; where they disagree about anything else, say so rather than resolving
  it. The sidecar carries measurements and never a verdict — a model will
  adopt a judgement it is handed instead of forming one.
- Refer to entities by hull colour and mark number together — `palette` maps
  colour to type, `marks` maps mark numbers to ids, and each marked entry's
  `at` names where it sits. This is a house convention that works, not a law
  of vision models: cross-check the colour against the number and the number
  against `at`. Never bind by floating text; the game draws its own numbers.
- One question per read, multiple-choice where possible. "Does the white
  outlined thing read as a rat or a box, A or B" beats "describe the scene".
  Ask for the choice and one short sentence of reason — and treat the reason
  as a hint, never a fact. A model's verdict is far better than its account
  of where the problem is, and any "where" claim has to be checked against
  `see.describe` before it is acted on.
- Comparing two frames is a forced choice, never a score out of ten. Ask
  which is better, then ask again with the two swapped; a flip means no
  difference. If a scale is needed at all, use words — excellent, good, fair,
  poor, bad.
- A subject under ~5% of the frame: capture it with `subject`. Below that
  size, answers fall away sharply, and cropping to the subject wins back most
  of what was lost.

### When a small or cheap model is doing the looking

It will not degrade gently. On this exact task — judging one rendered game
frame — the small tier of a model family scores near chance where the large
tier is reliable, and its failure is a stuck answer rather than a wrong one.
A question whose answer is stuck returns no information at all.

- Spend the image on ONE subject, framed alone. A crowded frame is where the
  cheap tier collapses.
- Give it a forced binary choice. Never open description, never "find
  anything wrong" — it will say everything is fine, every time.
- Do not rely on it reading marks. Put the identifying fact in the question
  and in the crop, not in the overlay.
- Ask twice with the options swapped, and treat disagreement as no answer.
- Never route counting, depth or distance to it. For a small model the query
  path is not the cheaper path, it is the only correct one.
