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

```
project/
  game.json          entry point
  types/             coin.js  player.js  bat.js       what things ARE and DO
  behaviours/        float.js  spin.js  patrol.js     one trait, shared by any type
  levels/            level1.json                      where things are placed
  tests/             coin-pickup.js  jump.js          checks that outlive a session
  assets/            sprites and sounds
  plugins/           your own editor extensions
  .engine/index.json generated; read by both the editor and the AI
```

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
`entity`, not e. `seconds`, not dt. A short name saves nobody anything worth
having when they are meeting the code for the first time — and a model reading
it cold is in exactly that position, every time.

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
in `engine.errors()` — a blank viewport with an empty log is the worst thing
to hand an agent.

The demo art is generated from text, not committed as opaque binary:

```
node tools/make-sprites.mjs
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
describes each one as a frequency sweep you can read and change.

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

The HUD is drawn into the canvas, not with CSS. A DOM overlay would be a second
renderer with its own coordinates, invisible to `snapshot()` and absent from a
screenshot. `node bin/engine.mjs run hud.read` returns what it currently says.

## Authoring in the editor

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
npm test                        # the CLI -> engine bridge, from outside the browser
node bin/engine.mjs tests.run   # the project's own game tests, inside it
```

`npm test` spawns the real CLI and checks exit codes, argument coercion,
determinism, and the failure modes an agent hits — it needs `npm run dev` and
an open editor tab.

A test is a file, the same way a type is a file. The throwaway scripts written
to check a change are exactly the ones worth keeping, so they live in the
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
node bin/engine.mjs tests.run              # all
node bin/engine.mjs tests.run coin-pickup  # one
```

They also run from the Tests panel in the bottom dock, which keeps a pass/fail
strip per test — `FP` means it failed once and passes now. Results live in
`project/.engine/tests.json`, beside the generated index and out of the tree
you browse, because they are output rather than source.

`test.simulate(sec)`, `test.hold(action, sec)`, `test.tap(action)`, `test.entity(id)`,
`test.count(type)`, `test.state`, `test.at()`, `test.set()`, `test.spawn()`, `test.destroy()`,
and `test.is` / `test.near` / `test.ok` / `test.note`. Every assertion runs, so one pass
reports every failure rather than the first.

Each test reloads its level first, so tests cannot affect one another, and a
simulated world refuses to save, so a test run cannot damage a level file.

## The kernel

Six modules, and nothing else is privileged.

| Module | Owns |
|---|---|
| `world.js` | entities and the shared vocabulary |
| `loop.js` | the clock, the schedule and the random stream |
| `bus.js` | the channel plugins talk through |
| `files.js` | the only writer to disk |
| `loader.js` | plugin loading, dependency order, failure containment |
| `render.js` | one GL context (Three.js), ortho for 2D |
| `ui.js` | the UI vocabulary plugins compose from |

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
or the two ways of driving the editor diverge. For events, subscribe in `onLoad(context)` with
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
```

Names are what you would say out loud, in capitalised words. That one name is
what the plugin browser lists, what `plugins.enable` takes, and what an error
is reported against.

## Driving it from a terminal

The engine hosts no AI. It opens a door, and whichever CLI you run walks
through it — Claude Code, Codex, Aider, your own script. Run it beside the
browser; nothing is embedded and nothing is locked in.

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

### Headless

The client can be headless Chrome — WebGL, physics and canvas readback all
work, and nothing about driving it changes.

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
a file written after that would not exist until a reload, which is exactly the
moment you want to run it.

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

The clock, the schedule and the random stream live in one kernel module because
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
  loop in game code will freeze the editor.
- No terminal panel in the editor yet — the bridge works, but you run your CLI
  in your own terminal. Embedding one needs a PTY (`node-pty`) so a CLI's TUI
  renders properly.
- Plugins cannot hot-swap; editing one reloads the page. Deleting any project
  file also reloads, because Vite does not consult plugins on unlink.
- `Terminal Bridge` is dev-server only. A production build has no relay.
- The bridge does not authenticate and `eval` runs arbitrary code in the page.
  Fine for localhost; do not expose the dev server on a network.
