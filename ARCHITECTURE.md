# How this engine works

Written for someone opening the project cold — a person or an agent. `README.md`
is how to *use* it; this is how it *works* and why it is shaped this way.

## The one idea

**Files on disk are the truth.** The editor, the CLI and `window.engine` are
three windows onto the same state, and all three write back to the same files.
There is no in-memory document that has to be saved, no project database, no
scene format that only the editor understands.

Two consequences that everything else follows from:

- Any change an agent can make with a text editor, the running engine will pick
  up. There is no engine-specific write API to learn.
- If it is not in a file, it is not happening. A behaviour you cannot find by
  reading `project/` does not exist.

## Shape

About 5,200 lines. Roughly half kernel, half plugins — and the plugins have no
privileges the kernel does not give everyone.

```
engine/     world.js 414   start-world.js 323  render.js 291  ui.js 244
            project-index.mjs 236   loop.js 229   inspect.js 216
            shell.js 183   start-world-node.mjs 117   index.js 95
            loader.js 82   files.js 58    bus.js 22

plugins/builtin/
            tool-transform 370   tests 269    panel-inspector 238
            new-file 195         hud 191      panel-plugins 174
            audio 149            camera 144   panel-project 144
            place 116            hot 107      panel-code 105
            physics-2d 103       bridge 98    behaviours 87
            anim 87              panel-scene 57  input 54
```

Physics is a plugin. The inspector is a plugin. Delete both and the engine still
boots — you get a static scene and no detail pane, and nothing else notices.

Every name in this codebase is spelled out. `properties` not props, `context`
not ctx, `entity` not e, `seconds` not dt, `velocityX` not vx. Plugins are named
the way you would say them out loud — `Inspector Panel`, `Terminal Bridge`.
Nobody reading this code for the first time should have to decode it first, and
that includes a model reading it cold.

## The kernel modules

| Module | Owns | Does not know about |
|---|---|---|
| `bus.js` | an event channel | anything |
| `world.js` | entities, types, behaviours, the shared vocabulary | rendering, physics, files |
| `loop.js` | the clock, the schedule, the random stream | what it is stepping |
| `files.js` | the only writer to disk | what a level is, or how disk is reached |
| `loader.js` | plugin order, contribution points, failure containment | any specific plugin |
| `render.js` | one GL context, one draw order | game rules, or where the camera is |
| `ui.js` | the vocabulary panels compose from | any specific panel |
| `shell.js` | four docks, a toolbar, a status line | what goes in them |
| `inspect.js` | the read-and-drive surface | whether anything is drawing |
| `start-world.js` | boot, and the `context` everything receives | screens |
| `index.js` | the browser: shell, renderer, the paint loop | game rules |
| `start-world-node.mjs` | the same world in node: disk, readdir, paths | game rules |
| `project-index.mjs` | what is in a project, and the determinism lint | the browser — node only |

The last three are the split. Everything above `start-world.js` runs identically
either side of it.

Two things moved out of `render.js` to make that work. `view` — where the camera
is looking — and `viewport` — how big the picture is — are session state now,
because they are game values that a camera plugin reads and writes. They existed
only inside the renderer before, so a world with nothing drawing it had no
camera at all. It also made camera bounds reproducible: they were clamped
against the real browser window, so the same level framed differently in a small
window than a large one.

`loader.js` is the reason the plugin claim is real. Every contribution point —
`panels` `tools` `commands` `fields` `importers` `systems` `menus` — is a list
it collects and hands to whoever consumes it. The shell asks for `panels` and
`menus`. The loop asks for `systems`. Neither knows who supplied them.

Turning a plugin off withdraws its contributions immediately; the next reload
skips it entirely. A plugin cannot be un-loaded mid-session — its `onLoad` has
already run and may hold DOM or listeners — so anything it added to `context`
stays until then. The Plugin Browser browser is the visible proof of the
whole arrangement: switch off the inspector and watch it go.

## Boot

`start-world.js` is the whole engine minus anything that needs a document.
`index.js` is the browser wrapper around it; `start-world-node.mjs` is its twin
in node. Steps 5 and 6 are the only ones a headless world skips.

