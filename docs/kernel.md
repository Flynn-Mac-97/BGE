# The kernel and boot

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

## Shape

The kernel's boot closure is 82 modules, 13,386 lines. The top-level
`plugins/builtin/*.js` are 22,681 more. The plugins have no privileges the
kernel does not give everyone.

```
engine/     world.js 609   start-world.js 263   render.js 375
            ui.js 315   project-index.mjs 612   loop.js 571
            inspect.js 263   shell.js 290   start-world-node.mjs 137
            index.js 214   loader.js 221   files.js 221   bus.js 25
            render/     29 files  4427

plugins/builtin/
            tool-transform 386   tests 348    panel-inspector 323
            new-file 207         hud 169      panel-plugins 227
            audio 166            camera 676   panel-project 145
            place 117            hot 123      panel-code 112
            physics-2d 226       bridge 98    behaviours 88
            anim 88              panel-scene 76  input 75
```

Physics is a plugin. The inspector is a plugin. Delete both and the engine still
boots — a static scene, no detail pane, nothing else notices. Naming rules are
in `ARCHITECTURE.md`.

## The kernel modules

| Module | Owns | Does not know about |
|---|---|---|
| `bus.js` | an event channel | anything |
| `world.js` | entities, types, behaviours, and the hooks that run them | rendering, physics, files; the look vocabulary is `world-look.js` |
| `loop.js` | the clock, the schedule, the holds | what it is stepping; the random stream, the input record and the timers are `loop-random.js`, `loop-input.js` and `loop-timers.js` |
| `checkpoint.js` | a whole moment of a run: taken and put back | which plugin holds what, or how it is stored |
| `rewind.js` | the last minutes of a run, as marks, and the walk to a step count | what a game does with a step |
| `files.js` | the only writer to disk | what a level is, or how disk is reached |
| `loader.js` | plugin order, contribution points, failure containment | any specific plugin |
| `render.js` | one GL context, one draw order | game rules, or where the camera is |
| `ui.js` | the vocabulary panels compose from | any specific panel |
| `shell.js` | the dock frame: a toolbar, four docks, the status line, the canvas | what goes in them, or what a key does; the dock sizes are `shell-layout.js` and the keyboard is `shell-shortcuts.js` |
| `inspect.js` | the read-and-drive surface | whether anything is drawing |
| `start-world.js` | boot, and the `context` everything receives | screens |
| `index.js` | the browser: shell, renderer, the paint loop | game rules |
| `start-world-node.mjs` | the same world in node: disk, readdir, paths | game rules |
| `project-index.mjs` | what is in a project | the browser — node only; the determinism lint is `index-lint.js` and the invariant checks are `index-invariants.js` |
| `asset-path.js` | where a named asset points, as a path and as a URL | anything else — both halves import it |
| `camera-project.js` | world to screen from `view` alone, with no renderer | meshes, materials, or any plugin |
| `command-schema.js` | the command-input subset the execution boundary checks | what a command does |
| `document-store.mjs` | reading and writing session documents | what a document means |
| `frame-plan.js` | what each entity is drawn as, without a GL context | meshes, materials, shading |
| `host-node.mjs` | the project directory and running a program, node only | anything the browser half can do; it is `null` there |
| `plugin-guides.mjs` | the `.agent.md` guides beside every plugin, as instruction nodes | the plugins themselves |
| `plugin-import.js` | importing one plugin file, and reporting why it would not | which finder asked, or what the plugin does |
| `plugin-runtime.js` | compiling system schedules, and the resources a plugin owns | any specific plugin |
| `project-path.mjs` | where a project is on disk, from what a person typed | the browser — node only |
| `reload-notice.js` | carrying a world through a page reload, and saying so either way | what the game means by the world |
| `source-files.mjs` | reading and writing engine and project source | how the edited code behaves |
| `work-lock.mjs` | whether a lane may write, derived from what is running | how a write reaches disk; the routes enforce it |
| `world-look.js` | the look and merge vocabulary, shared by placing an entity and saving it | the store, or the level file |
| `world-state.js` | the checkpoint projection and the level shape | the store itself |
| `value-projection.js` | one value written down and put back, under a stated policy | what a checkpoint is |
| `loop-random.js` | the deterministic random stream | every other part of the run |
| `loop-input.js` | the input record and its replay | what an input means |
| `loop-timers.js` | timers on the fixed clock | the wall clock |
| `shell-layout.js` | the dock sizes and the four resize handles | what goes in the docks |
| `shell-shortcuts.js` | the shortcut table, and the one keyboard listener | what a key does |
| `log.js` | the process-wide error channels, and how a world's log reads them | what an error means |
| `snapshot.js` | the snapshot projection | driving the engine |
| `device-profile.js` | the screen shape a game declares | drawing it |
| `plugin-startup.js` | hold the world until a plugin has finished starting | any plugin |
| `plugin-boot.js` | find the plugins, decide which run, and boot them | what a plugin contributes |
| `world-context.js` | the surface a plugin reads and drives the project through | what a command does |
| `world-editor.js` | the editor's own state, and the two commands on it | the world's rules |
| `world-project.js` | the project's types, behaviours and levels, and play mode | the store |
| `frame-wiring.js` | what one step and one frame do to the world | the clock itself |
| `on-disk.mjs` | reaching a project directly, on disk, and the guard on its writes | the browser — node only |
| `null-renderer.mjs` | the screen a node world pretends to have | real pixels |
| `index-lint.js` | the determinism lint over a project's JavaScript | building the index |
| `index-invariants.js` | the invariant checks on raw level placements | loading the types it reads |
| `reload-projection.js` | a live world written as plain data, and put back | when a reload happens |
| `reload-notice-writer.js` | the notice that a page reloaded, written before it goes and offered once after | the world it describes |
| `report-once.js` | say a message once, then stay quiet | what the message means |
| `round3.js` | round a number to three decimals before it is written down | anything else |
| `render/batching.js` | static entities merged by material and grid cell | per-entity look |
| `render/camera.js` | the two world cameras, and the viewport they are built from | meshes, materials |
| `render/contact-shadows.js` | the contact shadow, all of them in one draw call | a model's own materials |
| `render/entity-look.js` | what one thing is: its turn, origin, sheet cell and fallback colour | how it is built |
| `render/entity-record.js` | what a frame already knows about one entity, kept beside it | the entity's own fields |
| `render/entity-scan.js` | the quiet snapshot and the two scans over it | building scene objects |
| `render/entity-sync.js` | turning the entity list into scene objects | the world's rules |
| `render/floor-mark.js` | the shape both floor marks share: the instanced unit quad | what either mark draws |
| `render/frame-draw.js` | one frame out of the card, and what the last one cost | what is drawn |
| `render/geometry-cache.js` | solid geometry cached by its dimensions, and the one merge | materials |
| `render/ground-band.js` | the TSL of a flat mark on the floor | the ring that uses it |
| `render/ground-rings.js` | the ground ring, one actor named by a rule | a model's own materials |
| `render/keyline-hull.js` | the geometry a keyline is drawn from, and the vertex node that grows it | the line that uses it |
| `render/keyline-marks.js` | the keyline, a dark line of constant screen width | a model's own materials |
| `render/lighting.js` | what the level says about light, fog and sky | what is lit |
| `render/mark-registry.js` | the per-entity marks a plugin adds, at the one place the sync writes a mark | what a mark draws |
| `render/material-registry.js` | what a surface is made of, contributed by plugins | which entity uses it |
| `render/material-vocabulary.js` | the two ways this renderer touches a material | what a material means |
| `render/model-cache.js` | a model file, fetched once, cloned per entity | where it is placed |
| `render/model-nodes.js` | a loaded model addressed by node name | the rest of the entity |
| `render/object-builder.js` | the scene object that stands for one entity | the world's rules |
| `render/picking.js` | a ray into the scene, and the world-point-to-pixel mapping | drawing |
| `render/post-chain.js` | an ordered list of passes | what a pass does |
| `render/read-value.js` | what a declared colour, intensity or vector means | the surface it lands on |
| `render/readability-marks.js` | the three readability marks, and who gets them | a model's own materials |
| `render/report.js` | the renderer's one history of messages already said | what each message means |
| `render/scene-layers.js` | the two layers the scene draws on | what is on them |
| `render/texture-cache.js` | one texture, cached, in three readings of the same file | what it is drawn on |
| `render/viewmodel.js` | the weapon in first person, in its own pass | where the player is |

