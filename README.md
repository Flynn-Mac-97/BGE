# browser game engine — v1

An AI-native game engine that runs in the browser. Everything except a small
kernel is a plugin, including the editor's own panels.

**[ARCHITECTURE.md](ARCHITECTURE.md)** explains how it works and why it is
shaped this way. This file is how to use it.

```
npm install
npm run dev          # http://localhost:5180
```

## The shape of a project

Depth 1 everywhere. One file per thing.

A project is a directory anywhere on disk, and this repository holds none: the
engine opens with a blank one. `ENGINE_PROJECT=path npm run dev` opens another,
and the editor always calls the open project `project/` whatever it is really
called — in a URL, in a `match:` pattern, and in every path below.

```
project/
  game.json          entry point: title, startLevel, device, plugins off
  types/             coin.js  player.js  bat.js       what things ARE and DO
  behaviours/        float.js  spin.js  patrol.js     one trait, shared by any type
  levels/            level1.json                      where things are placed
  tests/             coin-pickup.js  jump.js          checks that outlive a session
  assets/            sprites and sounds
  plugins/           your own editor extensions
  agents/            game instructions and skill settings
  .engine/index.json generated; the editor's copy, plus index.agent.json for agents
```

`game.json` names the screen the game is drawn for, once:

```json
{ "device": { "width": 540, "height": 960, "pixelRatio": 2, "orientation": "portrait" } }
```

The viewport every camera clamps against comes from it, and so does the shape
`see.capture` draws at — so a set of frames is one shape and can be compared. A
measured browser window overrides it. A game that declares no device gets
1280x720 landscape.

## Agent workspace

The root `AGENTS.md` is a short bootstrap that points at `ENGINE-BASE.md` —
the base instructions: speech, code and comment style, and where everything
is, with links out. Engine rules are in `agents/`. Game rules are in
`project/agents/`. Their manifests join into one tree.

Open **AGENTS** to inspect the tree, add a branch, edit its file, or switch an
optional skill on or off. A disabled skill adds no text to an agent packet.
Skills use the portable `SKILL.md` format.

Every plugin may carry a short sidecar guide beside its code:

```text
plugins/builtin/physics-3d.js
plugins/builtin/physics-3d.agent.md
```

The **Plugins** branch discovers these files by itself. A guide is loaded only
when its plugin is enabled and the task names or edits that plugin — unless the
guide declares `match:` paths of its own, as `Plugin Master` does so it is included
in every plugin task. Being a plugin, it can carry commands and tests too.

Engine style defaults can be replaced for one project. An engine rule names an
override key; a project rule with the same key wins only for matching project
files. Core safety rules have no key, so a project cannot replace them.

```text
node bin/engine.mjs agent.context engine/world.js
node bin/engine.mjs agent.prepare small-fix engine/world.js
node bin/engine.mjs agent.prepare parallel-fix engine/world.js --parallel
node bin/engine.mjs agent.status
node bin/engine.mjs agent.release small-fix --checked
```

A small, single-writer task stays in the current workspace. A parallel writing
task requires a clean tracked baseline and gets a git worktree under
`.agent-worktrees/`. Overlapping file claims are refused. The editor's
**AGENTS** panel shows the same tree, file sizes, skill state, and recorded
runs. A task cannot be marked complete until its required checks are recorded.
Context resolution works offline; the browser never runs git.

### A type

Data and behaviour in one file. Four hooks, no more.

```js
// types/coin.js
export default {
  collider: { circle: 0.22 },
  properties: { value: 10, spin: 120 },

  start    (entity, context)          {},  // this coin entered the world
  update   (entity, seconds, context) { entity.rotation += entity.properties.spin * seconds },
  onCollide(entity, other, context)   {},  // began touching `other`
  onDestroy(entity, context)          {}   // left the world
}
```

`properties` doubles as the inspector schema — declared once, in code.

Nothing here is abbreviated. `properties`, not props. `context`, not ctx.
`entity`, not e. `seconds`, not dt. A short name saves nothing and costs every
first-time reader — which an AI model is on every read — a decoding step.

### A behaviour

One trait, in its own file, that any number of types can attach — and so can a
single placement.

```js
// behaviours/float.js
export default {
  about: 'bob up and down around where it started',
  properties: { speed: 2, amplitude: 0.3 },

  start (entity, context, self)          { self.base = entity.y },
  update(entity, seconds, context, self) {
    entity.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
  }
}
```