```
1. make bus, world, loader, files
2. make the loop, with the fixed and frame callbacks
3. load every plugin       plugins/builtin/*.js + project/plugins/*.js
                           sorted by `needs`, cycles reported not thrown
4. build context               the one object plugins AND game code receive
5. shell builds the DOM    four docks + a canvas          browser only
6. renderer attaches to the canvas                        browser only
7. read the index          the generated map of the project
8. import each type        from the index — not import.meta.glob
9. read the level JSON     one entity per placement
10. expose the engine surface     window.engine in a page
11. emit shell:ready       for plugins that need the DOM
```

Three things differ between the two, and nothing else does: files come off disk
instead of over HTTP, plugins are found by reading a directory instead of by a
Vite glob, and project files are imported by path instead of by URL. Each is
handed to `startWorld` as an argument, so there is one runtime rather than two
that can disagree. A test asserts that a headless snapshot and an attached
editor's snapshot are identical, entity for entity.

Step 7 matters more than it looks. The dev server builds `.engine/index.json` by
*importing* each type file and reading its actual `properties`, hooks and asset
references — not by parsing text. So the index is exact, and it is the one file
both the editor's search and an agent read to know what exists.

Step 8 is why writing a new type file works without a reload: a glob is fixed
when the page loads, a fetched list is not.

## An entity

Flat. No nesting, no `GetComponent`, nothing to walk.

```js
{
  id: 'coin-2', type: 'coin',
  x: 9.5, y: 4, z: 0, rotation: 0, scale: 1,
  properties: { value: 50, spin: 120 },
  overrides: ['value'],              // what THIS placement changed
  sprite: { image: 'coin.png', width: 0.5, height: 0.5 },
  collider: { circle: 0.22 },

  float: { speed: 2, amplitude: 0.3, base: 4 },   // one attached behaviour's bag
  behaviours: [ { name: 'float', definition, bag, own, overrides } ],

  _definition: <the module exported by types/coin.js>,
  _setByPlacement: { sprite: false, collider: false },   // did the placement set these?
  _detached: Set { },                             // type behaviours this one refuses
  _extraKeys: { }                                 // placement keys we do not model
}
```

`_definition` is a live pointer to the type file's export. That is why editing
`coin.js` changes every coin at once — and why hot reload has to re-point it, or
your edit silently does nothing.

`_extraKeys` exists so a save never narrows a file. Anything the placement carried
that the entity does not model is written straight back out.

## Types and placements

A type says what a thing *is*. A level says where things *are*. Overrides stay
plain JSON in the level, so a diff is readable:

```json
{ "type": "coin", "at": [9.5, 4, 0], "properties": { "value": 50 } }
```

`properties` doubles as the inspector schema. Declared once, in code, with no
separate serialisation annotation and no editor metadata.

## Behaviours

The one form of composition, and the only concept added to the entity model
since the engine started. A behaviour is a file shaped exactly like a type,
minus the art:

```js
// project/behaviours/float.js
export default {
  about: 'bob up and down around where it started',
  properties: { speed: 2, amplitude: 0.3 },
  start(entity, context, self)           { self.base = entity.y },
  update(entity, seconds, context, self) {
    entity.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
  }
}
```

Composition was avoided for a long time on the grounds that it costs tokens.
Duplication costs more, and it costs them in the worse place: copying `float`
into five type files means five reads, five edits, and one of the five silently
diverging when somebody updates four. A shared file is read once and edited
once.

Four rules keep this from becoming a component system:

1. **A behaviour is a type without art.** Same four hooks, same `properties`.
   There is nothing new to learn, and no second lifecycle.
2. **Each one gets its own bag**, `entity.float`, handed to its hooks as
   `self`. Declared properties start in it and running state stays in it, so
   two behaviours can never collide over a name and neither can collide with
   the type's properties. `float` and `spin` both have a `speed`; neither can
   see the other's.
3. **Attaching is plain JSON in a file.** `behaviours: ['float']` in the type,
   or `"behaviours": { "float": { "amplitude": 1.5 } }` on one placement.
   Nothing is wired in an editor and stored somewhere you cannot read.
4. **A behaviour cannot look up another behaviour.** There is no
   `getBehaviour`. Two that must agree do it by reading and writing plain
   fields on the entity. This is the rule that does the real work — it is what
   stops an execution-order settings screen from ever being needed.