The rows after `work-lock.mjs` are the newer, smaller kernel modules: the
pieces the largest files were split into, plus the two helpers those splits
produced. Every one is in the boot closure, so this table and the shape block
count the same 82 modules.

The twelve rows after `asset-path.js` are boot plumbing the original table left
out: the modules the two entries pull in. Six are node only —
`project-path.mjs` `document-store.mjs` `source-files.mjs` `work-lock.mjs`
`plugin-guides.mjs` `host-node.mjs`. `index.js` and `start-world-node.mjs` are
the entries, and `start-world.js` is the runtime they both call.

Four files once claimed `Kernel:` in their header without being in the boot
closure: `vector.js`, `frame-facts.js`, `frame-sketch.js` and `scene-query.js`.
Plugins imported them and nothing in `engine/` did, so they now live with their
consumers — the three See internals in `plugins/builtin/see/`, and `vector.js`
in `plugins/builtin/shared/`. The dependency edge decides, not the header
comment. `project-index.mjs` is the reverse: no header claim, but node boot
imports it, so it is in the closure.

The shell also owns four dock resize handles because they change the frame, not
panel content. Sizes are browser-local layout state and survive reloads; they
never enter project files. `Panel Layout` exposes the same state through
`layout.read`, `layout.set`, and `layout.reset` for terminal inspection.