`self` is the behaviour's own bag on the entity — its properties to begin with,
plus whatever running state it keeps. It is also reachable as `entity.float`.
Because each behaviour has its own bag, `float` and `spin` can both have a
`speed` and neither can see the other's.

```js
// types/crate.js — every crate gets it
behaviours: ['float'],
behaviours: { float: { speed: 4 } },      // or with the defaults changed
```

```json
// levels/level1.json — only this crate gets it
{ "type": "crate", "at": [3, 1, 0], "behaviours": { "float": { "amplitude": 1.5 } } }
{ "type": "crate", "at": [5, 1, 0], "behaviours": { "float": false } }
```

Behaviours run in the order they are written, and the type's own hooks run
**last**, so a type always gets the final word on what it composed. **A
behaviour cannot look up another behaviour** — if two must agree they do it by
reading and writing plain fields on the entity. That single rule is what keeps
this from turning into a component graph with an execution-order settings
screen.

Drag one from the Project panel onto an entity in the viewport to attach it.
The Inspector shows what each entity composes, what each is set to, and whether
it came from the type or from that one placement.

### Sprites

```js
sprite: 'coin.png'                                  // shorthand
sprite: { image: 'coin.png', width: 0.5, height: 0.5 }
sprite: { image: 'brick.png', tile: 1 }             // repeat once per world unit
```

A bare name means `assets/`. The sprite decides how big a thing draws and the
collider decides how big it hits — art is usually larger than its hitbox, so
the sprite wins and the collider is only the fallback. `tile` repeats the
texture instead of stretching it, so one 16-wide platform draws sixteen bricks.

Everything is `NearestFilter` with no mipmaps, so pixel art stays crisp. A
texture that fails to load falls back to the type tint **and** reports itself
in `engine.errors()` — a blank viewport with an empty log gives an agent
nothing to act on.

The demo art is generated from text, not committed as opaque binary:

```
node tools/make-sprites.mjs
node bin/engine.mjs --headless run tools.make sprites
```

`tools/make-sprites.mjs` holds a palette and sixteen rows per sprite, so a
colour can be changed in a diff without a paint program.

### Animation

A sheet is frames side by side. Clips are declared as data; game code picks one
by **assignment**, so an update hook says what the entity *is* doing without
tracking what it *was* doing.

```js
sprite: { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },
animation: {
  idle: 0,                                 // one frame
  walk: { frames: [1, 2], framesPerSecond: 8 },        // a cycle
  jump: { frames: [3], loop: false }       // one-shot; sets e.animationDone
}
```

```js
update(e, seconds, context) {
  const move = context.input.axis('x')
  e.animation = !e.grounded ? 'jump' : move ? 'walk' : 'idle'
  e.flip = move < 0        // mirrors the art, not the collider
}
```

Frames advance on the fixed step, so a walk cycle looks the same in a headless
`simulate()` as it does on screen.

### Sound

```js
sounds: { jump: 'jump.wav', hurt: 'hurt.wav' }
...
e.play('jump')                          // this entity's sound
context.play('coin.wav', { volume: 0.4 })   // or any file
```

Every play is **recorded whether or not it is audible**, so a headless run can
still answer "did the coin make a noise":

```
node bin/engine.mjs run audio.recent
```

The demo sounds are generated, not committed as blobs — `node tools/make-sounds.mjs`
describes each one as a frequency sweep you can read and change (`tools.make sounds`
runs the same tool through the engine).

### A level

Types define, levels place. Overrides are plain JSON and stay visible in the file.

```json
{ "entities": [
  { "type": "coin", "at": [8, 4, 0] },
  { "type": "coin", "at": [9.5, 4, 0], "properties": { "value": 50 } }
]}
```

There is no save button. Every edit writes to disk immediately.

### Camera and HUD

Both are declared in the level, because following the player and showing a score
are properties of the level rather than of the player.

```json
"camera": { "follow": "player", "lerp": 0.12, "lookAhead": 0.3, "bounds": [0, 0, 30, 12] },
"hud": [
  { "text": "SCORE {score}", "at": [14, 12] },
  { "text": "{coins} COINS LEFT", "at": [-14, 12], "anchor": "top-right" },
  { "bar": "{health}", "max": 3, "at": [14, 34], "size": [90, 8] }
]
```

`{name}` reads `world.state.name` — the state game code already writes to — so a
HUD needs no wiring at all.