Order is the order they are written, and the type's own hooks run **last**, so
a type always gets the final word on what it composed.

A level records only what the *placement* decided — what it added, what it
changed, what it took off with `"float": false` — never the list inherited from
the type. So a diff shows a decision instead of a copy. An attachment naming a
file that is not there is kept, reported, and healed the moment the file
appears; dropping it would delete the author's work over a typo.

## One frame

```
fixed step (exactly 1/60, never wall time)
  ├─ timers due now
  ├─ systems with phase:'fixed'     physics, animation, camera
  └─ every entity's update(e, seconds, context)

frame
  ├─ systems with phase:'frame'     input bookkeeping, hud
  ├─ renderer.sync(world)           copy x/y/rotation into Three.js meshes
  └─ renderer.draw()
```

In edit mode the fixed step never runs — just sync and draw. That is the entire
difference between editing and playing.

**Physics never touches the renderer.** It reads and writes `e.x` / `e.y`; the
renderer reads the same numbers. Swapping the renderer would not affect physics
at all, and swapping physics would not affect rendering.

The two-clock reality is hidden on purpose. Game code gets `update` and a `seconds`,
and never has to learn what a fixed step is — which is why there are four hooks
and no `FixedUpdate`.

## Determinism

`simulate()` is only useful if it repeats. The engine owns every source of
nondeterminism so game code has nowhere else to get one:

| Not available to game code | Use |
|---|---|
| `performance.now()` `Date.now()` `new Date()` | `context.time` |
| `Math.random()` | `context.random()` |
| `setTimeout` `setInterval` | `context.after(s, fn)` `context.every(s, fn)` |
| `requestAnimationFrame` | the `update` hook |

`node bin/engine.mjs check` fails on any of the left column, with file and line.

Engine time is derived from an integer step count, not accumulated — adding
`1/60` fifteen times does not land on `0.25`, and a timer set for exactly `0.25`
would fire a step late. Loading a level resets clock, schedule and random stream
together; resetting only some of them is the subtle version of the same bug.

## `context` — the one object

Every plugin and every hook receives the same thing:

```
world  loop  bus  files  editor  loader  view  viewport
renderer  shell                          absent when nothing is drawing
spawn  destroy  select  open  run  save  redraw  importProjectFile
assets  types  levels  level  selection
time  random  after  every  cancel          the deterministic runtime
input  camera  play  audio  hud             contributed by plugins
```

That last line is the proof the design works. `input`, `camera`, `play` and
`hud` are not kernel. Plugins added them to `context`, and `player.js` uses
`context.input.axis('x')` and `context.camera.shake()` as though they always existed.
A plugin you write can do the same.

## The runtime vocabulary

Four features, four declarations, all following the same rule: **data in the
type file, one flat key, a string when simple and an object when detailed.**

```js
// types/player.js
sprite: { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },
animation:   { idle: 0, walk: { frames: [1, 2], framesPerSecond: 8 }, jump: { frames: [3], loop: false } },
sounds: { jump: 'jump.wav', hurt: 'hurt.wav' },
```

```js
// and in update():
e.animation = !e.grounded ? 'jump' : move ? 'walk' : 'idle'
e.flip = move < 0
e.play('jump')
context.camera.shake(0.35)
```

Animation is **assignment, not `play()`**. Setting the same value every frame
does nothing, so an update hook can say what the entity *is* doing without
tracking what it *was* doing — the bug every hand-rolled animation controller
has.

Camera and HUD are declared in the **level**, because following the player and
showing a score are properties of the level, not of the player:

```json
"camera": { "follow": "player", "lerp": 0.12, "lookAhead": 0.3, "bounds": [0,0,30,12] },
"hud": [
  { "text": "SCORE {score}", "at": [14, 12] },
  { "text": "{coins} COINS LEFT", "at": [-14, 12], "anchor": "top-right" }
]
```

`{name}` reads `world.state.name` — the same shared state game code already
writes to — so a HUD needs no wiring.

Two rules the HUD follows that are easy to get wrong:

- It is drawn into a canvas, not CSS. A DOM overlay would be a second renderer
  with its own coordinates, invisible to `snapshot()`, absent from a screenshot,
  and different again inside a sandboxed iframe.