Two things moved out of `render.js` to make that work. `view` — where the camera
is looking — and `viewport` — how big the picture is — are session state now,
because they are game values that a camera plugin reads and writes. They existed
only inside the renderer before, so a world with nothing drawing it had no
camera at all. It also made camera bounds reproducible: they were clamped
against the real browser window, so the same level framed differently in a small
window than a large one.

`loader.js` is the reason the plugin claim is real. Every contribution point —
`panels` `tools` `commands` `fields` `importers` `systems` `menus` — is a list
it collects and hands to whoever consumes it. The shell asks for `panels`,
`menus` and `tools`, and reads the optional `key` on a `commands` or `tools`
entry to bind it. The loop asks for `systems`. Neither knows who supplied them.

A shortcut is `key: 'ctrl+z'` — lowercase, ctrl then shift then alt then the
key, `ctrl` matching Command on a Mac. The shell listens; a plugin declares and
never opens a listener of its own, because only the shell can see two plugins
wanting the same key. It reports that collision by name and keeps the first.

Turning a plugin off withdraws its contributions immediately; the next reload
skips it entirely. A plugin cannot be un-loaded mid-session — its `onLoad` has
already run and may hold DOM or listeners — so anything it added to `context`
stays until reload.

## Boot

`start-world.js` is the whole engine minus anything that needs a document.
`index.js` is the browser wrapper around it; `start-world-node.mjs` is its twin
in node. Steps 5 and 6 are the only ones a headless world skips.

```
1. make bus, world, loader, files
2. make the loop, with the fixed and frame callbacks
3. load every plugin       plugins/builtin/*.js + <project>/plugins/*.js
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

Two things differ between the two, and nothing else does: files come off disk
instead of over HTTP, and project files are imported by path instead of by URL.
Each is handed to `startWorld` as an argument, so there is one runtime rather
than two that can disagree. A test asserts that a headless snapshot and an
attached editor's snapshot are identical, entity for entity.

Plugin discovery used to be a third difference — a Vite glob in the browser
against a readdir in node. It is not any more: both read a file listing, which
is what let the project directory become a parameter. `import.meta.glob` takes
a static literal only, so a glob could never have named a directory chosen at
run time.

Which project is one parameter: `ENGINE_PROJECT` for the dev server, `--project`
for the CLI and headless. It is a path resolved against the checkout, so a bare
name reaches a directory inside it and `../x` or an absolute path reaches one
anywhere. Neither given opens the untitled project.

The browser is never told that path. It fetches every project module and asset
under the fixed URL `/project/`, and a middleware maps that prefix onto the
served directory through `/@fs`. So the URL, a `match:` pattern and a claim all
spell a project file `project/…` whatever its directory is called, and the page
asks `GET /api/project` for the name to show. The server can repoint itself,
which is what makes `project.open` a page reload rather than a restart.

Step 7: the dev server builds `.engine/index.json` by
*importing* each type file and reading its actual `properties`, hooks and asset
references — not by parsing text. So the index is exact: it is what the editor's
search reads, and `.engine/index.agent.json` is the compact view the
instructions tell an agent to read first.

Step 8 is why writing a new type file works without a reload: a glob is fixed
when the page loads, a fetched list is not.

## One frame

```
fixed step (exactly 1/60, never wall time)
  ├─ world.rememberPlaces()         every body's place before the step
  ├─ timers due now
  ├─ held? stop here — the world is in hit stop, the frame still draws
  ├─ systems with phase:'fixed'     physics, animation, Game Camera
  └─ every entity's update(e, seconds, context)