The **game camera and the editor viewport are separate**. Your view is saved
when play starts and restored when it stops, so pressing play never loses your
place. `bounds` keeps the view inside the level, and centres instead if the
level is smaller than the screen. From code: `context.camera.follow(e)`,
`context.camera.moveTo(x, y)`, `context.camera.shake(0.35)` — shake uses `context.random`,
so a replay shakes identically.

For a real-time 3D camera, use a `cameras` list instead: **Live Camera** updates
on every drawn frame, so mouse orbit and follow have no step delay. See
`plugins/builtin/live-camera.agent.md`.

The HUD is drawn into the canvas, not with CSS. A DOM overlay would be a second
renderer with its own coordinates, invisible to `snapshot()` and absent from a
screenshot. `node bin/engine.mjs run hud.read` returns what it currently says.

## Authoring in the editor

**Layout.** Drag the thin borders beside the left, right, bottom, or expanded
centre panels to resize them. Sizes survive reloads. Arrow keys resize a
focused border; double-click or `node bin/engine.mjs layout.reset` restores it.

**New.** The `+` in the Project panel makes a type, behaviour, level, test or
plugin — pick a kind, give it a name, and it writes the file and opens it. The
type template shows the whole shape: the four hooks, commented, and nothing
else.

**Place, and attach.** Drag something out of the Project panel and where you
let go decides what it means. A **type** dropped anywhere places one, snapped to
a half unit, selected, and written to the level. A **behaviour** dropped on an
entity attaches to that entity. Clicking a row still opens it — dragging is a
second gesture, not a mode.

**Plugins.** The `PLUGINS` button in the toolbar opens a browser of every
plugin, what each one contributes, and a switch for each. Turn off
`Inspector Panel` and the inspector goes; turn off `Physics 2D` and nothing
falls. It is the fastest way to see what the engine is made of.

Which plugins are off is stored in `project/game.json`, because it is a
property of the project:

```json
{ "title": "Platformer", "startLevel": "level1",
  "plugins": { "disabled": ["Physics 2D"] } }
```

All three work from a terminal too:

```
node bin/engine.mjs run new.file '["type","enemy"]'
node bin/engine.mjs run new.file '["behaviour","chase"]'
node bin/engine.mjs run place.at '["coin", 4, 2]'
node bin/engine.mjs run behaviour.attach '["coin-0","float"]'
node bin/engine.mjs run behaviour.attach '["coin-0","float",{"amplitude":1.5}]'
node bin/engine.mjs run behaviour.detach '["coin-0","float"]'
node bin/engine.mjs run behaviour.list
node bin/engine.mjs run plugins.enable '["Physics 2D", false]'
node bin/engine.mjs run plugins.list
```

## Tests

Two suites, and they cover different layers.

```
npm test                                      # the CLI -> engine bridge, from outside the browser
node bin/engine.mjs --headless run tests.run  # the project's own game tests, in this process
```

`npm test` spawns the real CLI and checks exit codes, argument coercion,
determinism, isolation between headless worlds, and the failure modes an agent
hits — it needs `npm run dev` and **one** open editor tab. Two tabs both answer
the bridge and the first reply wins, which shows up as a test that fails for no
visible reason.

The game tests need neither. They run in a private world in the CLI process, so
several can run at once without seeing each other.

A test is a file, the same way a type is a file. The throwaway scripts written
to check a change are exactly the ones worth keeping, so they are kept in the
project rather than in a shell history.

```js
// project/tests/coin-pickup.js
export default {
  name: 'a coin scores its placement value, not its type default',
  level: 'level1',
  run(t) {
    const coin = test.entity('coin-2')
    test.at('player-0', coin.x, coin.y + 1.2)
    test.simulate(1)
    test.is(test.state.score, 50, 'score used the override')
    test.is(test.count('coin'), 2, 'the coin was destroyed on contact')
  }
}
```

```
node bin/engine.mjs --headless run tests.run              # all
node bin/engine.mjs --headless run tests.run coin-pickup  # one
```

They also run from the Tests panel in the bottom dock, which keeps a pass/fail
strip per test — `FP` means it failed once and passes now. Results are written to
`project/.engine/tests.json`, beside the generated index and out of the tree
you browse, because they are output rather than source.

`test.simulate(sec)`, `test.hold(action, sec)`, `test.tap(action)`, `test.entity(id)`,
`test.count(type)`, `test.state`, `test.at()`, `test.set()`, `test.spawn()`, `test.destroy()`,
and `test.is` / `test.near` / `test.ok` / `test.note`. Every assertion runs, so one pass
reports every failure rather than the first.