- The game camera and the editor viewport are different things. The editor's
  view is saved on play and restored on stop, so pressing play never loses your
  place in the level.

Audio records every play whether or not it is audible, so a headless
`simulate()` still answers "did the coin make a noise" — `engine.run('audio.recent')`.

## The ways in

```
   drag in the viewport        ─┐
   type in the inspector       ─┤
   drop a type on the scene    ─┤
   drop a behaviour on a thing ─┼──▶  world  ──▶  writes to project/*.json
   create from + New           ─┤
   edit the file               ─┤
   CLI / window.engine         ─┘
```

Where you let go of a drag is the whole gesture. A type dropped on empty space
places one; a behaviour dropped on an entity attaches to it. Nothing to arm,
no mode to leave.

No save button anywhere. Every edit lands on disk immediately, which is what
lets the status bar say "saved" unconditionally.

One guard: **a simulated world refuses to save.** A level records where things
*start*; once the simulation has run the world holds where things *ended*, so
writing it back would replace the level with a freeze-frame of a playthrough.

## Driving it from outside

```
your terminal ──▶ bin/engine.mjs ──▶ POST /api/engine ──▶ ws ──▶ Terminal Bridge ──▶ window.engine
                              └────▶ --headless ──▶ startWorldInNode() ──▶ the same surface
```

Every CLI op is a method name on the engine surface, so the CLI cannot fall
behind it. Any command id also works as a verb, so a plugin that adds
`tests.run` has added a terminal command with it.

The bridge's transport is the dev server's existing websocket. No extra port, no
extra dependency, and it dies with the dev server.

`--headless` skips all of that and starts a world in the CLI process. It exists
so several agents can work at once: one dev server has one world, and ten agents
stepping it trample each other, while ten headless worlds never meet. Memory is
private — world, clock, random stream, selection. `project/` is not, because it
is on disk, so anything that *writes* still needs its own worktree or its own
lane. Headless cannot draw; when you need a frame, use a browser.

The engine hosts no AI. It opens a door; whichever CLI you run walks through it.

## Writing files while it runs

The dev server watches `project/` and pushes what changed; `Live File Updates`
applies it. Editing a type moves live entities onto the new definition and keeps
per-placement overrides. A file with a syntax error is reported in `errors`
while entities keep running the last version that parsed.

Two things still reload the page: editing a **plugin** (it owns DOM and
listeners), and **deleting** any project file (Vite does not consult plugins on
unlink).

## Design rules the code follows

- **One accent colour means one thing.** In the editor it means "changed" — an
  override, a problem. Nothing else may spend it.
- **Two trees need two verbs.** The Scene panel *selects*; the Project panel
  *opens*. Ambiguity between them was a real bug, fixed by naming the verb in
  the panel title.
- **Plugins never write markup.** They compose from `ui.*`. A plugin therefore
  cannot pick a colour and cannot drift from the design system. When a built-in
  panel needed dim metadata text twice, the fix was to add `ui.meta`, not to
  reach for raw DOM.
- **Failure is contained by name.** A plugin that throws is disabled with its
  name and reason reported; it cannot take the editor down.
- **Silence is the enemy.** A missing texture falls back to a flat colour *and*
  reports itself. A blank viewport with an empty error log is the worst thing
  the engine can hand an agent.

## What is deliberately not here

- No component system, no `GetComponent`, no archetypes, no execution order to
  configure. Behaviours compose, but they cannot query each other, and an
  entity stays flat.
- No scene format beyond JSON placements.
- No editor state that is not either in a file or trivially recomputed.
- No CSS in game code. The editor is styled by `engine/style.css`; a game draws
  into the canvas.

## Known gaps

The runtime is much thinner than the tooling. Missing: tilemaps and bulk
placement, scene flow between levels, saving game state, parenting, raycasts,
triggers separate from solids, particles, gamepad and touch input, pause and
time scale, 3D model loading, and any way to export a playable build.

The game also runs in the editor's own page, so an infinite loop in game code
freezes the editor — though `--headless` now gives you somewhere else to run it.

Two editor tabs on one dev server both answer the bridge and the first reply
wins, so a state-dependent CLI call can read the other tab's world. Keep one tab
open, and use `--headless` when you want more than one world.