frame
  ├─ systems with phase:'frame'     Live Camera, input bookkeeping, hud
  ├─ renderer.sync(world, blend)    copy places into Three.js meshes
  └─ renderer.draw()
```

`loop.blend` is how far the wall clock is past the last step, as a fraction of
a step. The renderer draws each body at `world.drawnPlace(entity, blend)`,
between its place before the step and its place now, so motion is smooth at any
refresh rate. `step()` sets it to 1: a stepped world is drawn as it is. Game code
reads `x`, `y`, `z` and never the drawn place; a camera reads the drawn place.

In edit mode the fixed step never runs — just sync and draw. That is the entire
difference between editing and playing.

`loop.holdFor(seconds)` is the one thing that can skip a step: hit stop, the
brief freeze on a heavy hit. The clock and schedule keep running through it, so
`context.time` stays a single clock, and it rounds to whole steps because a
fraction of a fixed step is not a fixed step. `Impact` drives it. There is
still no general time scale.

**Physics never touches the renderer.** It reads and writes `e.x` / `e.y`; the
renderer reads the same numbers. Swapping the renderer would not affect physics
at all, and swapping physics would not affect rendering.

The two-clock reality is hidden on purpose. Game code gets `update` and a `seconds`,
and never has to learn what a fixed step is — which is why there are four hooks
and no `FixedUpdate`.

## A moment of a run

`context.capture()` takes a moment of the whole run and `context.restore(moment)`
puts it back. Three parts, because a run has three:

```
world        entities, their fields, their behaviours' bags, the shared state
loop         the step count, the seed and its draw count, held keys, holds, hit stop
a plugin     whatever it holds outside the world, asked for by name
```

A plugin declares its part in `onLoad` with `context.checkpoints.add(name, {
capture, restore })`. Rapier's solver is the case it exists for: the entities of a
simulated world are not enough, because a box restored to where it was with no
velocity behind it is a world that stands still and looks right. `capture()`
answers with the state or with null when it holds nothing; `restore(state)` answers
whether it went back, and one that answers false is named in the reply rather than
left standing beside a world that has moved on.

A plugin goes back first, because a solver writes its own places out onto the
entities as it goes; the entities are then written from the moment exactly as they
were captured. The loop goes last, because everything above it can draw from the
random stream or schedule a timer while it rebuilds, and a draw taken during a
restore would leave the stream one past where the captured run had it.

What a moment cannot carry is named in `moment.lost` — a scheduled callback is a
closure over whatever scheduled it — so a checkpoint that is not exact says so. It
is in memory and not JSON: solver bytes do not belong in a string, and a rewind is
a step back inside a run. A moment that has to survive the page going away is
`reload-notice.js`, which pays for JSON because there it is the only route.

## Going back through a run

`context.rewind` keeps the last two minutes of a run as moments, and
`engine.marks`, `engine.mark`, `engine.stepBack` and `engine.seek` are how a caller
uses it.

A mark is taken every sixty steps rather than every step, because a moment is about
0.17 ms and 78 KB in a scene with forty Rapier bodies in it. `seek(steps)` puts back
the newest mark at or before that count and steps the rest of the way, so going to a
count between two marks costs the steps between them and nothing else. An empty ring
marks on the first step whatever the stride, which is what gives a run the mark it
opened with.

Three things are worth knowing about it:

- **The mark is taken before the step, at the count the clock reads.** A mark taken
  inside a step would be a world that has already moved and a clock that says it has
  not, and replaying it would skip that step.
- **A rewind takes the input timeline from the loop, not from the mark.** A moment
  taken at step sixty cannot hold a key released at step seventy; the mark was taken
  before that happened. The loop applies recorded events at the count they were
  stamped for, so the replayed segment is played with the same keys going down at the
  same counts. A key pressed after a rewind voids the recorded future, because that
  future no longer happens.
- **A mark is the whole world**, so going back past an edit undoes the edit with it.
  That is the honest reading of "step back"; the other reading — an edit surviving a
  rewind — is the one an agent would otherwise assume.

A forward `seek` is refused and names `simulate`: it would be a rewind and a replay
of a future that has not happened. A level load or a restored page clears the ring,
because the marks describe entities the world no longer has.

## `context` — the one object

Every plugin and every hook receives the same thing:

```
world  loop  bus  files  editor  loader  view  viewport
device  host                             the declared screen shape, and node-only power
startup                                  work a plugin declared and has not finished
checkpoints  capture  restore            a whole moment of the run, taken and put back
rewind                                   the last minutes of the run, as marks
renderer  shell                          absent when nothing is drawing
spawn  destroy  select  open  run  save  redraw  importProjectFile
assets  types  levels  level  selection
time  random  after  every  cancel          the deterministic runtime
input  camera  play  audio  hud             contributed by plugins
```

`input`, `camera`, `play` and `hud` are not kernel: plugins added them to
`context`, and game code calls `context.input.axis('x')` or
`context.camera.shake()` with no import. A plugin you write can add its own.


## Plugin contracts and lifecycle

`onLoad(context, scope)` keeps the existing context argument. A plugin declaring
`lifecycle: 'scoped'` registers listeners with `scope.on`, services with
`scope.provide`, and other cleanup functions with `scope.defer`. Scoped onLoad
is synchronous; background work must register its cancellation before returning.
Declare service names in `provides` and `requires`; use `scope.require` to obtain
an explicitly required service. Missing providers, duplicate owners, duplicate
plugin names and dependency cycles are errors before boot. Service versions are
not negotiated. Services are names within one world, not global process state.

A plugin that cannot finish inside `onLoad` declares the promise with
`context.startup.add(name, promise)`, and holds the loop under a name until it
lands. The world is not handed over until every declared start has settled, and a
step taken while one is still running is held rather than simulated, so a run
cannot begin with a backend missing from it and answer as though it had.

Disable and failure revoke scoped resources, in reverse registration order.
Dependent plugins are disabled first. Re-enable providers before consumers;
scoped plugins initialize again. A cleanup failure is reported and does not
prevent remaining cleanup. Legacy plugins retain their former activation
behaviour and may retain direct subscriptions or context mutations. This is
reported as `lifecycle: legacy`, not treated as complete lifecycle coverage.
Profiler uses scopes and removes its compatibility aliases.

Systems may declare a stable `id` and same-phase `before`/`after` arrays. The
loader compiles fixed and frame schedules when registrations change, preserving
registration order where no constraint intervenes. Missing targets, duplicate
IDs and cycles stop system execution and set `scheduleError`; diagnostic
commands remain available. A disabled plugin's remaining systems are skipped
within the current tick. Anonymous legacy systems receive runtime IDs; declare
an ID before another plugin depends on it. `reads`/`writes` are documentation,
not enforced isolation. Entity hooks still run after fixed systems.

## Agent contract discovery

Run `agent.commands` and `agent.contracts` through `engine run` or `engine.run`.
Both accept `{query, plugin, offset, limit}` and return paginated reports. The
plugin filter uses the exact display name. Commands with no schema say
`validation: undeclared`; never infer that their arguments have been checked.

`inputSchema` is checked at the engine.run boundary before calling the handler.
The supported subset is type, properties, required, additionalProperties,
items, enum, minimum, maximum, pattern and description. `pattern` must be a
string and is tested with JavaScript RegExp semantics, unanchored unless the
schema anchors it; a non-string or malformed pattern is reported as a schema
defect, never coerced. Unsupported keywords fail explicitly. Direct JavaScript
calls to a handler bypass that boundary. Return values and data-access
declarations are not validated by this feature.