Each test reloads its level first, so tests cannot affect one another, and a
simulated world refuses to save, so a test run cannot damage a level file.

## The kernel

Nothing else is privileged.

| Module | Owns |
|---|---|
| `world.js` | entities and the shared vocabulary |
| `loop.js` | the clock, the schedule and the random stream |
| `bus.js` | the channel plugins talk through |
| `files.js` | the only writer to disk |
| `loader.js` | plugin loading, dependency order, failure containment |
| `render.js` | one GL context (Three.js), ortho for 2D |
| `ui.js` | the UI vocabulary plugins compose from |
| `start-world.js` | boot, and the `context` everything receives |
| `index.js` | the browser half: shell, renderer, the paint loop |
| `start-world-node.mjs` | the same world in node, with no screen |
| `project-index.mjs` | what is in a project, and the determinism lint |

The last three are the split that lets a world run without a browser. Put new
runtime behaviour in `start-world.js`; anything added to `index.js` is something
a headless world cannot do.

## Plugins

Same `export default {}` shape as a type. Drop a file in `plugins/` — no
manifest, no build step, no registration call.

```js
export default {
  name: 'sprite-browser',
  panels: [{
    id: 'sprites', title: 'Sprites', dock: 'right',
    render: (ui, context) => ui.grid({
      items: context.assets('image'),
      cell: a => ui.thumb(a, { label: a.name }),
      onPick: a => context.select(a)
    })
  }]
}
```

Contribution points: `panels` `tools` `commands` `fields` `importers`
`systems` `menus`. `menus` puts a button in the toolbar, and every one is
also a CLI verb — a button a person can press must be reachable from a terminal
or the two ways of driving the editor diverge. A `commands` or `tools` entry may
also carry `key: 'ctrl+shift+z'` — lowercase, `ctrl` then `shift` then `alt`
then the key, with `ctrl` matching Command on a Mac. The shell listens and
dispatches; never open your own keydown listener. Two entries claiming one key
is reported by name in the log, and the first keeps it.
For events, subscribe in `onLoad(context)` with
`context.bus.on('shell:ready', ...)` — the viewport does not exist before then.

Plugins never write markup — they compose from `ui.*`, which is why a panel is
fifteen lines and always matches the editor. A plugin that throws is disabled
with its name and reason reported; it cannot take the editor down with it.

Everything shipped here loads through that same path:

```
Scene Panel         Project Panel       Inspector Panel
Code Panel          Plugin Browser      New File
Transform Tool      Place And Attach    Behaviours
Physics 2D          Sprite Animation    Game Camera
Sound               Heads Up Display    Keyboard Input
Terminal Bridge     Test Runner         Live File Updates
History             Live Camera
```

Names are what you would say out loud, in capitalised words. That one name is
what the plugin browser lists, what `plugins.enable` takes, and what an error
is reported against.

## Driving it from a terminal

The engine hosts no AI. Any CLI can drive it — Claude Code, Codex, Aider, your
own script. Run it beside the browser; nothing is embedded and nothing is
locked in.

```
npm run dev                              # keep the tab open
node bin/engine.mjs snapshot             # what is in the editor right now
node bin/engine.mjs simulate 1.5         # advance time, get the result
node bin/engine.mjs set coin-2 value 99  # writes straight to the level file
node bin/engine.mjs errors               # what went wrong
node bin/engine.mjs watch                # tail it live
node bin/engine.mjs help
```

Every op is a method name on `window.engine`, so the CLI never has to be
updated when a verb is added. Transport is the dev server's existing websocket
relayed by `Terminal Bridge` — no extra port, no extra dependency, and it dies
with the dev server.

```
your terminal ──▶ bin/engine.mjs ──▶ POST /api/engine ──▶ ws ──▶ bridge plugin ──▶ window.engine
```

Exit 0 ok, 1 error, 2 no editor attached. `AGENTS.md` is generated at server
start and is what a CLI reads to learn all of this; `CLAUDE.md` points at it.

Output is compact when captured and indented at a terminal, because an agent
pays for whitespace on every call and a person does not. `--raw` and
`--pretty` force either.

### Headless — and running many at once

`--headless` starts a world inside the CLI process. No dev server, no port, no
browser tab.

