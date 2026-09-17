# The kernel and boot

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

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
boots — a static scene, no detail pane, nothing else notices. Naming rules are
in `ARCHITECTURE.md`.

## The kernel modules

| Module | Owns | Does not know about |
|---|---|---|
| `bus.js` | an event channel | anything |
| `world.js` | entities, types, behaviours, the shared vocabulary | rendering, physics, files |
| `loop.js` | the clock, the schedule, the random stream | what it is stepping |
| `checkpoint.js` | a whole moment of a run: taken and put back | which plugin holds what, or how it is stored |
| `rewind.js` | the last minutes of a run, as marks, and the walk to a step count | what a game does with a step |
| `files.js` | the only writer to disk | what a level is, or how disk is reached |
| `loader.js` | plugin order, contribution points, failure containment | any specific plugin |
| `render.js` | one GL context, one draw order | game rules, or where the camera is |
| `ui.js` | the vocabulary panels compose from | any specific panel |
| `shell.js` | four docks, a toolbar, a status line, the one keyboard listener | what goes in them, or what a key does |
| `inspect.js` | the read-and-drive surface | whether anything is drawing |
| `start-world.js` | boot, and the `context` everything receives | screens |
| `index.js` | the browser: shell, renderer, the paint loop | game rules |
| `start-world-node.mjs` | the same world in node: disk, readdir, paths | game rules |
| `project-index.mjs` | what is in a project, and the determinism lint | the browser — node only |
| `asset-path.js` | where a named asset points, as a path and as a URL | anything else — both halves import it |

The last three are the split. Everything above `start-world.js` runs identically
either side of it.

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
Profiler and Systems Inspector use scopes and remove their compatibility aliases.

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
items, enum, minimum, maximum and description. Unsupported keywords fail
explicitly. Direct JavaScript calls to a handler bypass that boundary. Return
values and data-access declarations are not validated by this feature.
