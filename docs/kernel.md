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
references — not by parsing text. So the index is exact: it is what the editor's
search reads, and `.engine/index.agent.json` is the compact view the
instructions tell an agent to read first.

Step 8 is why writing a new type file works without a reload: a glob is fixed
when the page loads, a fetched list is not.

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