```
node bin/engine.mjs --headless run tests.run
node bin/engine.mjs --headless simulate 2 --level level1 --entities
```

It is the same engine, not a reduced copy — the same plugins, the same context,
the same ops. Only three things differ: files come off disk instead of over
HTTP, plugins are found by reading a directory instead of by a Vite glob, and
project files are imported by path instead of by URL. A test asserts that a
headless snapshot and an attached editor's snapshot match entity for entity, so
the two cannot drift apart unnoticed.

This is what makes a fan-out of agents possible: one dev server has one shared
world; headless worlds are one per process and fully isolated in memory.

### One world, many questions

`--headless` builds a world, answers one op and exits. An agent that looks, then
decides, then looks again pays that boot every time. `serve` holds one world open
and reads one JSON request per line on stdin, answering one JSON line each:

```
node bin/engine.mjs serve --project <game>
{"op":"simulate","args":[10]}
{"op":"snapshot"}
{"op":"editor.loadLevel","args":["level2"]}
{"op":"exit"}
```

An op is a method on the engine, or a dotted path to one, so a session can open
a level rather than needing one session per level. A request that throws answers
`{"error":"..."}` and the session stays up. Anything the engine prints goes to
stderr, so stdout stays one JSON value per line.

Twenty questions cost 6.1 s as twenty `--headless` invocations and 0.3 s in one
session — the boot is paid once, and every question after it is under a
millisecond.

A run never begins before the work its plugins declared has finished. Rapier
compiles megabytes of WebAssembly, and it used to be compiled lazily by the first
step, so a short simulation could advance a world with no physics in it and
answer as though it had. The solver is now started before the world is handed
over — about 15 ms on a project that chose it — and anything that does step while
a backend is still starting is held, with the hold named in `snapshot().paused`.

```
for lvl in a b c; do node bin/engine.mjs --headless run tests.run --level $lvl & done; wait
```

**Private:** the world, the clock, the random stream, the selection, and
anything `spawn` or `simulate` does.
**Shared, because it is on disk:** `project/`. So `set` and `save` are *not*
isolated — give a writer its own git worktree, or keep writers to one lane.
**Not possible:** drawing. There is no canvas, so no screenshot and no `pick`.

For a frame, a lane gets its own headless browser instead of sharing the
person's: `lanes.start <name>` opens one at a stated window size, `lanes` lists
them and `lanes.stop` ends them. Each is one record in the lane registry, and
one name is one browser — a start is refused while a browser of that name is
running rather than orphaning it.

While any lane works the shared checkout is locked. Every writing op is refused
with a reason naming the lanes; reads answer as usual; a lane's own render page
is refused every file write whatever the lock says. `node bin/engine.mjs lock`
says who holds it. Details in [docs/surfaces.md](docs/surfaces.md).

With more than one page attached, a call must name the one it is for:
`--client <id>`. An untargeted call is refused with the list, and every reply
says which page answered.

`index`, `tree`, `check` and `pain` need nothing running either — they read the
project straight off disk, so `check` still works when the dev server is the
thing that is broken.

For a real frame with no monitor, headless Chrome is still the client, and
nothing about driving it changes:

```
ENGINE_NO_OPEN=1 npx vite --port 5181 &
chrome --headless=new --disable-gpu --user-data-dir=/tmp/p http://localhost:5181 &
node bin/engine.mjs simulate 1.5 --port 5181
```

Entity ids are position-in-file (`coin-2`), not a counter, so an id stays
valid across reloads.

A level records where things **start**. Once you `simulate` or play, the world
holds where things **ended**, so saving is refused until you `stop` — which
reloads the level.

## The same surface, in the browser

`window.engine` is the read and drive surface, for an agent working in the
browser without screenshots.

```js
engine.snapshot()                    // compact: mode, counts, selection, errors
engine.snapshot({ entities: true })  // detail on request
engine.commands()                    // every verb, including plugin-contributed
engine.run('view.frameAll')
engine.select('coin-7')
engine.set('coin-7', 'value', 99)
engine.simulate(1.5)                 // advance 1.5s deterministically, no rAF
engine.seed(7)                       // re-seed the random stream, restart the clock
engine.errors()                      // includes uncaught throws and rejections
```

Any command id also works as a CLI verb, so a plugin that contributes
`tests.run` has contributed `node bin/engine.mjs tests.run` with it.

`simulate()` is the important one: it steps the fixed clock directly, so the
game can be tested in a backgrounded tab and the answer to "what happens if
this runs for two seconds" is one call rather than a video.

## Writing files while it runs

Write a file with any editor or any agent's file tools; the running editor
picks it up and the world stays where it was — same entities, same positions,
same selection.

| You write | What happens |
|---|---|
| a **new** type | registered and immediately spawnable |
| an **edit** to a type | live entities move onto the new definition; per-placement overrides survive |
| a type with a **syntax error** | reported in `errors`; entities keep running the last version that parsed |
| a **behaviour** | every entity that attached it moves onto the new file, and running state in its bag survives |
| a level | reloaded if it is the one open |
| a test | runnable at once |
| an image | texture re-fetched |
| a plugin | full page reload — a plugin owns DOM and listeners |

Types and tests are read from the generated index and imported by URL rather
than through `import.meta.glob`, because a glob is fixed when the page loads —
a file written after that would not exist until a reload.

Every swap is logged, so "did my write take?" is one call:

```
node bin/engine.mjs log 10        # hot  types/coin.js → 3 entities
```

Two things still reload the page: editing a **plugin**, and **deleting** any
project file. The second is Vite's — it does not consult plugins on unlink.

## Determinism

`simulate()` is only useful if it repeats. Same level, same seed, same steps —
same answer. The engine enforces that by owning every source of nondeterminism,
so game code has nowhere else to get one.

| Do not use | Use instead |
|---|---|
| `performance.now()`, `Date.now()`, `new Date()` | `context.time` |
| `Math.random()` | `context.random()` + `.int` `.range` `.pick` `.chance` |
| `setTimeout` / `setInterval` | `context.after(s, fn)` / `context.every(s, fn)`, `context.cancel(id)` |
| `requestAnimationFrame` | the `update` hook |

```
node bin/engine.mjs check     # exits 1, with file and line, on any of the left column
```

Engine time is derived from an integer step count rather than accumulated, so
a timer set for `0.25` fires at exactly `0.25` rather than a step late. Loading
a level resets the clock, the schedule and the random stream together —
resetting only some of them is the subtle version of the same bug.

`engine.seed(n)` re-seeds and restarts the clock. Varying the seed is how you
check behaviour holds generally rather than by luck.

The clock, the schedule and the random stream are in one kernel module because
they are the same concern: whether a run repeats.

## Editing

| | |
|---|---|
| Select | click; `shift`-click to add; drag on empty space to marquee |
| Pick from a pile | **right-click** lists everything under the cursor, front to back |
| | `alt`-click repeatedly to walk down the stack |
| Move | drag inside the selection |
| Scale | drag a corner or edge handle |
| Rotate | drag the arc outside a corner; `shift` snaps to 15° |
| Snap off | hold `⌘` / `ctrl` mid-drag |
| Pan / zoom | `space`-drag or middle-drag; scroll zooms at the cursor |
| Frame | `F` selection, `shift`+`F` everything |
| Duplicate | `⌘D` |

There are no tool modes. The handle you grab is the choice.

## Known gaps

- No tilemaps or bulk placement — a big level means placing entities one at a time.
- No scene flow: one level, no transitions, no state carried between them.
- No way to export a playable build; the game only runs inside the editor.
- Group scale and rotate: multi-select moves only.
- No parenting; a crate cannot ride a moving platform.
- A behaviour cannot be attached to several entities at once, and there is no
  way to reorder the ones on an entity from the editor — edit the file.
- Play mode and edit mode look identical.
- The game runs in the editor's page, not a sandboxed iframe, so an infinite
  loop in game code will freeze the editor. `--headless` gives you somewhere
  else to run it, but the editor itself is still one page.
- Two editor tabs on one dev server both answer the bridge and the first reply
  wins, so a state-dependent CLI call can read the other tab's world. Keep one
  tab open; use `--headless` when you want more than one world.
- Headless worlds are isolated in memory but share `project/` on disk, so two
  runs that both save a level will collide.
- No terminal panel in the editor yet — the bridge works, but you run your CLI
  in your own terminal. Embedding one needs a PTY (`node-pty`) so a CLI's TUI
  renders properly.
- Plugins cannot hot-swap; editing one reloads the page. Deleting any project
  file also reloads, because Vite does not consult plugins on unlink.
- `Terminal Bridge` is dev-server only. A production build has no relay.
- The bridge does not authenticate and `eval` runs arbitrary code in the page.
  Fine for localhost; do not expose the dev server on a network.


## Systems Inspector

Open **SYSTEMS** in the editor toolbar to inspect Engine Core separately from Plugins.
Expand fixed/frame systems in their registered order and select a node to read code.
Entity updates expand into representative loaded types and their behaviour hooks.
The kernel outline is a teaching view; plugin children come from the live registry.
This is scheduled flow, not an execution trace. Source access is read-only.
Commands and limits: `plugins/builtin/systems-inspector.agent.md`.

Systems Inspector opens across the editor window. **Systems Map** shows core modules and labelled relationships, with plugins grouped separately. Simulation and presentation remain separate views. Use **Dock view** or **Close** to return to the editor.

**Function calls** in the Systems Inspector parses the selected full source file. Select a function to inspect calls and file-local callers, jump to call-site lines, or follow local definitions and direct relative imports. Dynamic calls are marked unresolved. This does not record runtime execution.

Select a module in Systems Map to highlight its connections while keeping the full map visible. Call lines link resolved imported functions, labelled caller → function; arrows open call sites. Import lines is a separate mode.

The core map inventories index.html and all engine/ JavaScript, MJS and CSS sources from disk. It marks engine/index.js as browser main and draws literal imports. Hover or select a file to highlight its connections. Selection opens source beside the map; Local function detail is optional.

## Systems Workspace: inspection, design and visual scripting

Diagram starts in **Program Flow**: page → entry script → entry function → its direct startup calls → function completion. Calls run left to right; select a step to read its source. Awaited calls and callback registrations are labelled. This first view omits callback bodies, assignments and browser utilities, and does not expand called functions or model error paths. Entries with branches require the detailed Visual Script view. Choose **File Relationships** in the Diagram view selector for the file map.

Use the permanent **Diagram**, **Code**, **Design**, and **Visual Script** links at the top. The blue link and view heading identify the active mode. Bookmark `#systems=inspect`, `#systems=code`, `#systems=design`, or `#systems=script` to reopen it. `systems.mode <mode>` opens the same view from the CLI. Visual Script offers a function picker before any flow exists. Anonymous callback rows are hidden by default; **Show anonymous callbacks** reveals them. Call connections stay included.

System diagram shows file names above clickable function lists. ELK arranges calls left to right, JointJS draws the diagram, and Monaco displays source with syntax colouring and code editing. Select a function or call arrow to open its source line. Use **Selected file** or **Fit diagram** to navigate. Calls describe source structure, not runtime execution order.

**Monaco Code Editor**, **JointJS Diagrams**, and **ELK Graph Layout** are separate plugins in PLUGINS. Systems Inspector declares their services as dependencies. Other plugins can consume them too. Libraries load on demand; disabling a provider disables Systems Inspector through the normal dependency rules. Re-enable the provider, then Systems Inspector, to use it again. Source edits remain drafts until **Apply to source**; **Discard source edits** restores the buffer.

SYSTEMS opens a fullscreen workspace. Inspect code scans source files across engine, builtin plugins and game plugins. The graph follows parsed imports and resolved function calls; it never executes source. Filter by source group or file, select nodes and call sites, and inspect coupling, cycles and unresolved code.

Design mode creates editable architecture drafts with typed nodes, connections, responsibility, inputs, outputs, constraints, decisions and acceptance criteria. Save and reopen project-local versioned diagrams; use undo/redo, JSON import, SVG/Mermaid export or an AI implementation brief. A source-linked draft reports changed evidence after a scan.

Visual scripting converts one selected JavaScript function into code, condition, while and return nodes. Preview validates the flow before Apply writes that function back. Arbitrary statements remain code blocks; generators remain source-only. Source writes check the original hash, retain a backup, and preserve surrounding code. Invalid or conflicting changes remain editable.

The host adapter and UI are separate from `plugins/builtin/systems-inspector/toolkit/`, a plain-data library with a standalone source-scanning CLI. Its README documents reuse outside the engine. Diagrams are stored under the game's `.engine/systems/`, with optimistic revision checks and one previous saved revision.


## Plugin and agent contracts

The loader now owns scoped plugin resources and compiles system schedules.
Use `node bin/engine.mjs --headless run agent.commands '{"query":"profile"}'`
to discover command arguments, and `run agent.contracts` for service owners,
dependencies, lifecycle coverage and schedules. Reports are paginated.
Contracts and migration limits are documented in `docs/kernel.md`.
